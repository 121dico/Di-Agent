package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func boundaryV12Catalog() *v12CatalogFake {
	return &v12CatalogFake{reportRunnerCatalogFake: reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: json.RawMessage(`{"fieldList":[{"name":"duid"}]}`), VisualizationJSON: json.RawMessage(`{"template":{"profile":"price_sensitive_v1_2","partition_mode":"previous_day"}}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive_v1_2", Enabled: true},
	}}
}

func TestReportV12RunRefreshRangeMatchesTrigger(t *testing.T) {
	for _, test := range []struct{ trigger, start string }{{"scheduled", "2026-09-09"}, {"manual", "2026-08-10"}} {
		t.Run(test.trigger, func(t *testing.T) {
			connector := &reportConnectorFake{result: model.ReportQueryResult{Partition: "2026-09-09"}}
			runner := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector)
			runner.now = func() time.Time { return time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC) }
			if _, err := runner.Run(context.Background(), "report-1", test.trigger, "admin"); err != nil {
				t.Fatal(err)
			}
			if len(connector.queries) != 4 {
				t.Fatalf("expected snapshot and three aggregate queries, got %d", len(connector.queries))
			}
			for _, raw := range connector.queries[1:] {
				var query struct {
					Conditions []struct {
						Name     string `json:"name"`
						Operator string `json:"operatorEnum"`
						Value    string `json:"value"`
					} `json:"conditionList"`
				}
				if err := json.Unmarshal(raw, &query); err != nil {
					t.Fatal(err)
				}
				for _, condition := range query.Conditions {
					if condition.Name == "dt" && condition.Operator == "GEQ" && condition.Value != test.start {
						t.Fatalf("%s refresh starts at %s, want %s", test.trigger, condition.Value, test.start)
					}
				}
			}
		})
	}
}

func TestReportV12RejectsTruncatedAggregateWithoutCaching(t *testing.T) {
	for _, truncatedIndex := range []int{0, 1} {
		t.Run([]string{"daily totals", "score groups"}[truncatedIndex], func(t *testing.T) {
			results := []model.ReportQueryResult{
				{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
				{Rows: []map[string]any{{"dt": "2026-09-09", "level": "HIGH", "user_count": 20, "price_avg": 70, "price_n": 20}}},
			}
			results[truncatedIndex].Pagination = model.ReportPagination{Total: 2, Page: 1, PageSize: 1, PageCount: 2}
			catalog := boundaryV12Catalog()
			connector := &reportConnectorFake{results: results}
			runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
			result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09")
			if err == nil || result != nil {
				t.Fatalf("silently accepted partial aggregate: result=%+v err=%v", result, err)
			}
			if catalog.cached != nil {
				t.Fatal("partial aggregate persisted in cache")
			}
		})
	}
}

func TestReportV12CapacityFailureDoesNotRetryOrCache(t *testing.T) {
	catalog := boundaryV12Catalog()
	connector := &reportConnectorFake{err: errors.New("MEMORY_LIMIT_EXCEEDED: upstream detail")}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09")
	if result != nil || !errors.Is(err, ErrReportAggregateCapacity) {
		t.Fatalf("unexpected capacity response: %v %v", result, err)
	}
	if len(connector.queries) != 1 || catalog.cached != nil {
		t.Fatal("capacity failure retried or cached")
	}
}

func TestReportV12MissingPreviousDateIsNotDailyGrowth(t *testing.T) {
	catalog := boundaryV12Catalog()
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-07", "total_user_count": 100}, {"dt": "2026-09-09", "total_user_count": 130}}},
		{Rows: []map[string]any{{"dt": "2026-09-07", "level": "LOW", "user_count": 100}, {"dt": "2026-09-09", "level": "LOW", "user_count": 130}}},
	}}
	result, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	latest := result.Trend[1]
	if latest.DailyGrowthAvailable == nil || *latest.DailyGrowthAvailable || latest.DailyNetUserGrowth != 0 || result.Summary.AverageDailyNetUserGrowth != 0 {
		t.Fatalf("missing date was treated as daily growth: %+v", result)
	}
	if latest.CumulativeNetUserGrowth != 30 {
		t.Fatalf("real cumulative change lost: %+v", latest)
	}
}

func TestReportV12ManualRunKeepsSavedFiltersAndSelectedRangeCities(t *testing.T) {
	catalog := boundaryV12Catalog()
	catalog.report.QueryJSON = json.RawMessage(`{"fieldList":[{"name":"duid"}],"conditionList":[{"name":"dt","operatorEnum":"EQ","value":"2020-01-01"},{"name":"ps_type","operatorEnum":"EQ","value":"PRIOR"}]}`)
	connector := &reportConnectorFake{result: model.ReportQueryResult{Partition: "2026-09-09"}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	runner.now = func() time.Time { return time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC) }
	if _, err := runner.Run(context.Background(), "report-1", "manual", "admin", ReportRunOptions{Range: "7d", Cities: []string{"北京"}}); err != nil {
		t.Fatal(err)
	}
	if len(connector.queries) != 4 {
		t.Fatalf("expected snapshot and three aggregate queries, got %d", len(connector.queries))
	}
	for index, raw := range connector.queries[1:] {
		var query struct {
			Conditions []map[string]any `json:"conditionList"`
		}
		if err := json.Unmarshal(raw, &query); err != nil {
			t.Fatal(err)
		}
		want := []map[string]any{
			{"name": "dt", "operatorEnum": "GEQ", "value": "2026-09-03"},
			{"name": "dt", "operatorEnum": "LEQ", "value": "2026-09-09"},
			{"name": "ps_type", "operatorEnum": "EQ", "value": "PRIOR"},
			{"name": "city_name", "operatorEnum": "IN", "value": []any{"北京"}},
		}
		if index == 1 {
			want = append(want, map[string]any{"name": "ps_score", "operatorEnum": "NOT_NULL"})
		}
		if index == 2 {
			want = append(want, map[string]any{"name": "ps_conf", "operatorEnum": "GQ", "value": "0"})
		}
		if !reflect.DeepEqual(query.Conditions, want) {
			t.Fatalf("saved filters or manual selection lost: got %#v, want %#v", query.Conditions, want)
		}
	}
	if catalog.cached == nil || catalog.cached.Range != "7d" || catalog.cached.StartDate != "2026-09-03" {
		t.Fatalf("manual selection was not reflected in cached result: %+v", catalog.cached)
	}
}
