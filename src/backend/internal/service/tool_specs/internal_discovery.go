package tool_specs

import "github.com/121dico/Di-Agent/src/backend/internal/port"

// 资料源发现只返回公开的能力元数据；不代表 Agent 获得了资料读取权限。
func DiscoverInternalSources() port.MCPToolSpec {
	return newRouteSpec(
		"discover_internal_sources",
		"发现内部资料源",
		"knowledge",
		"当内部问题缺少线索时，按需查看 Cooper、GitLab、数据地图和 Hive 的简短用途与 Agent 实际接入状态；不检索或返回私有内容。",
		noParams(),
		nil,
	)
}

func GetInternalSourceGuide() port.MCPToolSpec {
	return newRouteSpec(
		"get_internal_source_guide",
		"查看资料源指南",
		"knowledge",
		"按 source_id 只展开一个内部资料源的使用边界与下一步；未接入来源不能据此读取资料。",
		schema(map[string]map[string]interface{}{
			"source_id": enumProp("discover_internal_sources 返回的资料源 ID", "cooper", "gitlab", "data_map", "hive"),
		}, "source_id"),
		nil,
	)
}

// 数据地图表名前缀检索由后端持有独立凭据，并按获批试点用户限用。
func SearchDataMapHiveTables() port.MCPToolSpec {
	return newRouteSpec(
		"search_data_map_hive_tables",
		"搜索数据地图 Hive 表",
		"knowledge",
		"只读分页搜索数据地图登记的 Hive 库表前缀；空页不证明某张表全局不存在。不执行 Hive SQL，不返回字段值、样例行或业务数值。先查看资料源状态。",
		schema(map[string]map[string]interface{}{
			"db_name":   strProp("可选 Hive 库名"),
			"prefix":    strProp("必填表名前缀，仅字母、数字或下划线"),
			"page_no":   intProp("页码，默认 1，最大 1000"),
			"page_size": intProp("每页条数，默认 10，最大 20"),
		}, "prefix"),
		&port.RouteInfo{Method: "GET", Path: "/daemon/internal-sources/data-map/hive/tables", Required: []string{"prefix"}, Optional: []string{"db_name", "page_no", "page_size"}},
	)
}

// HiveServer2 business-row probing is a separate permission seam from Data Map metadata.
func ProbeHiveData() port.MCPToolSpec {
	return newRouteSpec(
		"probe_hive_data",
		"探测本人 Hive 数据读取权限",
		"knowledge",
		"仅对已批准的 Hive 表与明确 dt 分区执行服务端固定的 SELECT dt ... LIMIT 1，验证当前请求者 Hadoop 会话或已绑定个人凭据能否读取 dt 列，以及该分区是否有行。不允许任意 SQL，也不证明其他列有权限。",
		schema(map[string]map[string]interface{}{
			"table_name": enumProp("已批准的 Hive 表", "epower_platform.price_sensitive_v1_3", "charge_dw.dwd_charge_trd_order_di"),
			"dt":         strProp("分区日期 YYYY-MM-DD"),
		}, "table_name", "dt"),
		&port.RouteInfo{Method: "POST", Path: "/daemon/internal-sources/hive-data/probe", Required: []string{"table_name", "dt"}},
	)
}
