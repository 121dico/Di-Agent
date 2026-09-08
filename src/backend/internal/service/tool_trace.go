package service

import (
	"encoding/json"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// SanitizeToolTraceEvents protects the live broadcast and persisted replay equally.
// Full local Skill bodies belong in the local runtime, never in trace results.
func SanitizeToolTraceEvents(events []model.AgentEvent, previous []model.MessageBlock) []model.AgentEvent {
	calls := make(map[string]model.AgentEvent)
	lastCallID := ""
	for _, b := range previous {
		if b.Kind == model.BlockKindToolUse && b.ToolUseID != "" {
			lastCallID = b.ToolUseID
			calls[b.ToolUseID] = model.AgentEvent{Tool: b.ToolName, ToolUseID: b.ToolUseID, ToolKind: b.ToolKind, SkillName: b.SkillName, ServerName: b.ServerName, SourcePath: b.SourcePath, Input: json.RawMessage(b.Text)}
		}
	}
	out := append([]model.AgentEvent(nil), events...)
	for i := range out {
		e := &out[i]
		id := e.ToolUseIDOrAlt()
		switch e.Type {
		case model.AgentEventToolUse, model.AgentEventToolCallStart:
			if e.Tool != "" && id != "" {
				call := *e
				call.Input = json.RawMessage(initialToolInput(e.Input))
				calls[id] = call
				lastCallID = id
			} else if e.Tool == "" {
				if id == "" {
					id = lastCallID
				}
				if call, ok := calls[id]; ok {
					delta := e.Content
					if delta == "" && len(e.Input) > 0 {
						delta = decodeInputRawMessage(e.Input)
					}
					call.Input = append(append(json.RawMessage(nil), call.Input...), []byte(delta)...)
					calls[id] = call
				}
			}
		case model.AgentEventToolCallInput:
			if id == "" {
				id = lastCallID
			}
			if call, ok := calls[id]; ok {
				call.Input = append(append(json.RawMessage(nil), call.Input...), []byte(e.Delta)...)
				calls[id] = call
			}
		case model.AgentEventToolResultOld, model.AgentEventToolResultNew:
			if call, ok := calls[id]; ok {
				if e.ToolKind == "" {
					e.ToolKind = call.ToolKind
				}
				if e.SkillName == "" {
					e.SkillName = call.SkillName
				}
				if e.ServerName == "" {
					e.ServerName = call.ServerName
				}
				if e.SourcePath == "" {
					e.SourcePath = call.SourcePath
				}
				if e.Tool == "" {
					e.Tool = call.Tool
				}
				// Old daemons may provide only a local source path as a tool argument.
				if strings.HasSuffix(call.Tool, "get_agent_skill") && e.SourcePath == "" {
					var input struct {
						Name       string `json:"name"`
						SourcePath string `json:"source_path"`
					}
					if json.Unmarshal(call.Input, &input) == nil && input.SourcePath != "" {
						e.SourcePath = input.SourcePath
						e.SkillName = input.Name
						e.ToolKind = "skill"
					}
				}
			}
			if e.ToolKind == "skill" && e.SourcePath != "" {
				summary, _ := json.Marshal(map[string]any{"skill_name": e.SkillName, "source_path": e.SourcePath, "loaded": !e.IsErrorOrAlt(), "content_retained_locally": true})
				e.Output = string(summary)
				e.Content = ""
				e.Text = ""
				e.Message = ""
				e.Reason = ""
				e.Result = nil
				e.Input = nil
				e.Delta = ""
			}
		}
	}
	return out
}
