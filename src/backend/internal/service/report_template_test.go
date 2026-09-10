package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type templateStoreFake struct {
	reportServiceStoreFake
	reports []model.ReportDefinition
}

func (f *templateStoreFake) ListReportDefinitions(context.Context) ([]model.ReportDefinition, error) {
	return f.reports, nil
}
func (f *templateStoreFake) CreateReportDefinition(_ context.Context, r *model.ReportDefinition) error {
	r.ID = "template-report"
	f.reports = append(f.reports, *r)
	return nil
}
func v12Contract() *model.ReportDataSourceContract {
	contract := &model.ReportDataSourceContract{SourceID: "source-1", APIName: "price_sensitive_v1_2", Enabled: true}
	for _, name := range []string{"duid", "dt", "ps_conf", "ps_score", "ps_level", "ps_type", "price_score", "coupon_score", "time_score", "order_cnt_180d", "city_name"} {
		contract.Fields = append(contract.Fields, model.ReportFieldContract{Name: name, DataType: "DOUBLE", Enabled: true, Selectable: true, Filterable: true, Groupable: true, Aggregatable: true, Sortable: true})
	}
	return contract
}
func TestReportTemplateApplyIsAdminOnlyIdempotentAndCopiesBinding(t *testing.T) {
	store := &templateStoreFake{reportServiceStoreFake: reportServiceStoreFake{sourceContract: v12Contract()}}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: false}, nil)
	if _, err := svc.ApplyTemplate(context.Background(), "user", "template-1", "source-1"); !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("ordinary user allowed: %v", err)
	}
	svc = NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	report, err := svc.ApplyTemplate(context.Background(), "admin", "template-1", "source-1")
	if err != nil {
		t.Fatal(err)
	}
	if report.Name != "价敏用户报表 V1.2" || templateBinding(report).Profile != "price_sensitive_v1_2" {
		t.Fatalf("wrong binding: %+v", report)
	}
	store.reports[0].Name = "管理员修改后的名称"
	again, err := svc.ApplyTemplate(context.Background(), "admin", "template-1", "source-1")
	if err != nil || len(store.reports) != 1 || again.Name != "管理员修改后的名称" {
		t.Fatalf("reapply overwrote instance: %+v %v", again, err)
	}
	store.sourceContract.Fields[0].Aggregatable = false
	if _, err := svc.ApplyTemplate(context.Background(), "admin", "template-1", "source-1"); err == nil {
		t.Fatal("disabled field capability accepted")
	}
}

type v12CatalogFake struct {
	reportRunnerCatalogFake
	cached *model.ReportAnalyticsResult
}

func (f *v12CatalogFake) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return v12Contract(), nil
}
func (f *v12CatalogFake) GetTemplateAnalytics(context.Context, string, time.Time) (*model.ReportAnalyticsResult, error) {
	return f.cached, nil
}
func (f *v12CatalogFake) SaveTemplateAnalytics(_ context.Context, _ string, _ string, result *model.ReportAnalyticsResult, _ time.Time) error {
	f.cached = result
	return nil
}
func (f *v12CatalogFake) InvalidateTemplateAnalytics(context.Context, string) error {
	f.cached = nil
	return nil
}

func TestReportV12AnalyticsUsesActualDatesWeightedScoresAndCache(t *testing.T) {
	catalog := &v12CatalogFake{reportRunnerCatalogFake: reportRunnerCatalogFake{
		report: &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1", QueryJSON: json.RawMessage(`{"fieldList":[{"name":"duid"}]}`), VisualizationJSON: json.RawMessage(`{"template":{"profile":"price_sensitive_v1_2"}}`)},
		source: &model.ReportDataSource{ID: "source-1", APIName: "price_sensitive_v1_2", Enabled: true},
	}}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{QueryID: "total-query", Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100, "total_order_count": 200}}},
		{QueryID: "score-query", Rows: []map[string]any{
			{"dt": "2026-09-09", "level": "LOW", "score_type": "PRIOR", "user_count": 30, "price_avg": 30, "price_n": 30, "d1_avg": nil, "d1_n": 0},
			{"dt": "2026-09-09", "level": "MEDIUM_HIGH", "score_type": "ORDER", "user_count": 10, "price_avg": 70, "price_n": 10, "d1_avg": 90, "d1_n": 5},
		}},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09", ReportAnalyticsOptions{Cities: []string{"北京"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.TotalUserCount != 100 || result.Summary.CalculatedUserShare != 40 || result.Summary.AveragePriceSensitivityScore != 40 {
		t.Fatalf("bad weighted aggregation: %+v", result.Summary)
	}
	if len(result.Trend) != 1 || len(result.MissingDates) != 6 || result.Trend[0].NullableScores["d2"] != nil || *result.Trend[0].NullableScores["d1"] != 90 {
		t.Fatalf("fabricated date or score: %+v", result)
	}
	if len(result.Distribution) != 2 || result.AssignedByType["PRIOR"] != 30 || len(result.QueryIDs) != 2 {
		t.Fatalf("lost real categories/provenance: %+v", result)
	}
	cached, err := runner.QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09", ReportAnalyticsOptions{Cities: []string{"北京"}})
	if err != nil || !cached.Cached || len(connector.queries) != 3 {
		t.Fatalf("cache not reused: %v", err)
	}
}

func TestReportTemplateExecutionDateUsesShanghaiDay(t *testing.T) {
	report := &model.ReportDefinition{QueryJSON: json.RawMessage(`{"conditionList":[{"name":"dt","value":"old"},{"name":"city_name","value":"北京"}]}`), VisualizationJSON: json.RawMessage(`{"template":{"partition_mode":"previous_day"}}`)}
	now := time.Date(2026, 9, 9, 20, 0, 0, 0, time.UTC)
	raw, err := reportExecutionQuery(report, now)
	if err != nil {
		t.Fatal(err)
	}
	var query struct {
		Conditions []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"conditionList"`
	}
	if err := json.Unmarshal(raw, &query); err != nil {
		t.Fatal(err)
	}
	if query.Conditions[1].Value != "2026-09-09" {
		t.Fatalf("wrong business day: %s", raw)
	}
}
