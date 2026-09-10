package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type keyedSavedHistoryCatalog struct {
	*v12CatalogFake
	snapshots map[string]*model.ReportAnalyticsResult
}

func (f *keyedSavedHistoryCatalog) GetTemplateAnalytics(_ context.Context, key string, _ time.Time) (*model.ReportAnalyticsResult, error) {
	return f.snapshots[key], nil
}
func (f *keyedSavedHistoryCatalog) SaveTemplateAnalytics(_ context.Context, key string, _ string, result *model.ReportAnalyticsResult, _ time.Time) error {
	f.snapshots[key] = result
	return nil
}

func TestReportSavedHistoryIsolatesCitiesAndConfiguration(t *testing.T) {
	for _, scenario := range []string{"city", "query", "source-version", "report-version"} {
		t.Run(scenario, func(t *testing.T) {
			catalog := &keyedSavedHistoryCatalog{v12CatalogFake: boundaryV12Catalog(), snapshots: map[string]*model.ReportAnalyticsResult{}}
			connector := &reportConnectorFake{results: []model.ReportQueryResult{
				{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 123}}},
				{Rows: []map[string]any{}}, {Rows: []map[string]any{}},
			}}
			runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
			options := ReportAnalyticsOptions{Cities: []string{"北京"}}
			if _, err := runner.QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09", options); err != nil {
				t.Fatal(err)
			}
			saved, err := runner.QueryAnalytics(context.Background(), "report-1", "saved", "2026-09-09", options)
			if err != nil || len(saved.Trend) != 1 || saved.Summary.TotalUserCount != 123 {
				t.Fatalf("original persisted snapshot unavailable: %+v, %v", saved, err)
			}
			switch scenario {
			case "city":
				options.Cities = []string{"上海"}
			case "query":
				catalog.report.QueryJSON = json.RawMessage(`{"fieldList":[{"name":"duid"}],"conditionList":[{"name":"ps_conf","operatorEnum":"GQ","value":0}]}`)
			case "source-version":
				catalog.source.UpdatedAt = time.Date(2026, 9, 10, 1, 0, 0, 0, time.UTC)
			case "report-version":
				catalog.report.UpdatedAt = time.Date(2026, 9, 10, 1, 0, 0, 0, time.UTC)
			}
			other, err := runner.QueryAnalytics(context.Background(), "report-1", "saved", "2026-09-09", options)
			if err != nil {
				t.Fatal(err)
			}
			if len(other.Trend) != 0 || other.DataDate != "" {
				t.Fatalf("leaked different-scope snapshot: %+v", other)
			}
			if len(connector.queries) != 3 {
				t.Fatalf("saved lookup queried upstream: %d calls", len(connector.queries))
			}
		})
	}
}
