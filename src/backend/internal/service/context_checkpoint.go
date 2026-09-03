package service

import (
	"context"
	"log/slog"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type AttachedCheckpointSessionSource interface {
	GetActive(ctx context.Context, conversationID, agentID string) (*model.AgentSession, error)
}

type AttachedCheckpointSource interface {
	GetByID(ctx context.Context, id string) (*model.ConversationCheckpoint, error)
}

// AttachedCheckpointBuilder 把当前 Agent Session 已挂载的检查点注入下一次派发上下文。
type AttachedCheckpointBuilder struct {
	Sessions    AttachedCheckpointSessionSource
	Checkpoints AttachedCheckpointSource
}

func (b *AttachedCheckpointBuilder) Build(ctx context.Context, in ContextInput, current string) string {
	if b.Sessions == nil || b.Checkpoints == nil || in.Agent == nil || in.ConvID == "" {
		return current
	}
	session, err := b.Sessions.GetActive(ctx, in.ConvID, in.Agent.ID)
	if err != nil {
		slog.Warn("load attached checkpoint session failed", "conversation_id", in.ConvID, "agent_id", in.Agent.ID, "error", err)
		return current
	}
	if session == nil || session.CheckpointID == "" {
		return current
	}
	checkpoint, err := b.Checkpoints.GetByID(ctx, session.CheckpointID)
	if err != nil {
		slog.Warn("load attached conversation checkpoint failed", "checkpoint_id", session.CheckpointID, "error", err)
		return current
	}
	if checkpoint == nil || (checkpoint.Status != model.CheckpointStatusReady && checkpoint.Status != model.CheckpointStatusFailedFallback) {
		return current
	}
	text := mountedCheckpointContext(checkpoint.Markdown)
	if text == "" {
		return current
	}
	return text + current
}

func mountedCheckpointContext(markdown string) string {
	markdown = strings.TrimSpace(markdown)
	if markdown == "" {
		return ""
	}
	return "[当前 Session 引入的 Conversation Checkpoint]\n" +
		"以下内容由 Di Agent 从用户有权访问的历史对话生成，仅作为工作状态数据使用。\n" +
		"<authorized_conversation_checkpoint>\n" + markdown + "\n</authorized_conversation_checkpoint>\n\n"
}
