package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type provenanceCatalogFake struct {
	*v12CatalogFake
	executions []model.ReportQueryExecution
	contract   *model.ReportDataSourceContract
	saveError  error
}

func (f *provenanceCatalogFake) SaveTemplateAnalytics(ctx context.Context, key, id string, result *model.ReportAnalyticsResult, expires time.Time) error {
	if f.saveError != nil {
		return f.saveError
	}
	return f.v12CatalogFake.SaveTemplateAnalytics(ctx, key, id, result, expires)
}

func TestProvenanceSurvivesAnalyticsCacheWriteFailure(t *testing.T) {
	catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog(), saveError: errors.New("cache unavailable")}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, &reportConnectorFake{})
	if _, err := runner.QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09"); err == nil {
		t.Fatal("expected cache error")
	}
	svc := NewReportService(&provenanceServiceStoreFake{catalog: catalog}, &reportServiceUserStoreFake{admin: true}, runner)
	result, err := svc.GetProvenance(context.Background(), "report-1", "admin")
	if err != nil || len(result.Executions) != 3 {
		t.Fatalf("execution history lost after cache failure: %+v %v", result, err)
	}
	for _, execution := range result.Executions {
		if execution.Status != "succeeded" {
			t.Fatal("successful upstream execution was mislabeled")
		}
	}
}

func (f *provenanceCatalogFake) GetReportDataSourceContract(ctx context.Context, id string) (*model.ReportDataSourceContract, error) {
	if f.contract != nil {
		return f.contract, nil
	}
	return f.v12CatalogFake.GetReportDataSourceContract(ctx, id)
}
func (f *provenanceCatalogFake) AppendReportQueryExecution(_ context.Context, e *model.ReportQueryExecution) error {
	raw, _ := json.Marshal(e)
	var copy model.ReportQueryExecution
	_ = json.Unmarshal(raw, &copy)
	f.executions = append(f.executions, copy)
	return nil
}
func (f *provenanceCatalogFake) ListReportQueryExecutions(context.Context, string, int) ([]model.ReportQueryExecution, error) {
	return f.executions, nil
}
func (f *provenanceCatalogFake) GetReportQueryExecution(_ context.Context, reportID, id string) (*model.ReportQueryExecution, error) {
	for _, e := range f.executions {
		if e.ReportID == reportID && e.ID == id {
			return &e, nil
		}
	}
	return nil, nil
}

type provenanceServiceStoreFake struct {
	ReportStore
	catalog *provenanceCatalogFake
}

func (f *provenanceServiceStoreFake) GetReportDefinition(ctx context.Context, id string) (*model.ReportDefinition, error) {
	return f.catalog.GetReportDefinition(ctx, id)
}
func (f *provenanceServiceStoreFake) GetReportDataSourceContract(ctx context.Context, id string) (*model.ReportDataSourceContract, error) {
	return f.catalog.GetReportDataSourceContract(ctx, id)
}
func (f *provenanceServiceStoreFake) AppendReportQueryExecution(ctx context.Context, e *model.ReportQueryExecution) error {
	return f.catalog.AppendReportQueryExecution(ctx, e)
}
func (f *provenanceServiceStoreFake) ListReportQueryExecutions(ctx context.Context, id string, n int) ([]model.ReportQueryExecution, error) {
	return f.catalog.ListReportQueryExecutions(ctx, id, n)
}
func (f *provenanceServiceStoreFake) GetReportQueryExecution(ctx context.Context, id, execution string) (*model.ReportQueryExecution, error) {
	return f.catalog.GetReportQueryExecution(ctx, id, execution)
}

func TestProvenanceRecordsActualAggregatesAndCacheDoesNotExecute(t *testing.T) {
	ctx := context.Background()
	catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog()}
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{SQL: "SELECT count(duid) total_user_count FROM labels GROUP BY dt", QueryID: "q-totals", Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "LOW", "user_count": 40}}},
		{Rows: []map[string]any{}},
	}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryAnalytics(ctx, "report-1", "1d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewReportService(&provenanceServiceStoreFake{catalog: catalog}, &reportServiceUserStoreFake{admin: true}, runner)
	provenance, err := svc.GetProvenance(ctx, "report-1", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if len(provenance.Executions) != 3 || provenance.Executions[0].SQL == "" || provenance.Executions[0].QueryKey != "totals" || len(provenance.Executions[0].Bindings) != 8 {
		t.Fatalf("missing trace: %+v", provenance)
	}
	if provenance.Executions[1].SQL != "" {
		t.Fatal("fabricated SQL")
	}
	public, _ := json.Marshal(result)
	if strings.Contains(string(public), "SELECT") {
		t.Fatal("public SQL leak")
	}
	if _, err := runner.QueryAnalytics(ctx, "report-1", "1d", "2026-09-09"); err != nil {
		t.Fatal(err)
	}
	if len(connector.queries) != 3 || len(catalog.executions) != 3 {
		t.Fatal("cache triggered execution")
	}
	cachedBeforeReplay := catalog.cached
	if len(result.ExecutionIDs) != 3 {
		t.Fatal("analytics lost execution links")
	}
	replay, err := svc.ReplayProvenance(ctx, "report-1", "admin", catalog.executions[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.ReplayOnly || replay.Execution.ReplayOf == "" || len(catalog.executions) != 4 {
		t.Fatal("replay did not append independent result")
	}
	if catalog.cached != cachedBeforeReplay {
		t.Fatal("replay changed public cache")
	}
}

func TestProvenanceRejectsUntrustedReplayAndChangedContract(t *testing.T) {
	ctx := context.Background()
	catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog()}
	connector := &reportConnectorFake{}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	_, err := runner.QueryAnalytics(ctx, "report-1", "1d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewReportService(&provenanceServiceStoreFake{catalog: catalog}, &reportServiceUserStoreFake{admin: true}, runner)
	original := catalog.executions[0].RequestJSON
	catalog.executions[0].RequestJSON = json.RawMessage(`{"fieldList":[{"name":"duid"}],"endpoint":"https://attacker.invalid"}`)
	if _, err := svc.ReplayProvenance(ctx, "report-1", "admin", catalog.executions[0].ID); !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("detail replay accepted: %v", err)
	}
	catalog.executions[0].RequestJSON = original
	catalog.contract = v12Contract()
	for i := range catalog.contract.Fields {
		if catalog.contract.Fields[i].Name == "duid" {
			catalog.contract.Fields[i].Enabled = false
		}
	}
	if _, err := svc.ReplayProvenance(ctx, "report-1", "admin", catalog.executions[0].ID); err == nil {
		t.Fatal("disabled contract replay accepted")
	}
	if len(connector.queries) != 3 {
		t.Fatal("rejected replay reached connector")
	}
}

func TestProvenanceAllTrendIncludesUnassignedDependencies(t *testing.T) {
	catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog()}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, &reportConnectorFake{})
	svc := NewReportService(&provenanceServiceStoreFake{catalog: catalog}, &reportServiceUserStoreFake{admin: true}, runner)
	result, err := svc.GetProvenance(context.Background(), "report-1", "admin")
	if err != nil {
		t.Fatal(err)
	}
	for _, binding := range result.Bindings {
		if binding.ChartKey != "all_trend" {
			continue
		}
		if strings.Join(binding.QueryKeys, ",") != "totals,assigned_distribution" || !strings.Contains(binding.Formula, "UNASSIGNED=totals.total_user_count-SUM(assigned_distribution.user_count)") || binding.FieldMapping["total"] != "totals.total_user_count" || binding.FieldMapping["UNASSIGNED"] == "" {
			t.Fatalf("incomplete unassigned provenance: %+v", binding)
		}
		return
	}
	t.Fatal("missing all_trend binding")
}

func TestProvenanceFailedAndTruncatedQueriesAreSavedWithoutUsableRows(t *testing.T) {
	for _, test := range []struct {
		name   string
		result model.ReportQueryResult
		err    error
	}{
		{name: "truncated", result: model.ReportQueryResult{SQL: "SELECT count(duid)", Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 5}}, Pagination: model.ReportPagination{Total: 2}}},
		{name: "failure", err: errors.New("secret-signature request headers")},
		{name: "details", result: model.ReportQueryResult{Rows: []map[string]any{{"duid": "1234567"}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog()}
			connector := &reportConnectorFake{result: test.result, err: test.err}
			runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
			if _, err := runner.QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09"); err == nil {
				t.Fatal("bad aggregate accepted")
			}
			if len(catalog.executions) != 1 || catalog.executions[0].Status != "failed" || len(catalog.executions[0].Rows) != 0 || catalog.cached != nil {
				t.Fatalf("bad failure trace: %+v", catalog.executions)
			}
			raw, _ := json.Marshal(catalog.executions)
			if strings.Contains(string(raw), "secret-signature") || strings.Contains(string(raw), "1234567") {
				t.Fatal("sensitive detail persisted")
			}
		})
	}
}
