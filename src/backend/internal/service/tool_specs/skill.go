package tool_specs

import "github.com/121dico/Di-Agent/src/backend/internal/port"

// ── Skill tools ──

// GetAgentSkill 返回按名称在本机加载 Skill 的工具规格，本地未找到时回退到平台分配。
// RouteInfo 为 nil，需要 daemon 侧自定义 handler（按当前 agent 过滤 skill 归属）。
func GetAgentSkill() port.MCPToolSpec {
	return newRouteSpec(
		"get_agent_skill",
		"获取 Agent Skill",
		"skill",
		"根据本地 Skill 索引中的 name，在当前 Agent 本机加载完整 SKILL.md 和资源位置；正文保留在本机，平台只同步用途和用法索引。本地未找到时回退到已分配的平台 Skill。",
		schema(map[string]map[string]interface{}{
			"name": strProp("当前 Agent 索引中的 Skill 名称（必填，仅传名称，不传文件路径）"),
		}, "name"),
		nil,
	)
}

func ListPlatformSkills() port.MCPToolSpec {
	return newRouteSpec(
		"list_platform_skills",
		"平台 Skills",
		"skill",
		"列出所有平台 Skill 摘要，包含名称、分类、描述和触发场景，用于为 Agent 分配 Skill。",
		noParams(),
		&port.RouteInfo{Method: "GET", Path: "/mcp/platform-skills"},
	)
}
