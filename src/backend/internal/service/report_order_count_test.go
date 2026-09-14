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

func TestOrderCountCohortRejectsInvalidSelectionBeforeUpstream(t *testing.T) {
	for _, selection := range []string{"", "0", "11", "-1", "01", "1.0", " 1", "GT10", "1 OR 1=1"} {
		t.Run(selection, func(t *testing.T) {
			connector := &reportConnectorFake{}
			_, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", selection, nil)
			if !errors.Is(err, ErrReportInvalid) || len(connector.queries) != 0 {
				t.Fatalf("invalid selection queried upstream: err=%v calls=%d", err, len(connector.queries))
			}
		})
	}
}

func TestOrderCountCohortKeepsAllPopulationConditionsInBothQueries(t *testing.T) {
	catalog := boundaryV12Catalog()
	catalog.report.QueryJSON = json.RawMessage(`{"fieldList":[{"name":"duid"}],"conditionList":[{"name":"dt","operatorEnum":"EQ","value":"2020-01-01"},{"name":"ps_level","operatorEnum":"IN","value":["HIGH","LOW"]}]}`)
	connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 4}}}}
	_, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", []string{"北京"})
	if err != nil {
		t.Fatal(err)
	}
	if len(connector.queries) != 2 {
		t.Fatalf("expected two aggregates, got %d", len(connector.queries))
	}
	want := []map[string]any{
		{"name": "dt", "operatorEnum": "GEQ", "value": "2026-09-13"},
		{"name": "dt", "operatorEnum": "LEQ", "value": "2026-09-13"},
		{"name": "ps_level", "operatorEnum": "IN", "value": []any{"HIGH", "LOW"}},
		{"name": "city_name", "operatorEnum": "IN", "value": []any{"北京"}},
		{"name": "ps_conf", "operatorEnum": "GQ", "value": "0"},
		{"name": "duid", "operatorEnum": "GQ", "value": "0"},
		{"name": "order_cnt_180d", "operatorEnum": "EQ", "value": "1"},
	}
	for _, raw := range connector.queries {
		var q struct {
			Conditions []map[string]any `json:"conditionList"`
		}
		if err := json.Unmarshal(raw, &q); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(q.Conditions, want) {
			t.Fatalf("population scope changed: %+v", q.Conditions)
		}
	}
}

func TestOrderCountCohortSeparatesDateAndCityCaches(t *testing.T) {
	catalog := &orderCountCatalog{boundaryV12Catalog(), v12Contract(), map[string]*model.ReportAnalyticsResult{}}
	connector := &reportConnectorFake{}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	for _, sample := range []struct {
		date, city string
		count      int64
	}{{"2026-09-12", "北京", 3}, {"2026-09-13", "北京", 7}, {"2026-09-13", "上海", 11}} {
		connector.result = model.ReportQueryResult{Rows: []map[string]any{{"dt": sample.date, "level": "HIGH", "user_count": sample.count}}}
		result, err := runner.QueryOrderCohort(context.Background(), "report-1", sample.date, "all", []string{sample.city})
		if err != nil || result.OrderCohort.UserCount != sample.count {
			t.Fatalf("wrong date/city population: %v %+v", err, result)
		}
	}
	connector.err = errors.New("upstream unavailable")
	for _, sample := range []struct {
		date, city string
		count      int64
	}{{"2026-09-12", "北京", 3}, {"2026-09-13", "北京", 7}, {"2026-09-13", "上海", 11}} {
		result, err := runner.QueryOrderCohort(context.Background(), "report-1", sample.date, "all", []string{sample.city})
		if err != nil || result.OrderCohort.UserCount != sample.count || !result.Cached {
			t.Fatalf("wrong cached population: %v %+v", err, result)
		}
	}
	if len(connector.queries) != 6 {
		t.Fatalf("cached revisit scanned upstream: %d", len(connector.queries))
	}
}

func TestOrderCountCohortUsesRealOrdersAndDistinctPopulation(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 3}, {"dt": "2026-09-13", "level": "LOW", "user_count": 7}}},
		{Rows: []map[string]any{{"dt": "2026-09-13", "user_count": 10}}},
	}}
	runner := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "gt10", []string{"北京"})
	if err != nil {
		t.Fatal(err)
	}
	if result.OrderCohort == nil || result.OrderCohort.UserCount != 10 || len(result.OrderCohort.Distribution) != 2 {
		t.Fatalf("wrong population: %+v", result)
	}
	for _, raw := range connector.queries {
		var q struct {
			Conditions []map[string]any `json:"conditionList"`
			Fields     []map[string]any `json:"fieldList"`
		}
		if err := json.Unmarshal(raw, &q); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, c := range q.Conditions {
			if c["name"] == "order_cnt_180d" && c["operatorEnum"] == "GQ" && c["value"] == "10" {
				found = true
			}
			if c["name"] == "ps_order_cnt" {
				t.Fatal("capped order count used")
			}
		}
		if !found {
			t.Fatal("missing >10 orders filter")
		}
		for _, f := range q.Fields {
			if f["name"] == "duid" && f["aggFunctionEnum"] != "COUNT_DISTINCT" {
				t.Fatal("population not deduplicated")
			}
		}
	}
}

type orderCountCatalog struct {
	*v12CatalogFake
	contract *model.ReportDataSourceContract
	entries  map[string]*model.ReportAnalyticsResult
}

func (f *orderCountCatalog) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return f.contract, nil
}
func (f *orderCountCatalog) GetTemplateAnalytics(_ context.Context, key string, _ time.Time) (*model.ReportAnalyticsResult, error) {
	return f.entries[key], nil
}
func (f *orderCountCatalog) SaveTemplateAnalytics(_ context.Context, key, _ string, value *model.ReportAnalyticsResult, _ time.Time) error {
	f.entries[key] = value
	return nil
}

func TestOrderCountCohortCacheScopeAndContractRevocation(t *testing.T) {
	catalog := &orderCountCatalog{boundaryV12Catalog(), v12Contract(), map[string]*model.ReportAnalyticsResult{}}
	connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 4}}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	for _, selection := range []string{"10", "10", "gt10"} {
		if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", selection, nil); err != nil {
			t.Fatal(err)
		}
	}
	if len(connector.queries) != 4 {
		t.Fatal("cached selection rescanned or different selection reused wrong cache")
	}
	for i := range catalog.contract.Fields {
		if catalog.contract.Fields[i].Name == "order_cnt_180d" {
			catalog.contract.Fields[i].Filterable = false
		}
	}
	if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "10", nil); err == nil {
		t.Fatal("revoked field bypassed through cache")
	}
}

func TestOrderCountCohortRejectsBadCountsAndPartialResults(t *testing.T) {
	for _, rows := range [][]map[string]any{
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": -1}},
		{{"dt": "2026-09-12", "level": "HIGH", "user_count": 4}},
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": 3}},
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": 2}, {"dt": "2026-09-13", "level": "HIGH", "user_count": 2}},
	} {
		catalog := boundaryV12Catalog()
		connector := &reportConnectorFake{results: []model.ReportQueryResult{{Rows: rows}, {Rows: []map[string]any{{"dt": "2026-09-13", "user_count": 4}}}}}
		if _, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", nil); err == nil || catalog.cached != nil {
			t.Fatal("invalid population accepted/cached")
		}
	}
}

func TestOrderCountCohortDistinguishesEmptyCohortFromMissingSnapshot(t *testing.T) {
	for _, exists := range []bool{true, false} {
		var rows []map[string]any
		if exists {
			rows = []map[string]any{{"dt": "2026-09-13"}}
		}
		connector := &reportConnectorFake{results: []model.ReportQueryResult{{}, {}, {Rows: rows}}}
		result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", nil)
		if exists && (err != nil || result.OrderCohort.UserCount != 0) {
			t.Fatalf("real zero rejected: %v", err)
		}
		if !exists && err == nil {
			t.Fatal("missing snapshot shown as zero people")
		}
	}
}
