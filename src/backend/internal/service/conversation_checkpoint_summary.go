package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func buildFallbackCheckpointSummary(messages []model.Message) model.CheckpointSummary {
	summary := emptyCheckpointSummary()
	for _, message := range messages {
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		if summary.Objective == "" && message.Role == "user" {
			summary.Objective = truncateCheckpointText(content, 500)
		}
		if message.Role == "assistant" {
			summary.CompletedWork = append(summary.CompletedWork, truncateCheckpointText(content, 400))
			if len(summary.CompletedWork) > 3 {
				summary.CompletedWork = summary.CompletedWork[len(summary.CompletedWork)-3:]
			}
		}
		summary.CurrentState = truncateCheckpointText(content, 1200)
	}
	if summary.Objective == "" {
		summary.Objective = "继续当前会话中的工作"
	}
	if summary.CurrentState == "" {
		summary.CurrentState = "当前会话尚无可摘要的文本状态"
	}
	return summary
}

func emptyCheckpointSummary() model.CheckpointSummary {
	return model.CheckpointSummary{
		CompletedWork: []string{},
		Decisions:     []string{},
		Constraints:   []string{},
		RemainingWork: []string{},
		ChangedFiles:  []string{},
		TestStatus:    []string{},
		ArtifactRefs:  []string{},
		OpenQuestions: []string{},
	}
}

func renderCheckpointMarkdown(summary model.CheckpointSummary) string {
	var builder strings.Builder
	builder.WriteString("# Conversation Checkpoint\n\n")
	writeCheckpointSection(&builder, "原始目标", []string{summary.Objective})
	writeCheckpointSection(&builder, "已完成", summary.CompletedWork)
	writeCheckpointSection(&builder, "当前状态", []string{summary.CurrentState})
	writeCheckpointSection(&builder, "关键决策", summary.Decisions)
	writeCheckpointSection(&builder, "约束", summary.Constraints)
	writeCheckpointSection(&builder, "待完成", summary.RemainingWork)
	writeCheckpointSection(&builder, "变更文件", summary.ChangedFiles)
	writeCheckpointSection(&builder, "验证状态", summary.TestStatus)
	writeCheckpointSection(&builder, "相关产物", summary.ArtifactRefs)
	writeCheckpointSection(&builder, "开放问题", summary.OpenQuestions)
	return strings.TrimSpace(builder.String()) + "\n"
}

func writeCheckpointSection(builder *strings.Builder, title string, items []string) {
	filtered := make([]string, 0, len(items))
	for _, item := range items {
		if value := strings.TrimSpace(item); value != "" {
			filtered = append(filtered, value)
		}
	}
	if len(filtered) == 0 {
		return
	}
	fmt.Fprintf(builder, "## %s\n", title)
	for _, item := range filtered {
		fmt.Fprintf(builder, "- %s\n", item)
	}
	builder.WriteString("\n")
}

func checkpointSummaryUsable(summary model.CheckpointSummary) bool {
	return strings.TrimSpace(summary.Objective) != "" || strings.TrimSpace(summary.CurrentState) != ""
}

func estimateCheckpointTokens(text string) int64 {
	if text == "" {
		return 0
	}
	// 无 provider usage 时使用保守估算；调用方必须将其标记为 estimate。
	return int64((utf8.RuneCountInString(text) + 2) / 3)
}

func estimateMessagesTokens(messages []model.Message) int64 {
	var tokens int64
	for _, message := range messages {
		tokens += estimateCheckpointTokens(message.Content) + 4
	}
	return tokens
}

func truncateCheckpointText(text string, limit int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "..."
}
