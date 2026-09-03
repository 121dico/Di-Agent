package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestReportRunnerRefreshesCacheWhenMiddleDayIsMissing(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{
			ID: "report-1", DataSourceID: "source-1",
			QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`),
		},
		source: &model.ReportDataSource{
			ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example",
		},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "1000"}}},
		{Rows: []map[string]any{{"calculated_user_count": "500"}}},
		{Rows: []map[string]any{
			{"dt": "2026-08-18", "calculated_user_count": "410"},
			{"dt": "2026-08-24", "calculated_user_count": "500"},
		}},
		{Rows: []map[string]any{}},
	}}
	analytics := &reportAnalyticsStoreFake{rows: []model.ReportDailyAnalytics{
		{ReportID: "report-1", Date: "2026-08-18", CalculatedUserCount: 410},
		{ReportID: "report-1", Date: "2026-08-24", CalculatedUserCount: 500},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector, analytics)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if len(connector.queries) != 4 {
		t.Fatalf("cache with a missing middle day must query upstream, got %d calls", len(connector.queries))
	}
	if result.Cached {
		t.Fatal("cache with a missing middle day must not be returned as complete")
	}
}

func TestReportRunnerManualRunRefreshesThirtyOneDayAnalytics(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{
			ID: "report-1", DataSourceID: "source-1",
			QueryJSON:         []byte(`{"fieldList":[{"name":"duid"}]}`),
			VisualizationJSON: []byte(`{"analytics":{"enabled":true}}`),
		},
		source: &model.ReportDataSource{
			ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example",
		},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"duid": "1"}}, Partition: "2026-08-30"},
		{Rows: []map[string]any{{"total_user_count": "1000"}}},
		{Rows: []map[string]any{{"calculated_user_count": "500"}}},
		{Rows: []map[string]any{}},
		{Rows: []map[string]any{}},
	}}
	runner := NewReportRunner(
		catalog, &reportRunnerStoreFake{}, connector, &reportAnalyticsStoreFake{},
	)

	if _, err := runner.Run(context.Background(), "report-1", "manual", "user-1"); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(connector.queries) != 5 {
		t.Fatalf("manual run must execute the report plus four analytics queries, got %d", len(connector.queries))
	}
	var trendQuery struct {
		Conditions []struct {
			Name  string `json:"name"`
			Value any    `json:"value"`
		} `json:"conditionList"`
	}
	if err := json.Unmarshal(connector.queries[3], &trendQuery); err != nil {
		t.Fatalf("decode trend query: %v", err)
	}
	if len(trendQuery.Conditions) != 3 || trendQuery.Conditions[1].Value != "2026-07-31" || trendQuery.Conditions[2].Value != "2026-08-30" {
		t.Fatalf("manual run must refresh the inclusive 31-day range, got %#v", trendQuery.Conditions)
	}
}

func TestReportRunnerScheduledRunRefreshesOnlyLatestDay(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{
			ID: "report-1", DataSourceID: "source-1",
			QueryJSON:         []byte(`{"fieldList":[{"name":"duid"}]}`),
			VisualizationJSON: []byte(`{"analytics":{"enabled":true}}`),
		},
		source: &model.ReportDataSource{
			ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example",
		},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"duid": "1"}}, Partition: "2026-08-30"},
		{Rows: []map[string]any{{"total_user_count": "1000"}}},
		{Rows: []map[string]any{{"calculated_user_count": "500"}}},
		{Rows: []map[string]any{}},
		{Rows: []map[string]any{}},
	}}
	runner := NewReportRunner(
		catalog, &reportRunnerStoreFake{}, connector, &reportAnalyticsStoreFake{},
	)

	if _, err := runner.Run(context.Background(), "report-1", "scheduled", ""); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	var trendQuery struct {
		Conditions []struct {
			Value any `json:"value"`
		} `json:"conditionList"`
	}
	if err := json.Unmarshal(connector.queries[3], &trendQuery); err != nil {
		t.Fatalf("decode trend query: %v", err)
	}
	if len(trendQuery.Conditions) != 3 || trendQuery.Conditions[1].Value != "2026-08-30" || trendQuery.Conditions[2].Value != "2026-08-30" {
		t.Fatalf("scheduled run must refresh only the latest day, got %#v", trendQuery.Conditions)
	}
}
