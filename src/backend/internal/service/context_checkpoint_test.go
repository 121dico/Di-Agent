package service

import (
	"context"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type fakeAttachedCheckpointSessions struct {
	session *model.AgentSession
}

func (f fakeAttachedCheckpointSessions) GetActive(context.Context, string, string) (*model.AgentSession, error) {
	return f.session, nil
}

type fakeAttachedCheckpoints struct {
	checkpoint *model.ConversationCheckpoint
}

func (f fakeAttachedCheckpoints) GetByID(context.Context, string) (*model.ConversationCheckpoint, error) {
	return f.checkpoint, nil
}

func TestAttachedCheckpointBuilderInjectsCurrentSessionCheckpoint(t *testing.T) {
	builder := &AttachedCheckpointBuilder{
		Sessions: fakeAttachedCheckpointSessions{session: &model.AgentSession{CheckpointID: "checkpoint-1"}},
		Checkpoints: fakeAttachedCheckpoints{checkpoint: &model.ConversationCheckpoint{
			ID: "checkpoint-1", Status: model.CheckpointStatusReady, Markdown: "# 已完成\n\n- API 已实现",
		}},
	}

	result := builder.Build(context.Background(), ContextInput{
		ConvID: "conv-1", Agent: &model.Agent{ID: "agent-1"},
	}, "[原上下文]\n")
	if !strings.Contains(result, "[当前 Session 引入的 Conversation Checkpoint]") ||
		!strings.Contains(result, "API 已实现") || !strings.HasSuffix(result, "[原上下文]\n") {
		t.Fatalf("unexpected attached checkpoint context: %q", result)
	}
}

func TestAttachedCheckpointBuilderIgnoresSessionWithoutCheckpoint(t *testing.T) {
	builder := &AttachedCheckpointBuilder{
		Sessions:    fakeAttachedCheckpointSessions{session: &model.AgentSession{}},
		Checkpoints: fakeAttachedCheckpoints{},
	}
	if result := builder.Build(context.Background(), ContextInput{
		ConvID: "conv-1", Agent: &model.Agent{ID: "agent-1"},
	}, "existing"); result != "existing" {
		t.Fatalf("result = %q, want existing", result)
	}
}
