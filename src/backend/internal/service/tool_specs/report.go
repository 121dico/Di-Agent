package tool_specs

import "github.com/121dico/Di-Agent/src/backend/internal/port"

// DiscoverReportData exposes only logical source names and approved field
// capabilities. Endpoint, Hive DDL and credentials remain administrator-only.
func DiscoverReportData() port.MCPToolSpec {
	return newRouteSpec(
		"discover_report_data",
		"发现报表数据",
		"report",
		"在制作报表或分析数据前调用。列出管理员已接入且启用的数据源，以及 Agent 可选择、过滤、分组、聚合和排序的字段；不返回 endpoint、Hive DDL 或凭据。",
		noParams(),
		&port.RouteInfo{Method: "GET", Path: "/mcp/report-data/contracts"},
	)
}

func GetReportTemplate() port.MCPToolSpec {
	return newRouteSpec(
		"get_report_template",
		"查看默认报表模板",
		"report",
		"生成报表前读取默认 template-1 的 V1.2 图表样式契约。模型可选择真实数据、图表类型和字段，曲线/柱状/饼环图的视觉样式由平台固定。",
		noParams(),
		&port.RouteInfo{Method: "GET", Path: "/mcp/report-templates/default"},
	)
}

func QueryReportData() port.MCPToolSpec {
	fieldItem := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name":        strProp("字段名"),
			"alias":       strProp("结果别名"),
			"aggregation": enumProp("聚合函数", "AVG", "MIN", "MAX", "SUM", "COUNT", "COUNT DISTINCT"),
		},
		"required":             []string{"name"},
		"additionalProperties": false,
	}
	filterItem := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name":     strProp("过滤字段"),
			"operator": enumProp("过滤操作符", "EQ", "NEQ", "IN", "NOT_IN", "GEQ", "LEQ", "GQ", "LQ", "LIKE", "IS_NULL", "BETWEEN", "NOT_BETWEEN", "NOT_NULL", "PREFIX", "SUFFIX"),
			"value":    map[string]interface{}{},
		},
		"required":             []string{"name", "operator"},
		"additionalProperties": false,
	}
	inputSchema := schema(map[string]map[string]interface{}{
		"source_id":     strProp("discover_report_data 返回的数据源 ID"),
		"prepared_view": enumProp("V1.2 亿级源使用已核验的预计算报表快照；fields 传 dt 占位", "v12_dashboard"),
		"fields": {
			"type": "array", "items": fieldItem, "minItems": 1, "maxItems": 30,
			"description": "选择与聚合字段",
		},
		"filters": {
			"type": "array", "items": filterItem, "description": "过滤条件",
		},
		"group_by": {
			"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "分组字段",
		},
		"order_by":  strProp("排序字段，可选追加 ASC 或 DESC，例如 dt DESC"),
		"page":      intProp("页码，默认 1"),
		"page_size": intProp("每页行数，最大 100"),
	}, "source_id", "fields")
	inputSchema["additionalProperties"] = false
	return newRouteSpec(
		"query_report_data",
		"查询报表数据",
		"report",
		"按字段契约执行真实查询；V1.2 亿级源生成同版报表时设置 prepared_view=v12_dashboard，读取公共报表已核验的预计算快照，避免即时全表去重。返回的 query_id 是当前用户查询凭证。",
		inputSchema,
		&port.RouteInfo{Method: "POST", Path: "/mcp/report-data/query", Required: []string{"source_id", "fields"}, Optional: []string{"prepared_view", "filters", "group_by", "order_by", "page", "page_size"}},
	)
}

func SavePersonalReport() port.MCPToolSpec {
	fieldBinding := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"field":  strProp("query_report_data 返回的结果列名或别名"),
			"label":  strProp("图表中的中文名称"),
			"suffix": strProp("指标单位，可选"),
		},
		"required":             []string{"field", "label"},
		"additionalProperties": false,
	}
	section := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"id":          strProp("板块稳定 ID，同一报表内唯一"),
			"type":        enumProp("板块类型；v12_dashboard 必须单独引用预计算快照", "metrics", "chart", "table", "v12_dashboard"),
			"title":       strProp("板块标题"),
			"query_id":    strProp("可选；此板块使用的 query_report_data 查询凭证，不填使用顶层 query_id"),
			"chart_type":  enumProp("chart 板块图形", "line", "bar", "donut"),
			"x_field":     strProp("折线或柱图 X 轴结果列"),
			"label_field": strProp("环图类别结果列"),
			"value_field": strProp("环图数值结果列"),
			"metrics":     map[string]interface{}{"type": "array", "items": fieldBinding},
			"series":      map[string]interface{}{"type": "array", "items": fieldBinding},
			"columns":     map[string]interface{}{"type": "array", "items": fieldBinding},
		},
		"required":             []string{"id", "type", "title"},
		"additionalProperties": false,
	}
	documentProp := map[string]interface{}{
		"type":        "object",
		"description": "先调用 get_report_template。只提交图表绑定，不提交数值/HTML/CSS/颜色。平台按查询凭证装配真实行并用 V1.2 固定图表组件渲染。metrics 需 metrics；line/bar 需 x_field、series；donut 需 label_field、value_field；table 需 columns。",
		"properties": map[string]interface{}{
			"template_id": enumProp("默认 V1.2 展示模板", "template-1"),
			"sections":    map[string]interface{}{"type": "array", "minItems": 1, "maxItems": 16, "items": section},
		},
		"required":             []string{"sections"},
		"additionalProperties": false,
	}
	inputSchema := schema(map[string]map[string]interface{}{
		"title":          strProp("报表标题"),
		"description":    strProp("一句话摘要"),
		"data_source_id": strProp("真实查询使用的数据源 ID"),
		"query_id":       strProp("本轮 query_report_data 返回的当前用户查询凭证；必须被至少一个板块引用"),
		"document":       documentProp,
	}, "title", "data_source_id", "query_id", "document")
	inputSchema["additionalProperties"] = false
	return newRouteSpec(
		"save_personal_report",
		"保存个人报表",
		"report",
		"仅在 query_report_data 成功后调用。Agent 选择 template-1 的指标、曲线/柱状/饼环图和表格绑定；视觉样式固定复用 V1.2。服务端从当前用户的查询凭证读取真实行并保存个人报表。不要传 data/rows、颜色或编造数字。",
		inputSchema,
		&port.RouteInfo{Method: "POST", Path: "/mcp/personal-reports", Required: []string{"title", "data_source_id", "query_id", "document"}, Optional: []string{"description"}},
	)
}
