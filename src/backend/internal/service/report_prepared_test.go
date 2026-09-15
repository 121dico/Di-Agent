package service

import (
	"context"
	"errors"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"testing"
)

type preparedFake struct {
	*v12CatalogFake
	days     []model.ReportPreparedDay
	contract *model.ReportDataSourceContract
}

func (f *preparedFake) ListPreparedReportDays(context.Context, string) ([]model.ReportPreparedDay, error) {
	return f.days, nil
}
func (f *preparedFake) SavePreparedReportDay(_ context.Context, _, _ string, day *model.ReportPreparedDay) error {
	f.days = append(f.days, *day)
	return nil
}
func (f *preparedFake) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return f.contract, nil
}

func preparedFixture() model.ReportPreparedDay {
	return model.ReportPreparedDay{Date: "2026-09-14", Totals: []map[string]any{{"dt": "2026-09-14", "city": "北京", "total_user_count": 100, "total_order_count": 200}, {"dt": "2026-09-14", "city": "上海", "total_user_count": 50, "total_order_count": 100}}, Assigned: []map[string]any{{"dt": "2026-09-14", "city": "北京", "level": "VERY_HIGH", "user_count": 10, "price_avg": 80, "price_n": 10}, {"dt": "2026-09-14", "city": "上海", "level": "HIGH", "user_count": 20, "price_avg": 50, "price_n": 20}}, Groups: map[string][]map[string]any{"all": {{"dt": "2026-09-14", "city": "北京", "level": "VERY_HIGH", "user_count": 10}, {"dt": "2026-09-14", "city": "上海", "level": "HIGH", "user_count": 20}}, "1": {{"dt": "2026-09-14", "city": "北京", "level": "VERY_HIGH", "user_count": 3}}}}
}

func TestPreparedSelectionNeverQueriesUpstream(t *testing.T) {
	catalog := &preparedFake{boundaryV12Catalog(), []model.ReportPreparedDay{preparedFixture()}, v12Contract()}
	connector := &reportConnectorFake{err: errors.New("must never scan upstream")}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-14", "1", []string{"北京市"})
	if err != nil || result.OrderCohort.UserCount != 3 {
		t.Fatalf("北京一笔极高: %+v %v", result, err)
	}
	result, err = runner.QueryAnalytics(context.Background(), "report-1", "saved", "2026-09-14", ReportAnalyticsOptions{Cities: []string{"北京", "北京市", "上海市"}})
	if err != nil || !result.Prepared || result.Summary.TotalUserCount != 150 || result.Summary.AveragePriceSensitivityScore != 60 {
		t.Fatalf("multi-city weighted result: %+v %v", result, err)
	}
	if len(connector.queries) != 0 {
		t.Fatal("read issued upstream query")
	}
	catalog.contract.Fields[0].Enabled = false
	if _, err = runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-14", "1", nil); err == nil {
		t.Fatal("revoked contract bypassed")
	}
}

func TestPreparedMissingDayDoesNotBecomeZeroOrQuery(t *testing.T) {
	catalog := &preparedFake{boundaryV12Catalog(), []model.ReportPreparedDay{preparedFixture()}, v12Contract()}
	connector := &reportConnectorFake{}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", nil); err == nil {
		t.Fatal("missing day accepted")
	}
	if len(connector.queries) != 0 {
		t.Fatal("missing snapshot queried upstream")
	}
}

func TestPreparedRejectsDuplicatePages(t *testing.T) {
	row := map[string]any{"dt": "2026-09-14", "city": "北京", "level": "HIGH", "user_count": 1}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{{Rows: []map[string]any{row}, Pagination: model.ReportPagination{Total: 2, PageCount: 2}}, {Rows: []map[string]any{row}, Pagination: model.ReportPagination{Total: 2, PageCount: 2}}}}
	catalog := boundaryV12Catalog()
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	queries, _, _ := buildV12AggregateQueries(catalog.report, &model.ReportAnalyticsResult{StartDate: "2026-09-14", EndDate: "2026-09-14"}, nil)
	if _, _, err := runner.preparedRows(context.Background(), catalog.report, catalog.source, v12Contract(), "2026-09-14", "assigned_distribution", preparedCityQuery(queries[1])); err == nil {
		t.Fatal("duplicate page accepted")
	}
}
