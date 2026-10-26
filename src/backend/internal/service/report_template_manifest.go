package service

const (
	DefaultReportTemplateID      = "template-1"
	DefaultReportTemplateVersion = "1.0.0"
)

// DefaultReportTemplateManifest is the MCP-facing workflow contract. The
// frontend's shared V1.2 chart components, not model-supplied style values,
// implement its appearance.
func DefaultReportTemplateManifest() map[string]any {
	return map[string]any{
		"template_id":      DefaultReportTemplateID,
		"template_version": DefaultReportTemplateVersion,
		"name":             "报表 V1.2 基础图表模板",
		"is_default":       true,
		"visual_reference": "现有价敏报表 V1.2 的图表组件与样式",
		"locked_by_renderer": []string{
			"图表颜色与调色板", "曲线、柱形、环形几何", "字体、网格、坐标轴、图例、提示框、动画", "卡片样式与响应式规则",
		},
		"agent_can_choose": []string{
			"真实数据源和查询口径", "指标加工与字段绑定", "图表类型", "标题与可核查的数据解读", "板块顺序与相邻图表组合",
		},
		"chart_types": []map[string]any{
			{"chart_type": "line", "description": "曲线；时间或有序维度上的一个至五个数值序列", "required_bindings": []string{"x_field", "series[].field"}, "renderer": "V1.2 SmoothChart", "fixed_height_px": 270},
			{"chart_type": "bar", "description": "柱状图；类别或时间维度上的一个数值序列", "required_bindings": []string{"x_field", "series[0].field"}, "renderer": "V1.2 IncrementBarChart", "fixed_height_px": 330},
			{"chart_type": "donut", "description": "饼/环图；非负类别占比，类别合计须来自同一统计范围", "required_bindings": []string{"label_field", "value_field"}, "renderer": "V1.2 DonutChart", "fixed_geometry": "260×260 viewBox / 84 radius / 30 stroke"},
		},
		"workflow": []string{
			"先 discover_report_data 确认可用字段和能力",
			"用 query_report_data 查询真实数据；每个图绑定本轮完整查询的 query_id",
			"按数据语义选择 chart_type 和字段，保存时只传绑定，不传图表 CSS、HTML、颜色或数值",
			"save_personal_report 固定 template_id=template-1；服务端验证绑定并从查询凭证装配数据",
		},
		"specialized_v12_snapshot": "仅在使用已配置价敏 V1.2 预计算快照时选择 v12_dashboard；其他业务数据不套用价敏专有板块。",
	}
}
