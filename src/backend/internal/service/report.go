package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/agent-hub/backend/internal/model"
)

var (
	ErrReportForbidden          = errors.New("需要管理员权限")
	ErrReportInvalid            = errors.New("报表配置无效")
	ErrReportCredentialsMissing = errors.New("报表数据源认证尚未配置")
)

type ReportStore interface {
	ListReportDataSources(ctx context.Context) ([]model.ReportDataSource, error)
	CreateReportDataSource(ctx context.Context, source *model.ReportDataSource) error
	GetReportDataSource(ctx context.Context, id string) (*model.ReportDataSource, error)
	GetReportDataSourceContract(ctx context.Context, sourceID string) (*model.ReportDataSourceContract, error)
	ReplaceReportDataSourceContract(ctx context.Context, contract *model.ReportDataSourceContract) error
	ListReportDataSourceContracts(ctx context.Context) ([]model.ReportDataSourceContract, error)
	ListReportDefinitions(ctx context.Context) ([]model.ReportDefinition, error)
	ListEnabledReportDefinitions(ctx context.Context) ([]model.ReportDefinition, error)
	CreateReportDefinition(ctx context.Context, report *model.ReportDefinition) error
	UpdateReportDefinition(ctx context.Context, report *model.ReportDefinition) error
	GetReportDefinition(ctx context.Context, id string) (*model.ReportDefinition, error)
	ListReportRuns(ctx context.Context, reportID string, limit int) ([]model.ReportRun, error)
	GetReportRun(ctx context.Context, id string) (*model.ReportRun, error)
}

type ReportUserStore interface {
	GetUserByID(ctx context.Context, id string) (*model.User, error)
}

type ReportService struct {
	store  ReportStore
	users  ReportUserStore
	runner *ReportRunner
}

func NewReportService(store ReportStore, users ReportUserStore, runner *ReportRunner) *ReportService {
	return &ReportService{store: store, users: users, runner: runner}
}

func (s *ReportService) requireAdmin(ctx context.Context, userID string) error {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("get report operator: %w", err)
	}
	if user == nil || !user.IsAdmin {
		return ErrReportForbidden
	}
	return nil
}

func (s *ReportService) ListSources(ctx context.Context, userID string) ([]model.ReportDataSource, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	return s.store.ListReportDataSources(ctx)
}

func (s *ReportService) CreateSource(ctx context.Context, userID string, source model.ReportDataSource) (*model.ReportDataSource, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	source.Name, source.Description = strings.TrimSpace(source.Name), strings.TrimSpace(source.Description)
	source.Endpoint, source.APIName = strings.TrimSpace(source.Endpoint), strings.TrimSpace(source.APIName)
	source.AppKeyEnv = strings.TrimSpace(source.AppKeyEnv)
	source.AppSecretEnv = strings.TrimSpace(source.AppSecretEnv)
	source.SignatureEnv = strings.TrimSpace(source.SignatureEnv)
	source.XDateEnv = strings.TrimSpace(source.XDateEnv)
	parsed, err := url.Parse(source.Endpoint)
	if source.Name == "" || source.APIName == "" || err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, ErrReportInvalid
	}
	if source.AppKeyEnv == "" || (source.AppSecretEnv == "" && source.SignatureEnv == "") {
		return nil, fmt.Errorf("%w: 认证环境变量名称不能为空", ErrReportInvalid)
	}
	source.CreatedBy = userID
	if err := s.store.CreateReportDataSource(ctx, &source); err != nil {
		return nil, fmt.Errorf("create report source: %w", err)
	}
	return &source, nil
}

func (s *ReportService) GetSourceContract(ctx context.Context, userID, sourceID string) (*model.ReportDataSourceContract, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("get report source contract: %w", err)
	}
	if contract == nil {
		return nil, ErrReportSourceMissing
	}
	return contract, nil
}

func (s *ReportService) SaveSourceContract(ctx context.Context, userID, sourceID string, input model.ReportDataSourceContract) (*model.ReportDataSourceContract, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	source, err := s.store.GetReportDataSource(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("get report source: %w", err)
	}
	if source == nil {
		return nil, ErrReportSourceMissing
	}

	input.SourceID = sourceID
	input.Name = firstNonEmpty(strings.TrimSpace(input.Name), source.Name)
	input.Description = firstNonEmpty(strings.TrimSpace(input.Description), source.Description)
	input.Endpoint = firstNonEmpty(strings.TrimSpace(input.Endpoint), source.Endpoint)
	input.APIName = firstNonEmpty(strings.TrimSpace(input.APIName), source.APIName)
	input.AppKeyEnv = firstNonEmpty(strings.TrimSpace(input.AppKeyEnv), source.AppKeyEnv)
	input.AppSecretEnv = firstNonEmpty(strings.TrimSpace(input.AppSecretEnv), source.AppSecretEnv)
	input.SignatureEnv = firstNonEmpty(strings.TrimSpace(input.SignatureEnv), source.SignatureEnv)
	input.XDateEnv = firstNonEmpty(strings.TrimSpace(input.XDateEnv), source.XDateEnv)
	input.APIExample = strings.TrimSpace(input.APIExample)
	input.ResponseExample = strings.TrimSpace(input.ResponseExample)
	input.HiveTable = strings.TrimSpace(input.HiveTable)
	input.HiveDDL = strings.TrimSpace(input.HiveDDL)
	input.HiveExample = strings.TrimSpace(input.HiveExample)
	input.Enabled = source.Enabled
	if len(input.Fields) == 0 && input.HiveDDL != "" {
		input.Fields = parseHiveDDLFields(input.HiveDDL)
	}
	if err := validateSourceContract(&input); err != nil {
		return nil, err
	}
	if err := s.store.ReplaceReportDataSourceContract(ctx, &input); err != nil {
		return nil, fmt.Errorf("save report source contract: %w", err)
	}
	return &input, nil
}

var hiveDDLFieldPattern = regexp.MustCompile("(?i)`([^`]+)`\\s+([a-z]+(?:\\s*\\([^)]*\\))?)(?:\\s+COMMENT\\s+'([^']*)')?")

func parseHiveDDLFields(ddl string) []model.ReportFieldContract {
	matches := hiveDDLFieldPattern.FindAllStringSubmatch(ddl, -1)
	fields := make([]model.ReportFieldContract, 0, len(matches))
	seen := make(map[string]bool, len(matches))
	for _, match := range matches {
		name := strings.TrimSpace(match[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		dataType := strings.ToUpper(strings.Join(strings.Fields(match[2]), ""))
		fields = append(fields, model.ReportFieldContract{
			Name: name, DataType: dataType, Description: strings.TrimSpace(match[3]),
			Enabled: true, Selectable: true, Filterable: true, Groupable: true,
			Aggregatable: isNumericHiveType(dataType), Sortable: true,
		})
	}
	return fields
}

func isNumericHiveType(dataType string) bool {
	base := strings.ToUpper(strings.TrimSpace(dataType))
	if index := strings.IndexByte(base, '('); index >= 0 {
		base = base[:index]
	}
	switch base {
	case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "LONG", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC":
		return true
	default:
		return false
	}
}

func (s *ReportService) ListAgentContracts(ctx context.Context) ([]model.ReportAgentContract, error) {
	contracts, err := s.store.ListReportDataSourceContracts(ctx)
	if err != nil {
		return nil, fmt.Errorf("list report agent contracts: %w", err)
	}
	catalog := make([]model.ReportAgentContract, 0, len(contracts))
	for _, contract := range contracts {
		entry := model.ReportAgentContract{SourceID: contract.SourceID, Name: contract.Name, Description: contract.Description}
		for _, field := range contract.Fields {
			if !field.Enabled || field.Sensitive {
				continue
			}
			capabilities := fieldCapabilities(field)
			if len(capabilities) == 0 {
				continue
			}
			entry.Fields = append(entry.Fields, model.ReportAgentFieldContract{
				Name: field.Name, DataType: field.DataType, Label: field.Label,
				Description: field.Description, Capabilities: capabilities,
			})
		}
		catalog = append(catalog, entry)
	}
	return catalog, nil
}

var reportAgentOperators = map[string]bool{
	"EQ": true, "NEQ": true, "IN": true, "NOT_IN": true,
	"GEQ": true, "LEQ": true, "GQ": true, "LQ": true,
	"LIKE": true, "IS_NULL": true, "BETWEEN": true, "NOT_BETWEEN": true,
	"NOT_NULL": true, "PREFIX": true, "SUFFIX": true,
}

var reportAgentAggregations = map[string]bool{
	"": true, "AVG": true, "MIN": true, "MAX": true, "SUM": true,
	"COUNT": true, "COUNT DISTINCT": true,
}

var reportAgentAliasPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

// QueryAgentData executes a real upstream query through a deliberately small
// DSL. Physical endpoints, Hive metadata and credentials never cross this seam.
func (s *ReportService) QueryAgentData(ctx context.Context, request model.ReportAgentQueryRequest) (*model.ReportAgentQueryResult, error) {
	request.SourceID = strings.TrimSpace(request.SourceID)
	if request.SourceID == "" || len(request.Fields) == 0 || len(request.Fields) > 30 {
		return nil, fmt.Errorf("%w: 数据源和 1 至 30 个查询字段为必填", ErrReportInvalid)
	}
	if s.runner == nil || s.runner.connector == nil {
		return nil, fmt.Errorf("report connector is not configured")
	}
	source, err := s.store.GetReportDataSource(ctx, request.SourceID)
	if err != nil {
		return nil, fmt.Errorf("get report data source: %w", err)
	}
	if source == nil || !source.Enabled {
		return nil, ErrReportSourceMissing
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, request.SourceID)
	if err != nil {
		return nil, fmt.Errorf("get report field contract: %w", err)
	}
	if contract == nil || !contract.Enabled {
		return nil, ErrReportSourceMissing
	}

	available := make(map[string]model.ReportFieldContract, len(contract.Fields))
	for _, field := range contract.Fields {
		if field.Enabled && !field.Sensitive {
			available[field.Name] = field
		}
	}
	fieldList := make([]map[string]any, 0, len(request.Fields))
	for _, requested := range request.Fields {
		name := strings.TrimSpace(requested.Name)
		field, fieldErr := requireReportFieldCapability(available, name, "select")
		if fieldErr != nil {
			return nil, fieldErr
		}
		aggregation := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(requested.Aggregation), "_", " "))
		if !reportAgentAggregations[aggregation] {
			return nil, fmt.Errorf("%w: 聚合函数 %s 不受支持", ErrReportInvalid, aggregation)
		}
		if aggregation != "" && !field.Aggregatable {
			return nil, fmt.Errorf("%w: 字段 %s 不允许聚合", ErrReportInvalid, name)
		}
		entry := map[string]any{"name": name}
		if alias := strings.TrimSpace(requested.Alias); alias != "" {
			if !reportAgentAliasPattern.MatchString(alias) {
				return nil, fmt.Errorf("%w: 字段别名只允许 1 至 64 位英文、数字和下划线", ErrReportInvalid)
			}
			entry["alias"] = alias
		}
		if aggregation != "" {
			entry["aggFunctionEnum"] = reportUpstreamAggregation(aggregation)
		}
		fieldList = append(fieldList, entry)
	}

	conditionList := make([]map[string]any, 0, len(request.Filters))
	for _, filter := range request.Filters {
		name := strings.TrimSpace(filter.Name)
		if _, fieldErr := requireReportFieldCapability(available, name, "filter"); fieldErr != nil {
			return nil, fieldErr
		}
		operator := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(filter.Operator), " ", "_"))
		if !reportAgentOperators[operator] {
			return nil, fmt.Errorf("%w: 过滤操作符 %s 不受支持", ErrReportInvalid, operator)
		}
		conditionList = append(conditionList, map[string]any{"name": name, "operatorEnum": operator, "value": filter.Value})
	}

	groupList := make([]string, 0, len(request.GroupBy))
	for _, rawName := range request.GroupBy {
		name := strings.TrimSpace(rawName)
		if _, fieldErr := requireReportFieldCapability(available, name, "group"); fieldErr != nil {
			return nil, fieldErr
		}
		groupList = append(groupList, name)
	}
	orderField, orderBy, err := normalizeReportOrderBy(request.OrderBy)
	if err != nil {
		return nil, err
	}
	if orderField != "" {
		if _, fieldErr := requireReportFieldCapability(available, orderField, "sort"); fieldErr != nil {
			return nil, fieldErr
		}
	}
	page := request.Page
	if page < 1 {
		page = 1
	}
	pageSize := request.PageSize
	if pageSize < 1 {
		pageSize = 20
	} else if pageSize > 100 {
		pageSize = 100
	}
	payload := map[string]any{
		"apiName": source.APIName, "fieldList": fieldList, "conditionList": conditionList,
		"groupList": groupList, "needPagination": true, "page": page, "pageSize": pageSize,
	}
	if orderBy != "" {
		payload["orderBy"] = orderBy
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode agent report query: %w", err)
	}
	upstream, err := s.runner.connector.Query(ctx, *source, encoded)
	if err != nil {
		return nil, err
	}
	return &model.ReportAgentQueryResult{
		SourceID: request.SourceID, SourceName: contract.Name, Rows: upstream.Rows,
		Pagination: upstream.Pagination, SourcePartition: upstream.Partition,
		QueryID: upstream.QueryID, DurationMS: upstream.Duration.Milliseconds(),
	}, nil
}

func reportUpstreamAggregation(aggregation string) string {
	if aggregation == "COUNT DISTINCT" {
		return "COUNT_DISTINCT"
	}
	return aggregation
}

func normalizeReportOrderBy(value string) (string, string, error) {
	parts := strings.Fields(value)
	if len(parts) == 0 {
		return "", "", nil
	}
	if len(parts) > 2 {
		return "", "", fmt.Errorf("%w: 排序格式应为字段名或字段名加 ASC/DESC", ErrReportInvalid)
	}
	direction := ""
	if len(parts) == 2 {
		direction = strings.ToUpper(parts[1])
		if direction != "ASC" && direction != "DESC" {
			return "", "", fmt.Errorf("%w: 排序方向仅支持 ASC 或 DESC", ErrReportInvalid)
		}
	}
	normalized := parts[0]
	if direction != "" {
		normalized += " " + direction
	}
	return parts[0], normalized, nil
}

func fieldCapabilities(field model.ReportFieldContract) []string {
	capabilities := make([]string, 0, 5)
	if field.Selectable {
		capabilities = append(capabilities, "select")
	}
	if field.Filterable {
		capabilities = append(capabilities, "filter")
	}
	if field.Groupable {
		capabilities = append(capabilities, "group")
	}
	if field.Aggregatable {
		capabilities = append(capabilities, "aggregate")
	}
	if field.Sortable {
		capabilities = append(capabilities, "sort")
	}
	return capabilities
}

func firstNonEmpty(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func validateSourceContract(contract *model.ReportDataSourceContract) error {
	parsed, err := url.Parse(contract.Endpoint)
	if contract.Name == "" || contract.APIName == "" || err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("%w: 数据源 API 配置无效", ErrReportInvalid)
	}
	if contract.HiveTable == "" {
		return fmt.Errorf("%w: Hive 表名不能为空", ErrReportInvalid)
	}
	if contract.AppKeyEnv == "" || (contract.AppSecretEnv == "" && contract.SignatureEnv == "") {
		return fmt.Errorf("%w: 认证环境变量名称不能为空", ErrReportInvalid)
	}
	if len(contract.Fields) == 0 {
		return fmt.Errorf("%w: 至少声明一个可调用字段", ErrReportInvalid)
	}
	seen := make(map[string]bool, len(contract.Fields))
	for i := range contract.Fields {
		field := &contract.Fields[i]
		field.Name = strings.TrimSpace(field.Name)
		field.DataType = strings.ToUpper(strings.TrimSpace(field.DataType))
		field.Label = strings.TrimSpace(field.Label)
		field.Description = strings.TrimSpace(field.Description)
		if field.Name == "" || field.DataType == "" || seen[field.Name] {
			return fmt.Errorf("%w: 字段名称和类型不能为空且名称不能重复", ErrReportInvalid)
		}
		seen[field.Name] = true
		field.DataSourceID = contract.SourceID
	}
	return nil
}

func (s *ReportService) ListDefinitions(ctx context.Context) ([]model.ReportDefinition, error) {
	return s.store.ListReportDefinitions(ctx)
}

func (s *ReportService) CreateDefinition(ctx context.Context, userID string, report model.ReportDefinition) (*model.ReportDefinition, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(report.Name) == "" || report.DataSourceID == "" || !json.Valid(report.QueryJSON) || !json.Valid(report.VisualizationJSON) {
		return nil, ErrReportInvalid
	}
	if err := validateFixedReportQuery(report.QueryJSON); err != nil {
		return nil, err
	}
	if source, err := s.store.GetReportDataSource(ctx, report.DataSourceID); err != nil {
		return nil, err
	} else if source == nil {
		return nil, ErrReportSourceMissing
	}
	if err := s.validateDefinitionContract(ctx, report.DataSourceID, report.QueryJSON); err != nil {
		return nil, err
	}
	report.CreatedBy = userID
	if err := s.store.CreateReportDefinition(ctx, &report); err != nil {
		return nil, fmt.Errorf("create report definition: %w", err)
	}
	return &report, nil
}

func (s *ReportService) UpdateDefinition(ctx context.Context, userID, reportID string, report model.ReportDefinition) (*model.ReportDefinition, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	existing, err := s.store.GetReportDefinition(ctx, reportID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrReportNotFound
	}
	if strings.TrimSpace(report.Name) == "" || report.DataSourceID == "" || !json.Valid(report.QueryJSON) || !json.Valid(report.VisualizationJSON) {
		return nil, ErrReportInvalid
	}
	if err := validateFixedReportQuery(report.QueryJSON); err != nil {
		return nil, err
	}
	if source, err := s.store.GetReportDataSource(ctx, report.DataSourceID); err != nil {
		return nil, err
	} else if source == nil {
		return nil, ErrReportSourceMissing
	}
	if err := s.validateDefinitionContract(ctx, report.DataSourceID, report.QueryJSON); err != nil {
		return nil, err
	}
	report.ID = existing.ID
	report.CreatedBy = existing.CreatedBy
	report.CreatedAt = existing.CreatedAt
	if err := s.store.UpdateReportDefinition(ctx, &report); err != nil {
		return nil, fmt.Errorf("update report definition: %w", err)
	}
	return &report, nil
}

func (s *ReportService) Run(ctx context.Context, reportID, userID string) (*model.ReportRun, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	return s.runner.Run(ctx, reportID, "manual", userID)
}

func (s *ReportService) ListRuns(ctx context.Context, reportID, userID string) ([]model.ReportRun, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	return s.store.ListReportRuns(ctx, reportID, 30)
}

func (s *ReportService) QueryPage(ctx context.Context, reportID string, page, pageSize int, userID string) (*model.ReportPageResult, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	return s.runner.QueryPage(ctx, reportID, page, pageSize)
}

func (s *ReportService) QuerySearch(ctx context.Context, reportID, duid string) (*model.ReportPageResult, error) {
	return s.runner.QuerySearch(ctx, reportID, duid)
}

func (s *ReportService) QueryAnalytics(ctx context.Context, reportID, rangeKey, endDate string, cities []string) (*model.ReportAnalyticsResult, error) {
	return s.runner.QueryAnalytics(ctx, reportID, rangeKey, endDate, ReportAnalyticsOptions{Cities: cities})
}

func (s *ReportService) GetRun(ctx context.Context, id, userID string) (*model.ReportRun, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	return s.store.GetReportRun(ctx, id)
}

func (s *ReportService) EnabledDefinitions(ctx context.Context) ([]model.ReportDefinition, error) {
	return s.store.ListEnabledReportDefinitions(ctx)
}

func validateFixedReportQuery(raw json.RawMessage) error {
	var query map[string]any
	if err := json.Unmarshal(raw, &query); err != nil {
		return fmt.Errorf("%w: 查询配置必须是 JSON 对象", ErrReportInvalid)
	}
	allowedAggregates := map[string]bool{"": true, "AVG": true, "MIN": true, "MAX": true, "SUM": true, "COUNT": true, "COUNT DISTINCT": true, "COUNT_DISTINCT": true}
	var validate func(map[string]any) error
	validate = func(current map[string]any) error {
		if fields, ok := current["fieldList"].([]any); ok {
			for _, item := range fields {
				field, ok := item.(map[string]any)
				if !ok {
					return fmt.Errorf("%w: fieldList 格式错误", ErrReportInvalid)
				}
				if expression, _ := field["expression"].(string); strings.TrimSpace(expression) != "" {
					return fmt.Errorf("%w: MVP 不允许 expression", ErrReportInvalid)
				}
				aggregate, _ := field["aggFunctionEnum"].(string)
				if !allowedAggregates[strings.ToUpper(strings.TrimSpace(aggregate))] {
					return fmt.Errorf("%w: 聚合函数不受支持", ErrReportInvalid)
				}
			}
		}
		if nested, ok := current["postQueryDTO"].(map[string]any); ok {
			return validate(nested)
		}
		return nil
	}
	return validate(query)
}

func (s *ReportService) validateDefinitionContract(ctx context.Context, sourceID string, raw json.RawMessage) error {
	contract, err := s.store.GetReportDataSourceContract(ctx, sourceID)
	if err != nil {
		return fmt.Errorf("get report field contract: %w", err)
	}
	if contract == nil || len(contract.Fields) == 0 {
		return fmt.Errorf("%w: 数据源尚未配置字段白名单", ErrReportInvalid)
	}
	fields := make(map[string]model.ReportFieldContract, len(contract.Fields))
	for _, field := range contract.Fields {
		fields[field.Name] = field
	}
	var query map[string]any
	if err := json.Unmarshal(raw, &query); err != nil {
		return fmt.Errorf("%w: 查询配置必须是 JSON 对象", ErrReportInvalid)
	}
	return validateQueryContractLevel(query, fields)
}

func validateQueryContractLevel(query map[string]any, available map[string]model.ReportFieldContract) error {
	outputs := make(map[string]model.ReportFieldContract)
	if rawFields, exists := query["fieldList"]; exists && rawFields != nil {
		fields, ok := rawFields.([]any)
		if !ok {
			return fmt.Errorf("%w: fieldList 格式错误", ErrReportInvalid)
		}
		for _, item := range fields {
			fieldConfig, ok := item.(map[string]any)
			if !ok {
				return fmt.Errorf("%w: fieldList 格式错误", ErrReportInvalid)
			}
			name, _ := fieldConfig["name"].(string)
			field, err := requireReportFieldCapability(available, name, "select")
			if err != nil {
				return err
			}
			aggregate, _ := fieldConfig["aggFunctionEnum"].(string)
			if strings.TrimSpace(aggregate) != "" && !field.Aggregatable {
				return fmt.Errorf("%w: 字段 %s 不允许聚合", ErrReportInvalid, name)
			}
			outputName, _ := fieldConfig["alias"].(string)
			if outputName = strings.TrimSpace(outputName); outputName == "" {
				outputName = strings.TrimSpace(name)
			}
			outputs[outputName] = virtualReportField(outputName, field.DataType)
		}
	}

	if err := validateReportConditions(query["conditionList"], available); err != nil {
		return err
	}
	if rawGroups, exists := query["groupList"]; exists && rawGroups != nil {
		groups, ok := rawGroups.([]any)
		if !ok {
			return fmt.Errorf("%w: groupList 格式错误", ErrReportInvalid)
		}
		for _, item := range groups {
			name, ok := item.(string)
			if !ok {
				return fmt.Errorf("%w: groupList 字段格式错误", ErrReportInvalid)
			}
			if _, err := requireReportFieldCapabilityWithOutputs(available, outputs, name, "group"); err != nil {
				return err
			}
		}
	}
	if rawOrder, exists := query["orderBy"]; exists && rawOrder != nil {
		name, ok := rawOrder.(string)
		if !ok {
			return fmt.Errorf("%w: orderBy 格式错误", ErrReportInvalid)
		}
		if name = strings.TrimSpace(name); name != "" {
			if _, err := requireReportFieldCapabilityWithOutputs(available, outputs, name, "sort"); err != nil {
				return err
			}
		}
	}
	if rawOrders, exists := query["orderList"]; exists && rawOrders != nil {
		orders, ok := rawOrders.([]any)
		if !ok {
			return fmt.Errorf("%w: orderList 格式错误", ErrReportInvalid)
		}
		for _, item := range orders {
			order, ok := item.(map[string]any)
			if !ok {
				return fmt.Errorf("%w: orderList 字段格式错误", ErrReportInvalid)
			}
			name, _ := order["name"].(string)
			if _, err := requireReportFieldCapabilityWithOutputs(available, outputs, name, "sort"); err != nil {
				return err
			}
		}
	}
	if nested, ok := query["postQueryDTO"].(map[string]any); ok {
		return validateQueryContractLevel(nested, outputs)
	}
	return nil
}

func validateReportConditions(raw any, available map[string]model.ReportFieldContract) error {
	if raw == nil {
		return nil
	}
	conditions, ok := raw.([]any)
	if !ok {
		return fmt.Errorf("%w: conditionList 格式错误", ErrReportInvalid)
	}
	for _, item := range conditions {
		condition, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%w: conditionList 字段格式错误", ErrReportInvalid)
		}
		name, _ := condition["name"].(string)
		if _, err := requireReportFieldCapability(available, name, "filter"); err != nil {
			return err
		}
		if err := validateReportConditions(condition["orList"], available); err != nil {
			return err
		}
	}
	return nil
}

func requireReportFieldCapabilityWithOutputs(available, outputs map[string]model.ReportFieldContract, name, capability string) (model.ReportFieldContract, error) {
	trimmed := strings.TrimSpace(name)
	if _, exists := available[trimmed]; exists {
		return requireReportFieldCapability(available, trimmed, capability)
	}
	return requireReportFieldCapability(outputs, trimmed, capability)
}

func requireReportFieldCapability(available map[string]model.ReportFieldContract, name, capability string) (model.ReportFieldContract, error) {
	name = strings.TrimSpace(name)
	field, ok := available[name]
	if name == "" || !ok || !field.Enabled {
		return model.ReportFieldContract{}, fmt.Errorf("%w: 字段 %s 未声明或已禁用", ErrReportInvalid, name)
	}
	allowed := map[string]bool{
		"select": field.Selectable, "filter": field.Filterable, "group": field.Groupable,
		"aggregate": field.Aggregatable, "sort": field.Sortable,
	}[capability]
	if !allowed {
		return model.ReportFieldContract{}, fmt.Errorf("%w: 字段 %s 不允许执行 %s", ErrReportInvalid, name, capability)
	}
	return field, nil
}

func virtualReportField(name, dataType string) model.ReportFieldContract {
	return model.ReportFieldContract{
		Name: name, DataType: dataType, Enabled: true, Selectable: true, Filterable: true,
		Groupable: true, Aggregatable: true, Sortable: true,
	}
}
