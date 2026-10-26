package tool_specs

import "github.com/121dico/Di-Agent/src/backend/internal/port"

// Register the local mutation for explicit grants; do not auto-add it to templates.
func SetManagedMCPEnabled() port.MCPToolSpec {
	input := schema(map[string]map[string]interface{}{
		"connector_id": enumProp("已审核的本机 MCP", "datadream", "cooper", "intranet-fetcher"),
		"enabled":      {"type": "boolean", "description": "用户要求接入时为 true，撤销时为 false"},
	}, "connector_id", "enabled")
	input["additionalProperties"] = false
	return newRouteSpec("set_managed_mcp_enabled", "接入或撤销本人 MCP", "knowledge",
		"仅在用户要求时，通过本人电脑验证并启用已审核 MCP，或撤销连接；不上传个人令牌，不扩大上游权限。", input, nil)
}
