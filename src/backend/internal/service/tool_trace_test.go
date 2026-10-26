package service

import (
	"encoding/json"
	"reflect"
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

func TestErrorTraceSanitizesLiveDiagnosticsWithoutChangingNormalEvents(t *testing.T) {
	secret := "api_key=stream-secret"
	normal := model.AgentEvent{Type: model.AgentEventTextDelta, Content: "正常正文保持不变"}
	events := []model.AgentEvent{normal, {
		Type: model.AgentEventError, Seq: 42, Message: "workspace routing discovery timed out\nAuthorization: Bearer stream-secret",
		Content: secret, Text: secret, Reason: secret, Output: secret, Delta: secret, Input: json.RawMessage(`{"password":"stream-secret"}`), Result: map[string]string{"secret": "stream-secret"},
		Adapter: secret, Tool: secret, ToolUseID: secret, ToolUseIDAlt: secret, ToolKind: secret, SkillName: secret, ServerName: secret, SourcePath: secret,
	}}
	safe := SanitizeToolTraceEvents(events, nil)
	wire, _ := json.Marshal(safe)
	if strings.Contains(string(wire), "stream-secret") {
		t.Fatalf("live diagnostic credential escaped: %s", wire)
	}
	if !reflect.DeepEqual(safe[0], normal) {
		t.Fatalf("normal text changed: %+v", safe[0])
	}
	if safe[1].Type != model.AgentEventError || safe[1].Seq != 42 || !strings.Contains(safe[1].Message, "workspace routing discovery timed out") {
		t.Fatalf("error identity/reason lost: %+v", safe[1])
	}
	if !strings.Contains(events[1].Message, "stream-secret") {
		t.Fatal("input events unexpectedly mutated")
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
