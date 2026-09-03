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
		"source_id": strProp("discover_report_data 返回的数据源 ID"),
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
		"按 discover_report_data 返回的字段契约执行真实数据查询。禁止猜测字段或编造结果；每页最多返回 100 行。",
		inputSchema,
		&port.RouteInfo{Method: "POST", Path: "/mcp/report-data/query", Required: []string{"source_id", "fields"}, Optional: []string{"filters", "group_by", "order_by", "page", "page_size"}},
	)
}

func SavePersonalReport() port.MCPToolSpec {
	documentProp := map[string]interface{}{
		"type":        "object",
		"description": "结构化报表文档；sections 可包含 metric、chart、table、insight、text，数据必须来自真实查询结果",
	}
	inputSchema := schema(map[string]map[string]interface{}{
		"title":          strProp("报表标题"),
		"description":    strProp("一句话摘要"),
		"data_source_id": strProp("真实查询使用的数据源 ID"),
		"query_id":       strProp("本轮 query_report_data 返回的 query_id"),
		"document":       documentProp,
		"style_preset":   enumProp("报表风格", "business", "journal", "soft", "glass", "balanced"),
		"style_prompt":   strProp("补充风格说明"),
	}, "title", "data_source_id", "query_id", "document")
	inputSchema["additionalProperties"] = false
	return newRouteSpec(
		"save_personal_report",
		"保存个人报表",
		"report",
		"仅在 query_report_data 成功后调用，把真实查询生成的指标、图表、表格和 provenance 保存为当前用户个人报表，并在对话中显示可点击卡片。",
		inputSchema,
		&port.RouteInfo{Method: "POST", Path: "/mcp/personal-reports", Required: []string{"title", "data_source_id", "query_id", "document"}, Optional: []string{"description", "style_preset", "style_prompt"}},
	)
}
