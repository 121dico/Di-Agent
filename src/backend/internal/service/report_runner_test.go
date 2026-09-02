package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/agent-hub/backend/internal/model"
)

type reportRunnerCatalogFake struct {
	report *model.ReportDefinition
	source *model.ReportDataSource
}

func (f *reportRunnerCatalogFake) GetReportDefinition(context.Context, string) (*model.ReportDefinition, error) {
	return f.report, nil
}

func (f *reportRunnerCatalogFake) GetReportDataSource(context.Context, string) (*model.ReportDataSource, error) {
	return f.source, nil
}

type reportRunnerStoreFake struct {
	started   *model.ReportRun
	completed *model.ReportRun
}

func (f *reportRunnerStoreFake) StartReportRun(_ context.Context, run *model.ReportRun) error {
	f.started = run
	return nil
}

func (f *reportRunnerStoreFake) CompleteReportRun(_ context.Context, run *model.ReportRun) error {
	f.completed = run
	return nil
}

func (f *reportRunnerStoreFake) FailReportRun(context.Context, *model.ReportRun) error { return nil }

type reportConnectorFake struct {
	result  model.ReportQueryResult
	results []model.ReportQueryResult
	err     error
	query   []byte
	queries [][]byte
}

type reportAnalyticsStoreFake struct {
	rows    []model.ReportDailyAnalytics
	upserts []*model.ReportDailyAnalytics
}

func (f *reportAnalyticsStoreFake) UpsertReportDailyAnalytics(_ context.Context, row *model.ReportDailyAnalytics) error {
	f.upserts = append(f.upserts, row)
	return nil
}

func (f *reportAnalyticsStoreFake) ListReportDailyAnalytics(context.Context, string, string, string) ([]model.ReportDailyAnalytics, error) {
	return f.rows, nil
}

func (f *reportConnectorFake) Query(_ context.Context, _ model.ReportDataSource, query []byte) (model.ReportQueryResult, error) {
	f.query = append([]byte(nil), query...)
	f.queries = append(f.queries, append([]byte(nil), query...))
	if f.err != nil {
		return model.ReportQueryResult{}, f.err
	}
	if len(f.results) > 0 {
		result := f.results[0]
		f.results = f.results[1:]
		return result, nil
	}
	return f.result, nil
}

func TestReportRunnerStoresSuccessfulSnapshot(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid","aggFunctionEnum":"COUNT DISTINCT","alias":"users"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	store := &reportRunnerStoreFake{}
	connector := &reportConnectorFake{result: model.ReportQueryResult{
		Rows:      []map[string]any{{"users": "10591"}},
		Partition: "2026-08-24",
		QueryID:   "query-1",
		Duration:  337 * time.Millisecond,
	}}

	runner := NewReportRunner(catalog, store, connector)
	run, err := runner.Run(context.Background(), "report-1", "manual", "user-1")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if run.Status != model.ReportRunSucceeded || store.completed == nil {
		t.Fatalf("expected successful persisted run, got %#v", run)
	}
	if run.SourcePartition != "2026-08-24" || run.QueryID != "query-1" {
		t.Fatalf("expected source traceability, got %#v", run)
	}
	if got := string(run.SnapshotJSON); got != `[{"users":"10591"}]` {
		t.Fatalf("unexpected snapshot: %s", got)
	}
}

func TestReportRunnerQueriesCalculatedPriceAnalyticsForSelectedRange(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "1000", "total_order_count": "3000"}}},
		{Rows: []map[string]any{{"avg_price_sensitivity_score": "64.25", "calculated_user_count": "500"}}},
		{Rows: []map[string]any{
			{"dt": "2026-08-18", "avg_price_sensitivity_score": "60", "avg_d1_price_score": "62", "avg_d2_coupon_score": "51", "avg_d3_time_score": "58", "total_order_count": "600", "calculated_user_count": "240"},
			{"dt": "2026-08-19", "avg_price_sensitivity_score": "65", "avg_d1_price_score": "67", "avg_d2_coupon_score": "54", "avg_d3_time_score": "61", "total_order_count": "634", "calculated_user_count": "260"},
		}},
		{Rows: []map[string]any{{"dt": "2026-08-24", "price_sensitivity_level": "HIGH", "user_count": "200"}, {"dt": "2026-08-24", "price_sensitivity_level": "MEDIUM", "user_count": "250"}, {"dt": "2026-08-24", "price_sensitivity_level": "LOW", "user_count": "50"}}},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if result.StartDate != "2026-08-18" || result.EndDate != "2026-08-24" {
		t.Fatalf("unexpected date range: %#v", result)
	}
	if result.Summary.TotalUserCount != 1000 || result.Summary.TotalOrderCount != 3000 || result.Summary.CalculatedUserCount != 500 || result.Summary.CalculatedUserShare != 50 || result.Summary.HighSensitivityShare != 40 || result.Summary.MediumSensitivityShare != 50 || result.Summary.LowSensitivityShare != 10 {
		t.Fatalf("unexpected summary: %#v", result.Summary)
	}
	if len(result.Trend) != 2 || result.Trend[1].AverageD1PriceScore != 67 || len(result.Distribution) != 3 {
		t.Fatalf("unexpected analytics result: %#v", result)
	}
	if len(connector.queries) != 4 {
		t.Fatalf("expected four aggregate queries, got %d", len(connector.queries))
	}
	for index, raw := range connector.queries {
		var query struct {
			Conditions []struct {
				Name     string `json:"name"`
				Operator string `json:"operatorEnum"`
				Value    any    `json:"value"`
			} `json:"conditionList"`
		}
		if err := json.Unmarshal(raw, &query); err != nil {
			t.Fatalf("decode aggregate query: %v", err)
		}
		if index == 0 {
			if len(query.Conditions) != 1 || query.Conditions[0].Name != "dt" || query.Conditions[0].Operator != "EQ" || query.Conditions[0].Value != "2026-08-24" {
				t.Fatalf("overall totals must use the latest observation date, got %#v", query.Conditions)
			}
			continue
		}
		if index == 1 {
			if len(query.Conditions) != 2 || query.Conditions[0].Name != "price_sensitivity_score" || query.Conditions[0].Operator != "NOT_NULL" || query.Conditions[1].Operator != "EQ" || query.Conditions[1].Value != "2026-08-24" {
				t.Fatalf("latest calculated totals must use the latest observation date, got %#v", query.Conditions)
			}
			continue
		}
		if len(query.Conditions) != 3 || query.Conditions[0].Name != "price_sensitivity_score" || query.Conditions[0].Operator != "NOT_NULL" || query.Conditions[1].Value != "2026-08-18" || query.Conditions[2].Value != "2026-08-24" {
			t.Fatalf("unexpected analytics conditions: %#v", query.Conditions)
		}
	}
}

func TestReportRunnerDerivesDailyIncrementMetricsFromOrderedSnapshots(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "1200", "total_order_count": "3300"}}},
		{Rows: []map[string]any{{"avg_price_sensitivity_score": "64", "calculated_user_count": "270"}}},
		{Rows: []map[string]any{
			{"dt": "2026-08-20", "calculated_user_count": "270"},
			{"dt": "2026-08-18", "calculated_user_count": "240"},
			{"dt": "2026-08-19", "calculated_user_count": "260"},
		}},
		{Rows: []map[string]any{}},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-20")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if len(result.Trend) != 3 {
		t.Fatalf("expected three ordered daily points, got %#v", result.Trend)
	}
	if got := result.Trend[0].DailyNetUserGrowth; got != 0 {
		t.Fatalf("baseline day growth = %d, want 0", got)
	}
	if got := result.Trend[1].DailyNetUserGrowth; got != 20 {
		t.Fatalf("second day growth = %d, want 20", got)
	}
	if got := result.Trend[1].DailyUserGrowthRate; got < 8.33 || got > 8.34 {
		t.Fatalf("second day growth rate = %f, want about 8.33", got)
	}
	if got := result.Trend[2].CumulativeNetUserGrowth; got != 30 {
		t.Fatalf("cumulative net growth = %d, want 30", got)
	}
	if result.Summary.BaselineCalculatedUserCount != 240 || result.Summary.LatestDailyNetUserGrowth != 10 || result.Summary.CumulativeNetUserGrowth != 30 {
		t.Fatalf("unexpected increment summary: %#v", result.Summary)
	}
	if result.Summary.AverageDailyNetUserGrowth != 15 {
		t.Fatalf("average daily net growth = %f, want 15", result.Summary.AverageDailyNetUserGrowth)
	}
}

func TestReportRunnerScopesAnalyticsToSelectedCitiesAndUsesLatestDistribution(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "100", "total_order_count": "280"}}},
		{Rows: []map[string]any{{"avg_price_sensitivity_score": "66", "calculated_user_count": "80"}}},
		{Rows: []map[string]any{
			{"dt": "2026-08-23", "avg_price_sensitivity_score": "62", "calculated_user_count": "70"},
			{"dt": "2026-08-24", "avg_price_sensitivity_score": "66", "calculated_user_count": "80"},
		}},
		{Rows: []map[string]any{
			{"dt": "2026-08-23", "price_sensitivity_level": "HIGH", "user_count": "999"},
			{"dt": "2026-08-24", "price_sensitivity_level": "HIGH", "user_count": "20"},
			{"dt": "2026-08-24", "price_sensitivity_level": "MEDIUM", "user_count": "50"},
			{"dt": "2026-08-24", "price_sensitivity_level": "LOW", "user_count": "10"},
		}},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24", ReportAnalyticsOptions{
		Cities: []string{"北京市", "上海市"},
	})
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if len(result.Distribution) != 3 || result.Summary.HighSensitivityShare != 25 || result.Summary.MediumSensitivityShare != 62.5 || result.Summary.LowSensitivityShare != 12.5 {
		t.Fatalf("distribution must describe the latest observation date only: %#v", result)
	}
	for _, raw := range connector.queries {
		var query struct {
			Conditions []struct {
				Name     string `json:"name"`
				Operator string `json:"operatorEnum"`
				Value    any    `json:"value"`
			} `json:"conditionList"`
		}
		if err := json.Unmarshal(raw, &query); err != nil {
			t.Fatalf("decode aggregate query: %v", err)
		}
		city := query.Conditions[len(query.Conditions)-1]
		if city.Name != "user_city_name" || city.Operator != "IN" {
			t.Fatalf("query must include city filter, got %#v", query.Conditions)
		}
		values, ok := city.Value.([]any)
		if !ok || len(values) != 2 || values[0] != "北京市" || values[1] != "上海市" {
			t.Fatalf("unexpected city values: %#v", city.Value)
		}
	}
}

func TestReportRunnerReturnsPersistedAnalyticsWithoutCallingUpstream(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{}
	analytics := &reportAnalyticsStoreFake{rows: []model.ReportDailyAnalytics{
		{ReportID: "report-1", Date: "2026-08-18", TotalUserCount: 850, TotalOrderCount: 2400, CalculatedUserCount: 410},
		{ReportID: "report-1", Date: "2026-08-19", TotalUserCount: 860, TotalOrderCount: 2450, CalculatedUserCount: 420},
		{ReportID: "report-1", Date: "2026-08-20", TotalUserCount: 870, TotalOrderCount: 2500, CalculatedUserCount: 430},
		{ReportID: "report-1", Date: "2026-08-21", TotalUserCount: 880, TotalOrderCount: 2550, CalculatedUserCount: 440},
		{ReportID: "report-1", Date: "2026-08-22", TotalUserCount: 890, TotalOrderCount: 2580, CalculatedUserCount: 445},
		{
			ReportID: "report-1", Date: "2026-08-23", TotalUserCount: 900, TotalOrderCount: 2600,
			CalculatedUserCount: 450, AveragePriceSensitivityScore: 62,
			DistributionJSON: json.RawMessage(`[{"level":"HIGH","user_count":150},{"level":"MEDIUM","user_count":250},{"level":"LOW","user_count":50}]`),
		},
		{
			ReportID: "report-1", Date: "2026-08-24", TotalUserCount: 1000, TotalOrderCount: 3000,
			CalculatedUserCount: 500, AveragePriceSensitivityScore: 64.25,
			DistributionJSON: json.RawMessage(`[{"level":"HIGH","user_count":200},{"level":"MEDIUM","user_count":250},{"level":"LOW","user_count":50}]`),
		},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector, analytics)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if len(connector.queries) != 0 {
		t.Fatalf("cached analytics must not query upstream, got %d calls", len(connector.queries))
	}
	if !result.Cached {
		t.Fatal("persisted analytics must be marked as cached")
	}
	if result.Summary.TotalUserCount != 1000 || result.Summary.TotalOrderCount != 3000 || result.Summary.CalculatedUserShare != 50 {
		t.Fatalf("unexpected cached analytics: %#v", result)
	}
}

func TestReportRunnerDoesNotTreatPartialDailyCacheAsCompleteTrend(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "1000", "total_order_count": "3000"}}},
		{Rows: []map[string]any{{"avg_price_sensitivity_score": "64.25", "calculated_user_count": "500"}}},
		{Rows: []map[string]any{
			{"dt": "2026-08-18", "avg_price_sensitivity_score": "58", "total_order_count": "2400", "calculated_user_count": "410"},
			{"dt": "2026-08-22", "avg_price_sensitivity_score": "67", "total_order_count": "2800", "calculated_user_count": "470"},
			{"dt": "2026-08-24", "avg_price_sensitivity_score": "64.25", "total_order_count": "3000", "calculated_user_count": "500"},
		}},
		{Rows: []map[string]any{{"dt": "2026-08-24", "price_sensitivity_level": "HIGH", "user_count": "500"}}},
	}}
	analytics := &reportAnalyticsStoreFake{rows: []model.ReportDailyAnalytics{{
		ReportID: "report-1", Date: "2026-08-24", TotalUserCount: 1000, TotalOrderCount: 3000,
		CalculatedUserCount: 500, AveragePriceSensitivityScore: 64.25,
	}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector, analytics)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if len(connector.queries) != 4 {
		t.Fatalf("partial cache must query the complete upstream range, got %d calls", len(connector.queries))
	}
	if len(result.Trend) != 3 || result.Trend[0].Date != "2026-08-18" || result.Trend[2].Date != "2026-08-24" {
		t.Fatalf("expected complete upstream trend instead of one cached day, got %#v", result.Trend)
	}
}

func TestReportRunnerFallsBackToHonestPartialCacheWhenUpstreamIsUnavailable(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{err: errors.New("upstream unavailable")}
	analytics := &reportAnalyticsStoreFake{rows: []model.ReportDailyAnalytics{{
		ReportID: "report-1", Date: "2026-08-24", TotalUserCount: 1000, TotalOrderCount: 3000,
		CalculatedUserCount: 500, AveragePriceSensitivityScore: 64.25,
		DistributionJSON: json.RawMessage(`[{"level":"HIGH","user_count":500}]`),
	}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector, analytics)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-08-24")
	if err != nil {
		t.Fatalf("partial real cache should remain available: %v", err)
	}
	if !result.Cached || len(result.Trend) != 1 || result.Trend[0].Date != "2026-08-24" {
		t.Fatalf("expected one honest cached baseline, got %#v", result)
	}
}

func TestReportRunnerCanForceRefreshPersistedAnalytics(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"total_user_count": "1000", "total_order_count": "3000"}}},
		{Rows: []map[string]any{{"avg_price_sensitivity_score": "64.25", "calculated_user_count": "500"}}},
		{Rows: []map[string]any{{"dt": "2026-08-24", "avg_price_sensitivity_score": "64.25", "calculated_user_count": "500"}}},
		{Rows: []map[string]any{{"dt": "2026-08-24", "price_sensitivity_level": "HIGH", "user_count": "500"}}},
	}}
	analytics := &reportAnalyticsStoreFake{rows: []model.ReportDailyAnalytics{{ReportID: "report-1", Date: "2026-08-24"}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector, analytics)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "1d", "2026-08-24", ReportAnalyticsOptions{ForceRefresh: true})
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if result.Cached || len(connector.queries) != 4 || len(analytics.upserts) != 1 {
		t.Fatalf("forced refresh must query and persist upstream analytics: result=%#v calls=%d upserts=%d", result, len(connector.queries), len(analytics.upserts))
	}
}

func TestReportRunnerSupportsOneYearEndingOnLatestCompletedDay(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{{}, {}, {}, {}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	runner.now = func() time.Time { return time.Date(2026, 8, 26, 14, 0, 0, 0, time.Local) }

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "365d", "")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if result.StartDate != "2025-08-26" || result.EndDate != "2026-08-25" {
		t.Fatalf("expected latest completed day range, got %#v", result)
	}
}

func TestReportRunnerSupportsThirtyOneDaysFromJuly28ThroughAugust27(t *testing.T) {
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: []byte(`{"fieldList":[{"name":"duid"}]}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{{}, {}, {}, {}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	result, err := runner.QueryAnalytics(context.Background(), "report-1", "31d", "2026-08-27")
	if err != nil {
		t.Fatalf("QueryAnalytics returned error: %v", err)
	}
	if result.StartDate != "2026-07-28" || result.EndDate != "2026-08-27" {
		t.Fatalf("expected inclusive 31-day range, got %#v", result)
	}
}

func TestReportRunnerQueriesRequestedPageWithoutMutatingDefinition(t *testing.T) {
	original := []byte(`{"fieldList":[{"name":"duid"}],"needPagination":true,"pageSize":10,"page":1}`)
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: original},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{result: model.ReportQueryResult{
		Rows:       []map[string]any{{"duid": "42"}},
		Pagination: model.ReportPagination{Total: 10591, Page: 3, PageSize: 50, PageCount: 212},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	page, err := runner.QueryPage(context.Background(), "report-1", 3, 50)
	if err != nil {
		t.Fatalf("QueryPage returned error: %v", err)
	}
	if page.Pagination.Total != 10591 || page.Rows[0]["duid"] != "42" {
		t.Fatalf("unexpected page: %#v", page)
	}
	if got := string(connector.query); got != `{"fieldList":[{"name":"duid"}],"needPagination":true,"orderBy":"duid","page":3,"pageSize":50}` {
		t.Fatalf("unexpected paged query: %s", got)
	}
	if got := string(catalog.report.QueryJSON); got != string(original) {
		t.Fatalf("definition query mutated: %s", got)
	}
}

func TestReportRunnerSearchesOneDUIDWithoutExposingAnUnfilteredPage(t *testing.T) {
	original := []byte(`{"fieldList":[{"name":"duid"},{"name":"price_sensitivity_score"}],"conditionList":[{"name":"price_sensitivity_score","operatorEnum":"NOT_NULL"}]}`)
	catalog := &reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: original},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive", Endpoint: "http://data.example"},
	}
	connector := &reportConnectorFake{result: model.ReportQueryResult{
		Rows:       []map[string]any{{"duid": "17592356441816", "price_sensitivity_score": 80}},
		Pagination: model.ReportPagination{Total: 1, Page: 1, PageSize: 20, PageCount: 1},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)

	result, err := runner.QuerySearch(context.Background(), "report-1", "17592356441816")
	if err != nil {
		t.Fatalf("QuerySearch returned error: %v", err)
	}
	if len(result.Rows) != 1 || result.Rows[0]["duid"] != "17592356441816" {
		t.Fatalf("unexpected search result: %#v", result)
	}
	var query struct {
		PageSize   int `json:"pageSize"`
		Conditions []struct {
			Name     string `json:"name"`
			Operator string `json:"operatorEnum"`
			Value    any    `json:"value"`
		} `json:"conditionList"`
	}
	if err := json.Unmarshal(connector.query, &query); err != nil {
		t.Fatalf("decode search query: %v", err)
	}
	if query.PageSize != 20 || len(query.Conditions) != 2 || query.Conditions[1].Name != "duid" || query.Conditions[1].Operator != "EQ" || query.Conditions[1].Value != "17592356441816" {
		t.Fatalf("search must append an exact duid condition, got %#v", query)
	}
}
