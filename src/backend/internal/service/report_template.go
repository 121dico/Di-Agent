package service

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

//go:embed report_templates/template-1.json
var reportTemplateOne []byte

type ReportTemplate struct {
	ID           string                           `json:"id"`
	Name         string                           `json:"name"`
	Version      string                           `json:"version"`
	Renderer     string                           `json:"renderer"`
	Description  string                           `json:"description"`
	Profiles     map[string]ReportTemplateProfile `json:"profiles"`
	Presentation json.RawMessage                  `json:"presentation"`
}

type ReportTemplateProfile struct {
	Name   string `json:"name"`
	Score  string `json:"score"`
	Level  string `json:"level"`
	Price  string `json:"price"`
	Coupon string `json:"coupon"`
	Time   string `json:"time"`
	Orders string `json:"orders"`
	City   string `json:"city"`
	Type   string `json:"type"`
}

type reportTemplateBinding struct {
	ID            string `json:"id"`
	Version       string `json:"version"`
	Renderer      string `json:"renderer"`
	Profile       string `json:"profile"`
	PartitionMode string `json:"partition_mode"`
}

func templateBinding(report *model.ReportDefinition) reportTemplateBinding {
	var config struct {
		Template reportTemplateBinding `json:"template"`
	}
	_ = json.Unmarshal(report.VisualizationJSON, &config)
	return config.Template
}

func (s *ReportService) ListTemplates(ctx context.Context, userID string) ([]ReportTemplate, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	var template ReportTemplate
	if err := json.Unmarshal(reportTemplateOne, &template); err != nil {
		return nil, fmt.Errorf("decode report template: %w", err)
	}
	return []ReportTemplate{template}, nil
}

// ApplyTemplate 复制模板配置而不是绑定可变草稿；重复点击返回已有实例，不覆盖管理员编辑。
func (s *ReportService) ApplyTemplate(ctx context.Context, userID, templateID, sourceID string) (*model.ReportDefinition, error) {
	templates, err := s.ListTemplates(ctx, userID)
	if err != nil {
		return nil, err
	}
	var selected *ReportTemplate
	for i := range templates {
		if templates[i].ID == templateID {
			selected = &templates[i]
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("%w: 模板不存在", ErrReportInvalid)
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, ErrReportSourceMissing
	}
	if !contract.Enabled {
		return nil, fmt.Errorf("%w: 数据源已停用", ErrReportInvalid)
	}
	profile, ok := selected.Profiles[contract.APIName]
	if !ok {
		return nil, fmt.Errorf("%w: 模板一尚未适配该数据源，请先配置字段映射", ErrReportInvalid)
	}
	if err := validateTemplateProfile(contract, profile); err != nil {
		return nil, err
	}
	findExisting := func() (*model.ReportDefinition, error) {
		reports, listErr := s.store.ListReportDefinitions(ctx)
		if listErr != nil {
			return nil, listErr
		}
		for i := range reports {
			binding := templateBinding(&reports[i])
			if reports[i].DataSourceID == sourceID && binding.ID == selected.ID && binding.Version == selected.Version {
				return &reports[i], nil
			}
		}
		return nil, nil
	}
	if existing, err := findExisting(); err != nil || existing != nil {
		return existing, err
	}
	fields := []map[string]any{}
	for _, field := range contract.Fields {
		if field.Enabled && field.Selectable {
			fields = append(fields, analyticsField(field.Name, "", ""))
		}
	}
	query, err := json.Marshal(map[string]any{
		"fieldList": fields, "conditionList": []map[string]any{{"name": "dt", "operatorEnum": "EQ", "value": reportBusinessYesterday(time.Now())}},
		"needPagination": true, "page": 1, "pageSize": 100, "orderBy": "duid", "useMockData": false,
	})
	if err != nil {
		return nil, err
	}
	description := "模板一 · 标签快照口径；同一 DUID 的每日标签变化，不代表真实订单发生时间。"
	if contract.APIName == "price_sensitive_v1_2" {
		description += "已有价敏分包含 PRIOR 先验赋分；订单数为标签刷新时近180天订单计数汇总，非每日订单量。"
	}
	visualization, err := json.Marshal(map[string]any{
		"template":     reportTemplateBinding{selected.ID, selected.Version, selected.Renderer, contract.APIName, "previous_day"},
		"presentation": selected.Presentation, "field_mapping": profile,
		"analytics": map[string]any{"enabled": true, "timeField": "dt", "timeSemantics": "label_snapshot_date"},
		"detail":    map[string]any{"defaultGroup": "all"},
		"chart": map[string]any{"xField": "dt", "series": []map[string]any{
			{"field": profile.Score, "label": "价敏均分", "color": "#2F6FDB"},
			{"field": profile.Price, "label": "价格分", "color": "#15857A"},
			{"field": profile.Coupon, "label": "用券分", "color": "#765BC4"},
			{"field": profile.Time, "label": "时间换价格分", "color": "#D05C50"},
		}},
	})
	if err != nil {
		return nil, err
	}
	report, err := s.CreateDefinition(ctx, userID, model.ReportDefinition{Name: profile.Name, Description: description,
		DataSourceID: sourceID, QueryJSON: query, VisualizationJSON: visualization, Enabled: true})
	if isUniqueViolation(err) {
		return findExisting()
	}
	return report, err
}

func validateTemplateProfile(contract *model.ReportDataSourceContract, p ReportTemplateProfile) error {
	fields := make(map[string]model.ReportFieldContract)
	for _, field := range contract.Fields {
		fields[field.Name] = field
	}
	requirements := map[string][]string{
		"duid": {"select", "aggregate", "sort"}, "dt": {"select", "filter", "group", "sort"},
		p.Score: {"select", "filter", "aggregate"}, p.Level: {"select", "group"},
		p.Price: {"select", "aggregate"}, p.Coupon: {"select", "aggregate"}, p.Time: {"select", "aggregate"},
		p.Orders: {"select", "aggregate"}, p.City: {"select", "filter"}, p.Type: {"select", "group"},
	}
	for name, capabilities := range requirements {
		for _, capability := range capabilities {
			if _, err := requireReportFieldCapability(fields, name, capability); err != nil {
				return err
			}
		}
	}
	return nil
}

// reportExecutionQuery 只在模板声明动态快照时替换日期，不改动非模板固定报表。
func reportExecutionQuery(report *model.ReportDefinition, now time.Time) ([]byte, error) {
	if templateBinding(report).PartitionMode != "previous_day" {
		return report.QueryJSON, nil
	}
	var query map[string]any
	if err := json.Unmarshal(report.QueryJSON, &query); err != nil {
		return nil, err
	}
	var conditions []any
	if items, ok := query["conditionList"].([]any); ok {
		for _, item := range items {
			condition, _ := item.(map[string]any)
			if condition["name"] != "dt" {
				conditions = append(conditions, item)
			}
		}
	}
	conditions = append(conditions, map[string]any{"name": "dt", "operatorEnum": "EQ", "value": reportBusinessYesterday(now)})
	query["conditionList"] = conditions
	return json.Marshal(query)
}

func isV12Report(report *model.ReportDefinition) bool {
	return strings.TrimSpace(templateBinding(report).Profile) == "price_sensitive_v1_2"
}

func reportBusinessYesterday(now time.Time) string {
	return now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).AddDate(0, 0, -1).Format("2006-01-02")
}
