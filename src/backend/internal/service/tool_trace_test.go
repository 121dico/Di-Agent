package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestLocalSkillTraceRedactsBodyAcrossBatchesButKeepsPlatformOutput(t *testing.T) {
	previous := []model.MessageBlock{{Kind: model.BlockKindToolUse, ToolName: "get_agent_skill", ToolUseID: "local", ToolKind: "skill", SkillName: "review", SourcePath: "/skills/review/SKILL.md"}}
	events := []model.AgentEvent{
		{Type: model.AgentEventToolResultOld, ToolUseID: "local", Output: "PRIVATE LOCAL BODY", Content: "PRIVATE LOCAL BODY", IsError: true},
		{Type: model.AgentEventToolUse, Tool: "get_agent_skill", ToolUseID: "platform", Input: json.RawMessage(`{"name":"platform-review"}`)},
		{Type: model.AgentEventToolResultOld, ToolUseID: "platform", Output: "opted-in platform instructions"},
	}
	safe := SanitizeToolTraceEvents(events, previous)
	wire, _ := json.Marshal(safe)
	if strings.Contains(string(wire), "PRIVATE LOCAL BODY") {
		t.Fatal(string(wire))
	}
	if !safe[0].IsError || !strings.Contains(safe[0].Output, `"loaded":false`) || safe[0].SkillName != "review" {
		t.Fatal(safe[0])
	}
	if safe[2].Output != "opted-in platform instructions" || safe[2].ToolKind == "skill" {
		t.Fatal(safe[2])
	}
}

func TestLegacyLocalSkillResultRedactedAfterPartialInputInSameBatch(t *testing.T) {
	events := []model.AgentEvent{
		{Type: model.AgentEventToolUse, Tool: "mcp__local__get_agent_skill", ToolUseID: "local", Input: json.RawMessage(`{}`)},
		{Type: model.AgentEventToolUse, Input: json.RawMessage(`"{\"name\":\"review\",\"source_path\":\"/skills/review/SKILL.md\"}"`)},
		{Type: model.AgentEventToolResultOld, ToolUseID: "local", Output: "PRIVATE BODY"},
	}
	safe := SanitizeToolTraceEvents(events, nil)
	if strings.Contains(safe[2].Output, "PRIVATE BODY") || safe[2].SourcePath != "/skills/review/SKILL.md" {
		t.Fatal(safe[2])
	}
}
