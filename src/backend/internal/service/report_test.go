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

type reportServiceStoreFake struct {
	updated        *model.ReportDefinition
	createdSource  *model.ReportDataSource
	sourceContract *model.ReportDataSourceContract
	contracts      []model.ReportDataSourceContract
}

func (*reportServiceStoreFake) ListReportDataSources(context.Context) ([]model.ReportDataSource, error) {
	return nil, nil
}
func (f *reportServiceStoreFake) CreateReportDataSource(_ context.Context, source *model.ReportDataSource) error {
	f.createdSource = source
	return nil
}
func (*reportServiceStoreFake) GetReportDataSource(context.Context, string) (*model.ReportDataSource, error) {
	return &model.ReportDataSource{
		ID: "source-1", Name: "价敏接口", Endpoint: "https://example.internal/api/price_sensitive",
		APIName: "price_sensitive", AppKeyEnv: "REPORT_APP_KEY", SignatureEnv: "REPORT_SIGN", Enabled: true,
	}, nil
}
func (f *reportServiceStoreFake) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return f.sourceContract, nil
}
func (f *reportServiceStoreFake) ReplaceReportDataSourceContract(_ context.Context, contract *model.ReportDataSourceContract) error {
	f.sourceContract = contract
	return nil
}
func (f *reportServiceStoreFake) ListReportDataSourceContracts(context.Context) ([]model.ReportDataSourceContract, error) {
	return f.contracts, nil
}
func (*reportServiceStoreFake) ListReportDefinitions(context.Context) ([]model.ReportDefinition, error) {
	return nil, nil
}
func (*reportServiceStoreFake) ListEnabledReportDefinitions(context.Context) ([]model.ReportDefinition, error) {
	return nil, nil
}
func (*reportServiceStoreFake) CreateReportDefinition(context.Context, *model.ReportDefinition) error {
	return nil
}
func (f *reportServiceStoreFake) UpdateReportDefinition(_ context.Context, report *model.ReportDefinition) error {
	f.updated = report
	return nil
}
func (*reportServiceStoreFake) GetReportDefinition(context.Context, string) (*model.ReportDefinition, error) {
	return &model.ReportDefinition{ID: "report-1", DataSourceID: "source-1"}, nil
}
func (*reportServiceStoreFake) ListReportRuns(context.Context, string, int) ([]model.ReportRun, error) {
	return nil, nil
}
func (*reportServiceStoreFake) GetReportRun(context.Context, string) (*model.ReportRun, error) {
	return nil, nil
}

type reportServiceUserStoreFake struct{ admin bool }

func (f *reportServiceUserStoreFake) GetUserByID(context.Context, string) (*model.User, error) {
	return &model.User{ID: "user-1", IsAdmin: f.admin}, nil
}

type reportCredentialsConnectorFake struct{}

func (reportCredentialsConnectorFake) Query(context.Context, model.ReportDataSource, []byte) (model.ReportQueryResult, error) {
	return model.ReportQueryResult{}, ErrReportCredentialsMissing
}

func TestValidateFixedReportQueryRejectsExpression(t *testing.T) {
	err := validateFixedReportQuery(json.RawMessage(`{"fieldList":[{"expression":"count(distinct duid)"}]}`))
	if !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("expected ErrReportInvalid, got %v", err)
	}
}

func TestValidateFixedReportQueryAllowsApprovedAggregate(t *testing.T) {
	err := validateFixedReportQuery(json.RawMessage(`{"fieldList":[{"name":"duid","aggFunctionEnum":"COUNT DISTINCT"}]}`))
	if err != nil {
		t.Fatalf("expected approved aggregate, got %v", err)
	}
}

func TestReportServiceRejectsNonAdminOperationalAndFullDetailAccess(t *testing.T) {
	svc := NewReportService(&reportServiceStoreFake{}, &reportServiceUserStoreFake{admin: false}, nil)
	ctx := context.Background()
	_, sourcesErr := svc.ListSources(ctx, "user-1")
	_, runsErr := svc.ListRuns(ctx, "report-1", "user-1")
	_, pageErr := svc.QueryPage(ctx, "report-1", 1, 20, "user-1")
	_, runErr := svc.Run(ctx, "report-1", "user-1")
	checks := []struct {
		name string
		err  error
	}{
		{"list data sources", sourcesErr},
		{"list run history", runsErr},
		{"browse full detail", pageErr},
		{"run report", runErr},
	}
	for _, check := range checks {
		if !errors.Is(check.err, ErrReportForbidden) {
			t.Fatalf("%s: expected ErrReportForbidden, got %v", check.name, check.err)
		}
	}
}

func TestReportServiceCreatesDynamicSignedSourceWithoutStaticSignature(t *testing.T) {
	store := &reportServiceStoreFake{}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	created, err := svc.CreateSource(context.Background(), "user-1", model.ReportDataSource{
		Name:         "价敏接口",
		Endpoint:     "http://10.88.128.15:8000",
		APIName:      "price_sensitive",
		AppKeyEnv:    "REPORT_PRICE_APP_KEY",
		AppSecretEnv: "REPORT_PRICE_APP_SECRET",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("CreateSource returned error: %v", err)
	}
	if created.AppSecretEnv != "REPORT_PRICE_APP_SECRET" || created.SignatureEnv != "" {
		t.Fatalf("unexpected dynamic signing config: %#v", created)
	}
}

func TestReportServiceAllowsAdminToUpdateExistingDefinition(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: &model.ReportDataSourceContract{
		SourceID: "source-1",
		Fields:   []model.ReportFieldContract{{Name: "duid", DataType: "LONG", Enabled: true, Selectable: true}},
	}}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	updated, err := svc.UpdateDefinition(context.Background(), "user-1", "report-1", model.ReportDefinition{
		Name: "新版价格敏感度", Description: "管理员调整后的固定报表", DataSourceID: "source-1",
		QueryJSON:         json.RawMessage(`{"fieldList":[{"name":"duid"}]}`),
		VisualizationJSON: json.RawMessage(`{"analytics":{"enabled":true}}`), Enabled: true,
	})
	if err != nil {
		t.Fatalf("UpdateDefinition returned error: %v", err)
	}
	if store.updated == nil || updated.ID != "report-1" || updated.Name != "新版价格敏感度" {
		t.Fatalf("expected persisted report update, got %#v", updated)
	}
}

func TestReportServiceAdminCanSaveAndReadSourceContract(t *testing.T) {
	store := &reportServiceStoreFake{}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	input := model.ReportDataSourceContract{
		Description: "充电用户价敏标签，提供 DUID 粒度的价敏得分与分层结果。",
		APIExample:  `curl -X POST https://example.internal/api/price_sensitive`,
		HiveTable:   "ds_epower_platform_price_sensitive_41537",
		HiveExample: `SELECT duid FROM ds_epower_platform_price_sensitive_41537 LIMIT 10`,
		Fields: []model.ReportFieldContract{{
			Name: "duid", DataType: "LONG", Description: "滴滴用户 ID",
			Enabled: true, Selectable: true, Filterable: true, Sortable: true,
		}},
	}

	saved, err := svc.SaveSourceContract(context.Background(), "user-1", "source-1", input)
	if err != nil {
		t.Fatalf("SaveSourceContract returned error: %v", err)
	}
	loaded, err := svc.GetSourceContract(context.Background(), "user-1", "source-1")
	if err != nil {
		t.Fatalf("GetSourceContract returned error: %v", err)
	}
	if saved.SourceID != "source-1" || loaded.Description != input.Description || loaded.HiveTable != input.HiveTable || len(loaded.Fields) != 1 {
		t.Fatalf("expected persisted full source contract, saved=%#v loaded=%#v", saved, loaded)
	}
}

func TestReportServiceParsesHiveDDLAndPreservesExamples(t *testing.T) {
	store := &reportServiceStoreFake{}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	input := model.ReportDataSourceContract{
		APIExample:      `curl -X POST https://example.internal/api/price_sensitive`,
		ResponseExample: `{"resultCode":"0","data":{"data":[{"duid":1}]}}`,
		HiveTable:       "epower_platform.price_sensitive",
		HiveDDL: "CREATE EXTERNAL TABLE IF NOT EXISTS price_sensitive (\n" +
			"  `duid` bigint COMMENT '滴滴用户ID',\n" +
			"  `user_city_name` string COMMENT '用户城市名称',\n" +
			"  `price_sensitivity_score` double COMMENT '最终价格敏感分'\n" +
			") PARTITIONED BY (`dt` string COMMENT '标签观察日，格式yyyy-MM-dd')",
		HiveExample: `SELECT duid FROM ds_epower_platform_price_sensitive_41661 WHERE dt = '2026-08-26'`,
	}

	saved, err := svc.SaveSourceContract(context.Background(), "user-1", "source-1", input)
	if err != nil {
		t.Fatalf("SaveSourceContract returned error: %v", err)
	}
	if saved.ResponseExample != input.ResponseExample || saved.HiveDDL != input.HiveDDL {
		t.Fatalf("expected examples to be preserved, got %#v", saved)
	}
	if len(saved.Fields) != 4 {
		t.Fatalf("expected 4 parsed fields including dt, got %#v", saved.Fields)
	}
	byName := make(map[string]model.ReportFieldContract, len(saved.Fields))
	for _, field := range saved.Fields {
		byName[field.Name] = field
	}
	if byName["duid"].DataType != "BIGINT" || !byName["duid"].Aggregatable {
		t.Fatalf("expected numeric duid capabilities, got %#v", byName["duid"])
	}
	if byName["user_city_name"].Description != "用户城市名称" || byName["user_city_name"].Aggregatable {
		t.Fatalf("expected string field metadata, got %#v", byName["user_city_name"])
	}
	if !byName["dt"].Filterable || !byName["dt"].Groupable {
		t.Fatalf("expected partition field query capabilities, got %#v", byName["dt"])
	}
}

func TestReportServiceRejectsNonAdminFullSourceContractAccess(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: testReportSourceContract()}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: false}, nil)
	_, getErr := svc.GetSourceContract(context.Background(), "user-1", "source-1")
	_, saveErr := svc.SaveSourceContract(context.Background(), "user-1", "source-1", *testReportSourceContract())
	if !errors.Is(getErr, ErrReportForbidden) || !errors.Is(saveErr, ErrReportForbidden) {
		t.Fatalf("expected full contract access to require admin, get=%v save=%v", getErr, saveErr)
	}
}

func TestReportServiceListsSanitizedAgentContracts(t *testing.T) {
	store := &reportServiceStoreFake{contracts: []model.ReportDataSourceContract{{
		SourceID: "source-1", Name: "价敏数据", Description: "充电用户价敏标签", Endpoint: "https://secret.internal/api",
		APIName: "price_sensitive", AppKeyEnv: "SECRET_APP_KEY", SignatureEnv: "SECRET_SIGN",
		APIExample: "curl with a private sign", ResponseExample: "private response payload",
		HiveTable: "secret_hive_table", HiveDDL: "CREATE TABLE private_schema", HiveExample: "SELECT secret",
		Fields: []model.ReportFieldContract{
			{Name: "duid", DataType: "LONG", Description: "用户 ID", Enabled: true, Selectable: true, Filterable: true, Sortable: true},
			{Name: "disabled_score", DataType: "DOUBLE", Enabled: false, Selectable: true},
			{Name: "private_phone", DataType: "STRING", Sensitive: true, Enabled: true, Selectable: true},
		},
	}}}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: false}, nil)

	catalog, err := svc.ListAgentContracts(context.Background())
	if err != nil {
		t.Fatalf("ListAgentContracts returned error: %v", err)
	}
	if len(catalog) != 1 || len(catalog[0].Fields) != 1 || catalog[0].Fields[0].Name != "duid" {
		t.Fatalf("expected only enabled non-sensitive fields, got %#v", catalog)
	}
	if catalog[0].Description != "充电用户价敏标签" {
		t.Fatalf("expected sanitized source purpose, got %#v", catalog[0])
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		t.Fatalf("marshal sanitized catalog: %v", err)
	}
	for _, forbidden := range []string{"secret.internal", "price_sensitive", "SECRET_APP_KEY", "SECRET_SIGN", "secret_hive_table", "private sign", "private response", "private_schema", "SELECT secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("sanitized catalog leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestReportServiceQueriesApprovedAgentFieldsWithServerSidePagination(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: &model.ReportDataSourceContract{
		SourceID: "source-1",
		Name:     "价敏数据",
		Enabled:  true,
		Fields: []model.ReportFieldContract{
			{Name: "city_id", DataType: "LONG", Enabled: true, Selectable: true, Filterable: true, Groupable: true, Sortable: true},
			{Name: "price_score", DataType: "DOUBLE", Enabled: true, Selectable: true, Aggregatable: true},
		},
	}}
	connector := &reportConnectorFake{result: model.ReportQueryResult{
		Rows:       []map[string]any{{"city_id": float64(1), "avg_price_score": float64(72.5)}},
		Pagination: model.ReportPagination{Total: 1, Page: 1, PageSize: 100, PageCount: 1},
		Partition:  "2026-08-27",
		QueryID:    "query-agent-1",
		Duration:   25 * time.Millisecond,
	}}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: false}, runner)

	result, err := svc.QueryAgentData(context.Background(), model.ReportAgentQueryRequest{
		SourceID: "source-1",
		Fields: []model.ReportAgentQueryField{
			{Name: "city_id"},
			{Name: "price_score", Alias: "avg_price_score", Aggregation: "AVG"},
		},
		Filters:  []model.ReportAgentQueryFilter{{Name: "city_id", Operator: "EQ", Value: float64(1)}},
		GroupBy:  []string{"city_id"},
		OrderBy:  "city_id",
		Page:     1,
		PageSize: 500,
	})
	if err != nil {
		t.Fatalf("QueryAgentData returned error: %v", err)
	}
	if result.SourceID != "source-1" || result.SourceName != "价敏数据" || result.QueryID != "query-agent-1" {
		t.Fatalf("unexpected result metadata: %#v", result)
	}
	var query map[string]any
	if err := json.Unmarshal(connector.query, &query); err != nil {
		t.Fatalf("decode connector query: %v", err)
	}
	if query["pageSize"] != float64(100) || query["needPagination"] != true || query["apiName"] != "price_sensitive" {
		t.Fatalf("expected bounded paginated query, got %s", connector.query)
	}
}

func TestReportServiceAgentQueryNormalizesLiveUpstreamAggregateAndSortDirection(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: &model.ReportDataSourceContract{
		SourceID: "source-1",
		Name:     "价敏数据",
		Enabled:  true,
		Fields: []model.ReportFieldContract{
			{Name: "duid", DataType: "LONG", Enabled: true, Selectable: true, Aggregatable: true},
			{Name: "dt", DataType: "STRING", Enabled: true, Selectable: true, Groupable: true, Sortable: true},
		},
	}}
	connector := &reportConnectorFake{result: model.ReportQueryResult{QueryID: "query-agent-sort"}}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	svc := NewReportService(store, &reportServiceUserStoreFake{}, runner)

	_, err := svc.QueryAgentData(context.Background(), model.ReportAgentQueryRequest{
		SourceID: "source-1",
		Fields: []model.ReportAgentQueryField{
			{Name: "duid", Alias: "user_count", Aggregation: "COUNT_DISTINCT"},
			{Name: "dt"},
		},
		GroupBy: []string{"dt"},
		OrderBy: "dt DESC",
	})
	if err != nil {
		t.Fatalf("QueryAgentData returned error: %v", err)
	}

	var query struct {
		FieldList []struct {
			Name        string `json:"name"`
			Aggregation string `json:"aggFunctionEnum"`
		} `json:"fieldList"`
		OrderBy string `json:"orderBy"`
	}
	if err := json.Unmarshal(connector.query, &query); err != nil {
		t.Fatalf("decode connector query: %v", err)
	}
	if query.FieldList[0].Aggregation != "COUNT_DISTINCT" {
		t.Fatalf("live upstream aggregation = %q, want COUNT_DISTINCT", query.FieldList[0].Aggregation)
	}
	if query.OrderBy != "dt DESC" {
		t.Fatalf("live upstream orderBy = %q, want dt DESC", query.OrderBy)
	}
}

func TestReportServiceAgentQueryRejectsSensitiveOrUndeclaredFields(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: &model.ReportDataSourceContract{
		SourceID: "source-1",
		Enabled:  true,
		Fields: []model.ReportFieldContract{
			{Name: "private_phone", DataType: "STRING", Sensitive: true, Enabled: true, Selectable: true},
		},
	}}
	connector := &reportConnectorFake{}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: false}, runner)

	for _, field := range []string{"private_phone", "not_declared"} {
		_, err := svc.QueryAgentData(context.Background(), model.ReportAgentQueryRequest{
			SourceID: "source-1",
			Fields:   []model.ReportAgentQueryField{{Name: field}},
		})
		if !errors.Is(err, ErrReportInvalid) {
			t.Fatalf("field %s: expected ErrReportInvalid, got %v", field, err)
		}
	}
	if len(connector.queries) != 0 {
		t.Fatalf("connector must not be called for rejected fields, got %d queries", len(connector.queries))
	}
}

func TestReportServiceAgentQueryPreservesMissingCredentialsError(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: &model.ReportDataSourceContract{
		SourceID: "source-1", Name: "价敏数据", Enabled: true,
		Fields: []model.ReportFieldContract{{Name: "duid", DataType: "LONG", Enabled: true, Selectable: true}},
	}}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, reportCredentialsConnectorFake{})
	svc := NewReportService(store, &reportServiceUserStoreFake{}, runner)
	_, err := svc.QueryAgentData(context.Background(), model.ReportAgentQueryRequest{
		SourceID: "source-1", Fields: []model.ReportAgentQueryField{{Name: "duid"}},
	})
	if !errors.Is(err, ErrReportCredentialsMissing) {
		t.Fatalf("expected missing credentials sentinel, got %v", err)
	}
}

func TestReportServiceCreateDefinitionRejectsUndeclaredField(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: testReportSourceContract()}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	_, err := svc.CreateDefinition(context.Background(), "user-1", model.ReportDefinition{
		Name: "越权字段报表", DataSourceID: "source-1",
		QueryJSON:         json.RawMessage(`{"fieldList":[{"name":"undeclared_score"}]}`),
		VisualizationJSON: json.RawMessage(`{}`),
	})
	if !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("expected undeclared field to be rejected, got %v", err)
	}
}

func TestReportServiceUpdateDefinitionRejectsDisabledOrIncapableFields(t *testing.T) {
	tests := []struct {
		name  string
		query json.RawMessage
	}{
		{"disabled field", json.RawMessage(`{"fieldList":[{"name":"disabled_score"}]}`)},
		{"non-filterable field", json.RawMessage(`{"fieldList":[{"name":"duid"}],"conditionList":[{"name":"duid","operatorEnum":"EQ","value":"1"}]}`)},
		{"non-aggregatable field", json.RawMessage(`{"fieldList":[{"name":"duid","aggFunctionEnum":"COUNT"}]}`)},
		{"non-groupable field", json.RawMessage(`{"fieldList":[{"name":"duid"}],"groupList":["duid"]}`)},
		{"non-sortable field", json.RawMessage(`{"fieldList":[{"name":"duid"}],"orderBy":"duid"}`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &reportServiceStoreFake{sourceContract: testReportSourceContract()}
			svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
			_, err := svc.UpdateDefinition(context.Background(), "user-1", "report-1", model.ReportDefinition{
				Name: "非法修改", DataSourceID: "source-1", QueryJSON: tt.query,
				VisualizationJSON: json.RawMessage(`{}`),
			})
			if !errors.Is(err, ErrReportInvalid) {
				t.Fatalf("expected contract violation to be rejected, got %v", err)
			}
		})
	}
}

func TestReportServiceCreateDefinitionAcceptsDeclaredCapabilities(t *testing.T) {
	store := &reportServiceStoreFake{sourceContract: testReportSourceContract()}
	svc := NewReportService(store, &reportServiceUserStoreFake{admin: true}, nil)
	_, err := svc.CreateDefinition(context.Background(), "user-1", model.ReportDefinition{
		Name: "合法聚合报表", DataSourceID: "source-1",
		QueryJSON: json.RawMessage(`{
			"fieldList":[{"name":"price_score","alias":"avg_price_score","aggFunctionEnum":"AVG"}],
			"groupList":["city_id"],
			"orderBy":"city_id"
		}`),
		VisualizationJSON: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("expected declared capabilities to pass, got %v", err)
	}
}

func testReportSourceContract() *model.ReportDataSourceContract {
	return &model.ReportDataSourceContract{SourceID: "source-1", Fields: []model.ReportFieldContract{
		{Name: "duid", DataType: "LONG", Enabled: true, Selectable: true},
		{Name: "disabled_score", DataType: "DOUBLE", Enabled: false, Selectable: true},
		{Name: "price_score", DataType: "DOUBLE", Enabled: true, Selectable: true, Aggregatable: true},
		{Name: "city_id", DataType: "LONG", Enabled: true, Selectable: true, Groupable: true, Sortable: true},
	}}
}
