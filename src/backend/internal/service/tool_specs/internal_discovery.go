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
