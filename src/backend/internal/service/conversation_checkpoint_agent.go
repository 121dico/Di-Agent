package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

const checkpointTranscriptMaxRunes = 60_000

var ErrCheckpointSummaryAgentUnavailable = errors.New("checkpoint summary agent unavailable")

type CheckpointSummaryAgentStore interface {
	GetByID(ctx context.Context, id string) (*model.Agent, error)
}

// AgentCheckpointSummaryGenerator 通过现有 Dispatcher 调用用户选中的 Agent，且不产生聊天消息。
type AgentCheckpointSummaryGenerator struct {
	agents     CheckpointSummaryAgentStore
	dispatcher *Dispatcher
	queue      *AgentQueue
}

func NewAgentCheckpointSummaryGenerator(agents CheckpointSummaryAgentStore, dispatcher *Dispatcher, queue *AgentQueue) *AgentCheckpointSummaryGenerator {
	return &AgentCheckpointSummaryGenerator{agents: agents, dispatcher: dispatcher, queue: queue}
}

func (g *AgentCheckpointSummaryGenerator) GenerateCheckpointSummary(ctx context.Context, request CheckpointSummaryRequest) (model.CheckpointSummary, error) {
	if g == nil || g.agents == nil || g.dispatcher == nil || g.queue == nil {
		return model.CheckpointSummary{}, ErrCheckpointSummaryAgentUnavailable
	}
	agent, err := g.agents.GetByID(ctx, request.AgentID)
	if err != nil {
		return model.CheckpointSummary{}, fmt.Errorf("get checkpoint summary agent: %w", err)
	}
	if agent == nil || agent.MachineID == nil || strings.TrimSpace(*agent.MachineID) == "" {
		return model.CheckpointSummary{}, ErrCheckpointSummaryAgentUnavailable
	}

	prompt, err := buildCheckpointSummaryPrompt(request.Messages, request.Fallback)
	if err != nil {
		return model.CheckpointSummary{}, err
	}
	var result *DispatchPlanResult
	err = g.queue.Run(ctx, agent.ID, func() error {
		var dispatchErr error
		result, dispatchErr = g.dispatcher.DispatchPlan(ctx, DispatchPlan{
			Input: DispatchInput{
				ConvID:          request.ConversationID,
				UserID:          request.UserID,
				Agent:           agent,
				Prompt:          prompt,
				ContextMessages: "你正在生成可迁移的 Conversation Checkpoint。只总结可验证的工作状态，不要输出私有思维过程。",
			},
			StreamingRequested: false,
			ResultHandler: func(context.Context, *model.DaemonTask) (*model.Message, error) {
				return nil, nil
			},
		}, DispatchHooks{})
		return dispatchErr
	})
	if err != nil {
		return model.CheckpointSummary{}, fmt.Errorf("dispatch checkpoint summary: %w", err)
	}
	if result == nil || result.Task == nil {
		return model.CheckpointSummary{}, errors.New("checkpoint summary agent returned no task")
	}
	summary, err := parseCheckpointSummary(result.Task.Result)
	if err != nil {
		return model.CheckpointSummary{}, err
	}
	return summary, nil
}

func buildCheckpointSummaryPrompt(messages []model.Message, fallback model.CheckpointSummary) (string, error) {
	fallbackJSON, err := json.Marshal(fallback)
	if err != nil {
		return "", fmt.Errorf("marshal checkpoint fallback: %w", err)
	}
	transcript, truncated := checkpointTranscript(messages, checkpointTranscriptMaxRunes)
	truncatedNote := ""
	if truncated {
		truncatedNote = "\n注意：原始对话过长，下面只包含可用片段；请结合规则摘要补全，不能猜测。"
	}
	return fmt.Sprintf(`请把以下对话整理成可供新 Session 继续工作的检查点。
只返回一个 JSON 对象，不要使用 Markdown 代码块，也不要输出额外文字。
字段必须是：objective, completed_work, current_state, decisions, constraints, remaining_work, changed_files, test_status, artifact_refs, open_questions。
除 objective/current_state 外，其余字段都必须是字符串数组；没有证据的字段使用空数组。%s

后端规则摘要：
%s

原始对话片段：
%s`, truncatedNote, fallbackJSON, transcript), nil
}

func checkpointTranscript(messages []model.Message, maxRunes int) (string, bool) {
	if maxRunes <= 0 {
		return "", len(messages) > 0
	}
	parts := make([]string, 0, len(messages))
	used := 0
	truncated := false
	for i := len(messages) - 1; i >= 0; i-- {
		content := strings.TrimSpace(messages[i].Content)
		if content == "" {
			continue
		}
		part := fmt.Sprintf("[%s]\n%s", messages[i].Role, content)
		runes := []rune(part)
		if used+len(runes)+2 > maxRunes {
			remaining := maxRunes - used
			if remaining > 0 {
				parts = append(parts, string(runes[len(runes)-remaining:]))
			}
			truncated = true
			break
		}
		parts = append(parts, part)
		used += len(runes) + 2
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return strings.Join(parts, "\n\n"), truncated
}

func parseCheckpointSummary(raw string) (model.CheckpointSummary, error) {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(value, "```") {
		value = strings.TrimSpace(strings.TrimPrefix(value, "```json"))
		value = strings.TrimSpace(strings.TrimPrefix(value, "```JSON"))
		value = strings.TrimSpace(strings.TrimPrefix(value, "```"))
		value = strings.TrimSpace(strings.TrimSuffix(value, "```"))
	}
	start, end := strings.Index(value, "{"), strings.LastIndex(value, "}")
	if start < 0 || end < start {
		return model.CheckpointSummary{}, errors.New("checkpoint summary is not a JSON object")
	}
	var summary model.CheckpointSummary
	if err := json.Unmarshal([]byte(value[start:end+1]), &summary); err != nil {
		return model.CheckpointSummary{}, fmt.Errorf("decode checkpoint summary: %w", err)
	}
	if !checkpointSummaryUsable(summary) {
		return model.CheckpointSummary{}, errors.New("checkpoint summary is empty")
	}
	return summary, nil
}
