package service

import (
	"strings"
	"testing"

	"github.com/agent-hub/backend/internal/model"
)

func TestParseCheckpointSummaryAcceptsJSONFence(t *testing.T) {
	summary, err := parseCheckpointSummary("```json\n{\"objective\":\"继续实现\",\"current_state\":\"测试通过\",\"remaining_work\":[]}\n```")
	if err != nil {
		t.Fatalf("parseCheckpointSummary() error = %v", err)
	}
	if summary.Objective != "继续实现" || summary.CurrentState != "测试通过" {
		t.Fatalf("unexpected summary: %#v", summary)
	}
}

func TestCheckpointTranscriptKeepsNewestContentWithinBudget(t *testing.T) {
	messages := []model.Message{
		{Role: "user", Content: strings.Repeat("旧", 20)},
		{Role: "assistant", Content: "最新状态"},
	}
	transcript, truncated := checkpointTranscript(messages, 18)
	if !truncated {
		t.Fatal("checkpointTranscript() truncated = false, want true")
	}
	if !strings.Contains(transcript, "最新状态") {
		t.Fatalf("transcript %q does not contain newest content", transcript)
	}
}

func TestParseCheckpointSummaryRejectsPlainText(t *testing.T) {
	if _, err := parseCheckpointSummary("总结完成"); err == nil {
		t.Fatal("parseCheckpointSummary() error = nil, want invalid JSON error")
	}
}
