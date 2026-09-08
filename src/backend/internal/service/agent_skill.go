package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	daemonOpenPathTool     = "__di_agent_open_path__"
	daemonInstallSkillTool = "__di_agent_install_skill__"
)

// DiscoveredSkill 兼容旧 daemon 的字符串能力，承载本地技能索引（Detail 仅供用户主动分配的平台指令）。
type DiscoveredSkill struct {
	Name        string `json:"name"`
	Category    string `json:"category,omitempty"`
	Description string `json:"description,omitempty"`
	Trigger     string `json:"trigger,omitempty"`
	Usage       string `json:"usage,omitempty"`
	Detail      string `json:"detail,omitempty"`
	SourcePath  string `json:"source_path,omitempty"`
	Auto        bool   `json:"auto,omitempty"`
}

func (s *DiscoveredSkill) UnmarshalJSON(data []byte) error {
	var name string
	if err := json.Unmarshal(data, &name); err == nil {
		s.Name = name
		s.Auto = true
		return nil
	}
	type skillAlias DiscoveredSkill
	var parsed skillAlias
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	*s = DiscoveredSkill(parsed)
	return nil
}

func hasDiscoveredSkillSource(capabilitiesJSON, sourcePath string) bool {
	sourcePath = strings.TrimSpace(sourcePath)
	if sourcePath == "" {
		return false
	}
	for _, skill := range parseDiscoveredSkills(capabilitiesJSON) {
		if strings.TrimSpace(skill.SourcePath) == sourcePath {
			return true
		}
	}
	return false
}

func parseDiscoveredSkills(capabilitiesJSON string) []DiscoveredSkill {
	var skills []DiscoveredSkill
	if err := json.Unmarshal([]byte(capabilitiesJSON), &skills); err != nil {
		return nil
	}
	return skills
}

func normalizeCustomSkills(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	var incoming []DiscoveredSkill
	if err := json.Unmarshal([]byte(raw), &incoming); err != nil {
		return "", err
	}
	seen := map[string]bool{}
	out := make([]DiscoveredSkill, 0, len(incoming))
	for _, skill := range incoming {
		name := strings.TrimSpace(skill.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, DiscoveredSkill{
			Name:        truncateString(name, 80),
			Category:    truncateString(strings.TrimSpace(skill.Category), 60),
			Description: truncateString(strings.TrimSpace(skill.Description), 200),
			Trigger:     truncateString(strings.TrimSpace(skill.Trigger), 200),
			Detail:      truncateString(strings.TrimSpace(skill.Detail), 2000),
		})
	}
	if len(out) == 0 {
		return "", nil
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func BuildAgentSkillContext(raw string) string {
	skills := parseDiscoveredSkills(raw)
	if len(skills) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("[平台 Skills]\n")
	sb.WriteString("以下是用户为当前 Agent 分配的平台 Skills。先参考索引判断是否需要使用；如需完整 Skill 详情，优先调用 MCP 工具 get_agent_skill，参数 name 填 Skill 名称。若该工具未授权，则仅依据索引执行。\n")
	sb.WriteString("{Skill 索引\n")
	for _, skill := range skills {
		name := strings.TrimSpace(skill.Name)
		if name == "" {
			continue
		}
		desc := strings.TrimSpace(skill.Description)
		if desc == "" {
			desc = "未配置"
		}
		trigger := strings.TrimSpace(skill.Trigger)
		if trigger == "" {
			trigger = "按任务语义判断"
		}
		label := normalizePromptLine(name)
		if category := strings.TrimSpace(skill.Category); category != "" {
			label = fmt.Sprintf("%s（%s）", label, normalizePromptLine(category))
		}
		fmt.Fprintf(&sb, "- %s：%s；触发：%s\n",
			truncateString(label, 100),
			truncateString(normalizePromptLine(desc), 200),
			truncateString(normalizePromptLine(trigger), 200),
		)
	}
	sb.WriteString("}\n")
	sb.WriteString("\n")
	return sb.String()
}

// localSkillCatalog is an allowlist boundary for both current and older daemons.
// A generic runtime capability is not evidence of a discovered local Skill.
func localSkillCatalog(skills []DiscoveredSkill) []DiscoveredSkill {
	out := make([]DiscoveredSkill, 0, len(skills))
	for _, skill := range skills {
		if strings.TrimSpace(skill.Name) == "" || strings.TrimSpace(skill.SourcePath) == "" {
			continue
		}
		out = append(out, DiscoveredSkill{Name: skill.Name, Description: skill.Description,
			Category: skill.Category, Trigger: skill.Trigger, Usage: skill.Usage, SourcePath: skill.SourcePath, Auto: skill.Auto})
	}
	return out
}

func BuildLocalSkillContext(raw string) string {
	skills := localSkillCatalog(parseDiscoveredSkills(raw))
	if len(skills) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("[本地 Skill 索引]\n以下是当前 Agent 本机扫描到的技能目录，目录不代表本轮已加载或使用。根据用途和用法选择；需要时调用本机 MCP get_agent_skill（仅传 name 参数，填写索引名称）加载，或用本地读取工具打开对应路径的 SKILL.md。正文与资源保留在本机，不要上传或在回复中复述全文。平台入库和分配不是使用本地技能的前置条件。\n")
	for _, skill := range skills {
		row, _ := json.Marshal(map[string]string{"name": skill.Name, "description": skill.Description, "trigger": skill.Trigger, "usage": skill.Usage, "source_path": skill.SourcePath})
		sb.WriteString(string(row))
		sb.WriteByte('\n')
	}
	sb.WriteByte('\n')
	return sb.String()
}
