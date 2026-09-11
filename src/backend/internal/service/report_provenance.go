package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
)

type reportProvenanceStore interface {
	AppendReportQueryExecution(context.Context, *model.ReportQueryExecution) error
	ListReportQueryExecutions(context.Context, string, int) ([]model.ReportQueryExecution, error)
	GetReportQueryExecution(context.Context, string, string) (*model.ReportQueryExecution, error)
}

const reportBindingVersion = "price_sensitive_v1_2:2026-09-11.2"

func v12ChartBindings() []model.ReportChartBinding {
	return []model.ReportChartBinding{
		{ChartKey: "overview", Title: "指标概览", QueryKeys: []string{"totals", "assigned_distribution"}, Formula: "C(dt)=SUM(user_count), ps_score 非空（含先验）；覆盖率=C/T×100；日增=C当日-C前一日；增长率=日增/C前一日×100；日均=连续可用日对增量之和/日对数。缺失前日不可计算；展示仅保留2026-07-29起快照。", FieldMapping: map[string]string{"C": "assigned_distribution.user_count 按 dt 求和", "T": "totals.total_user_count"}},
		{ChartKey: "all_distribution", Title: "全量人群价敏分布", QueryKeys: []string{"totals", "assigned_distribution"}, Formula: "最新成功 dt 按 level 汇总 user_count；未赋分=T-SUM(user_count)；占比=各级人数/T×100。", FieldMapping: map[string]string{"level": "assigned_distribution.level", "count": "assigned_distribution.user_count", "total": "totals.total_user_count"}},
		{ChartKey: "order_distribution", Title: "有订单人群价敏分布", QueryKeys: []string{"order_distribution"}, Formula: "ps_conf>0；最新成功 dt 按 level 汇总 user_count；占比=各级人数/本组人数×100。", FieldMapping: map[string]string{"level": "level", "count": "user_count"}},
		{ChartKey: "daily_net", Title: "每日价敏用户净增", QueryKeys: []string{"assigned_distribution"}, Formula: "每天 C=SUM(user_count)；日净增=C(dt)-C(dt-1)。首日和缺少前一日时留空；真实负值保留。", FieldMapping: map[string]string{"date": "dt", "count": "user_count"}},
		{ChartKey: "daily_net_line", Title: "每日单次净增", QueryKeys: []string{"assigned_distribution"}, Formula: "C(dt)-C(dt-1)；首日或缺前日留空；展示仅保留2026-07-29起快照。疑似离群不参与正常趋势，提示仍为真实值。", FieldMapping: map[string]string{"date": "dt", "count": "user_count"}},
		{ChartKey: "daily_rate", Title: "每日增长率", QueryKeys: []string{"assigned_distribution"}, Formula: "(C(dt)-C(dt-1))/C(dt-1)×100；缺失前日或前日人数为0则不可计算。", FieldMapping: map[string]string{"date": "dt", "count": "user_count"}},
		{ChartKey: "all_trend", Title: "全量人群每日价敏分布", QueryKeys: []string{"totals", "assigned_distribution"}, Formula: "按 dt、level 汇总 user_count；每个 dt 的 UNASSIGNED=totals.total_user_count-SUM(assigned_distribution.user_count)，仅正差值展示为未赋分。趋势对比按最近有效人数降序、每条自身min/max映射等高区间；真实数值共轴。缺失dt不补零。", FieldMapping: map[string]string{"date": "dt", "series": "assigned_distribution.level", "count": "assigned_distribution.user_count", "total": "totals.total_user_count", "UNASSIGNED": "同 dt 的 total-SUM(count)，仅展示正差值"}},
		{ChartKey: "order_trend", Title: "有订单人群每日价敏分布", QueryKeys: []string{"order_distribution"}, Formula: "ps_conf>0；按 dt、level 汇总 user_count。趋势对比按最近有效人数降序、每条自身min/max映射等高区间；真实数值共轴。缺失dt不补零。", FieldMapping: map[string]string{"date": "dt", "series": "level", "count": "user_count"}},
	}
}

// 正常统计与核验重跑共用生成器，重跑不能扩大到用户明细查询。
func buildV12AggregateQueries(report *model.ReportDefinition, base *model.ReportAnalyticsResult, cities []string) ([]map[string]any, []string, error) {
	var template ReportTemplate
	if err := json.Unmarshal(reportTemplateOne, &template); err != nil {
		return nil, nil, err
	}
	p := template.Profiles["price_sensitive_v1_2"]
	conditions := []map[string]any{{"name": "dt", "operatorEnum": "GEQ", "value": base.StartDate}, {"name": "dt", "operatorEnum": "LEQ", "value": base.EndDate}}
	var saved struct {
		Conditions []map[string]any `json:"conditionList"`
	}
	if err := json.Unmarshal(report.QueryJSON, &saved); err != nil {
		return nil, nil, err
	}
	for _, c := range saved.Conditions {
		if c["name"] != "dt" {
			conditions = append(conditions, c)
		}
	}
	if len(cities) > 0 {
		conditions = append(conditions, map[string]any{"name": p.City, "operatorEnum": "IN", "value": cities})
	}
	fields := []map[string]any{analyticsField("dt", "", ""), analyticsField(p.Level, "level", ""), analyticsField(p.Type, "score_type", ""), analyticsField("duid", "user_count", "COUNT")}
	for _, m := range []struct{ field, key string }{{p.Score, "price"}, {p.Price, "d1"}, {p.Coupon, "d2"}, {p.Time, "d3"}} {
		fields = append(fields, analyticsField(m.field, m.key+"_avg", "AVG"), analyticsField(m.field, m.key+"_n", "COUNT"))
	}
	queries := []map[string]any{
		{"fieldList": []map[string]any{analyticsField("dt", "", ""), analyticsField("duid", "total_user_count", "COUNT"), analyticsField(p.Orders, "total_order_count", "SUM")}, "conditionList": conditions, "groupList": []string{"dt"}, "orderBy": "dt"},
		{"fieldList": fields, "conditionList": append(append([]map[string]any{}, conditions...), map[string]any{"name": p.Score, "operatorEnum": "NOT_NULL"}), "groupList": []string{"dt", p.Level, p.Type}, "orderBy": "dt"},
		{"fieldList": []map[string]any{analyticsField("dt", "", ""), analyticsField(p.Level, "level", ""), analyticsField("duid", "user_count", "COUNT")}, "conditionList": append(append([]map[string]any{}, conditions...), map[string]any{"name": "ps_conf", "operatorEnum": "GQ", "value": "0"}), "groupList": []string{"dt", p.Level}, "orderBy": "dt"},
	}
	keys := []string{"totals", "assigned_distribution", "order_distribution"}
	if base.Range == "dates" {
		queries = []map[string]any{{"fieldList": []map[string]any{analyticsField("dt", "", "")}, "conditionList": conditions, "groupList": []string{"dt"}, "orderBy": "dt"}}
		keys = []string{"dates"}
	}
	for _, q := range queries {
		q["needPagination"], q["pageSize"], q["page"] = true, 1000, 1
	}
	return queries, keys, nil
}

func redactReportTrace(text string, source *model.ReportDataSource) string {
	for _, name := range []string{source.AppKeyEnv, source.AppSecretEnv, source.SignatureEnv, source.XDateEnv} {
		if value := os.Getenv(name); value != "" {
			text = strings.ReplaceAll(text, value, "[REDACTED]")
		}
	}
	return text
}

func (r *ReportRunner) executeV12Aggregate(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, key string, raw json.RawMessage, start, end string, cities []string, replayOf string) (model.ReportQueryResult, *model.ReportQueryExecution, error) {
	execution := &model.ReportQueryExecution{ID: uuid.NewString(), ReportID: report.ID, SourceID: source.ID, APIName: source.APIName, SourceName: source.Name, QueryKey: key, CreatedAt: r.now(), StartDate: start, EndDate: end, Cities: append([]string{}, cities...), BindingVersion: reportBindingVersion, Bindings: v12ChartBindings(), Rows: []map[string]any{}, ReplayOf: replayOf, Status: "succeeded"}
	var request map[string]any
	if err := json.Unmarshal(raw, &request); err != nil {
		return model.ReportQueryResult{}, nil, err
	}
	request["apiName"] = source.APIName
	execution.RequestJSON, _ = json.Marshal(request)
	began := time.Now()
	result, queryErr := r.connector.Query(ctx, *source, raw)
	execution.DurationMS = time.Since(began).Milliseconds()
	execution.SQL = redactReportTrace(result.SQL, source)
	execution.QueryID = redactReportTrace(result.QueryID, source)
	if queryErr == nil && (result.Pagination.Total > int64(len(result.Rows)) || result.Pagination.PageCount > 1 || len(result.Rows) >= 1000) {
		queryErr = fmt.Errorf("%w: 聚合结果不完整", ErrReportInvalid)
	}
	if queryErr == nil {
		// 仅保存预期聚合字段，禁止意外的用户明细列进入快照。
		allowed := map[string]bool{"dt": true, "level": true, "score_type": true, "user_count": true, "total_user_count": true, "total_order_count": true, "price_avg": true, "price_n": true, "d1_avg": true, "d1_n": true, "d2_avg": true, "d2_n": true, "d3_avg": true, "d3_n": true}
		for _, row := range result.Rows {
			clean := map[string]any{}
			for field, value := range row {
				if !allowed[field] {
					queryErr = fmt.Errorf("%w: 非聚合结果字段", ErrReportInvalid)
					break
				}
				clean[field] = value
			}
			if queryErr != nil {
				break
			}
			execution.Rows = append(execution.Rows, clean)
		}
	}
	if queryErr != nil {
		execution.Status = "failed"
		execution.ErrorMessage = "聚合查询失败或结果不完整，未保存可用结果"
		execution.Rows = []map[string]any{}
	}
	// 上游错误可能包含认证值，因此只持久化固定的安全诊断。
	if store, ok := r.catalog.(reportProvenanceStore); ok {
		auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := store.AppendReportQueryExecution(auditCtx, execution); err != nil {
			return model.ReportQueryResult{}, nil, fmt.Errorf("保存聚合执行记录失败: %w", err)
		}
	}
	return result, execution, queryErr
}

func (s *ReportService) GetProvenance(ctx context.Context, reportID, userID string, requestedIDs ...string) (*model.ReportProvenance, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	report, err := s.store.GetReportDefinition(ctx, reportID)
	if err != nil {
		return nil, err
	}
	if report == nil {
		return nil, ErrReportNotFound
	}
	if !isProvenanceV12(report) {
		return nil, fmt.Errorf("%w: 仅支持V1.2固定报表", ErrReportInvalid)
	}
	response := &model.ReportProvenance{Bindings: v12ChartBindings(), Executions: []model.ReportQueryExecution{}, Message: "历史快照未记录查询溯源；无法还原当时SQL"}
	if store, ok := s.store.(reportProvenanceStore); ok {
		response.Executions, err = store.ListReportQueryExecutions(ctx, reportID, 200)
		if err != nil {
			return nil, err
		}
		if response.Executions == nil {
			response.Executions = []model.ReportQueryExecution{}
		}
		if len(requestedIDs) > 500 {
			return nil, ErrReportInvalid
		}
		seen := map[string]bool{}
		for _, execution := range response.Executions {
			seen[execution.ID] = true
		}
		for _, id := range requestedIDs {
			if _, err := uuid.Parse(id); err != nil {
				return nil, ErrReportInvalid
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			item, err := store.GetReportQueryExecution(ctx, reportID, id)
			if err != nil {
				return nil, err
			}
			if item != nil {
				response.Executions = append(response.Executions, *item)
			}
		}
	}
	response.Available = len(response.Executions) > 0
	if response.Available {
		response.Message = "最近200条及指定快照关联记录；SQL为空表示上游未返回SQL，缺少执行ID的历史快照来源未知"
	}
	return response, nil
}

func isProvenanceV12(report *model.ReportDefinition) bool {
	var config struct {
		Template struct {
			Profile string `json:"profile"`
		} `json:"template"`
	}
	return json.Unmarshal(report.VisualizationJSON, &config) == nil && config.Template.Profile == "price_sensitive_v1_2"
}

func (s *ReportService) ReplayProvenance(ctx context.Context, reportID, userID, executionID string) (*model.ReportProvenanceReplay, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(executionID); err != nil {
		return nil, ErrReportInvalid
	}
	store, ok := s.store.(reportProvenanceStore)
	if !ok {
		return nil, fmt.Errorf("%w: 未启用查询记录", ErrReportInvalid)
	}
	saved, err := store.GetReportQueryExecution(ctx, reportID, executionID)
	if err != nil {
		return nil, err
	}
	if saved == nil {
		return nil, ErrReportNotFound
	}
	if s.runner == nil {
		return nil, ErrReportInvalid
	}
	if _, ok := s.runner.catalog.(reportProvenanceStore); !ok {
		return nil, fmt.Errorf("%w: 无法保存重跑记录", ErrReportInvalid)
	}
	report, source, err := s.runner.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	if !isProvenanceV12(report) || !source.Enabled || saved.SourceID != source.ID || saved.ReportID != report.ID {
		return nil, ErrReportInvalid
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	if contract == nil || !contract.Enabled {
		return nil, ErrReportSourceMissing
	}
	var template ReportTemplate
	if err := json.Unmarshal(reportTemplateOne, &template); err != nil {
		return nil, err
	}
	if err := validateTemplateProfile(contract, template.Profiles["price_sensitive_v1_2"]); err != nil {
		return nil, err
	}
	for _, date := range []string{saved.StartDate, saved.EndDate} {
		if _, err := time.Parse("2006-01-02", date); err != nil {
			return nil, ErrReportInvalid
		}
	}
	if saved.StartDate > saved.EndDate || len(saved.Cities) > 50 {
		return nil, ErrReportInvalid
	}
	queries, keys, err := buildV12AggregateQueries(report, &model.ReportAnalyticsResult{StartDate: saved.StartDate, EndDate: saved.EndDate}, saved.Cities)
	if err != nil {
		return nil, err
	}
	var decoded map[string]any
	if json.Unmarshal(saved.RequestJSON, &decoded) != nil {
		return nil, ErrReportInvalid
	}
	index := -1
	for i, key := range keys {
		if key == saved.QueryKey {
			index = i
		}
	}
	if index < 0 {
		return nil, fmt.Errorf("%w: 禁止重跑非受信聚合查询", ErrReportInvalid)
	}
	expected := queries[index]
	expected["apiName"] = source.APIName
	canonical, _ := json.Marshal(expected)
	var trusted map[string]any
	_ = json.Unmarshal(canonical, &trusted)
	if !reflect.DeepEqual(decoded, trusted) {
		return nil, fmt.Errorf("%w: 查询不符合当前报表聚合定义", ErrReportInvalid)
	}
	available := map[string]model.ReportFieldContract{}
	for _, field := range contract.Fields {
		available[field.Name] = field
	}
	if err := validateQueryContractLevel(decoded, available); err != nil {
		return nil, err
	}
	_, execution, err := s.runner.executeV12Aggregate(ctx, report, source, saved.QueryKey, canonical, saved.StartDate, saved.EndDate, saved.Cities, saved.ID)
	if execution == nil {
		return nil, err
	}
	return &model.ReportProvenanceReplay{Execution: execution, ReplayOnly: true, Message: "已保存核验结果，未更新公开图表"}, nil
}
