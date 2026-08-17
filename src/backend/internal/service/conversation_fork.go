package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/agent-hub/backend/internal/model"
)

var (
	ErrConversationForkUnavailable = errors.New("conversation fork is not configured")
	ErrConversationForkTitle       = errors.New("Fork 标题不合法")
)

type ConversationForkStore interface {
	Create(ctx context.Context, input model.CreateConversationForkInput) (*model.ConversationForkResult, error)
	GetByChild(ctx context.Context, childConversationID, userID string) (*model.ConversationFork, error)
}

func (s *ConversationContextService) SetForkStore(store ConversationForkStore) { s.forks = store }

// Fork 从稳定 checkpoint 创建新的 Conversation 和 generation 1 Session，父分支保持只读不变。
func (s *ConversationContextService) Fork(ctx context.Context, userID, sourceConversationID, checkpointID, targetAgentID, title string) (*model.ConversationForkResult, error) {
	if s == nil || s.forks == nil || s.checkpoints == nil || s.agents == nil {
		return nil, ErrConversationForkUnavailable
	}
	title = strings.TrimSpace(title)
	if len([]rune(title)) > 255 {
		return nil, ErrConversationForkTitle
	}
	continuation, err := s.checkpoints.PrepareContinuation(ctx, model.ContinueFromCheckpointInput{
		ConversationID: sourceConversationID,
		CheckpointID:   checkpointID,
		TargetAgentID:  targetAgentID,
		Mode:           "fork",
	}, userID)
	if err != nil {
		return nil, err
	}
	cp := continuation.Checkpoint
	if cp.Status != model.CheckpointStatusReady && cp.Status != model.CheckpointStatusFailedFallback {
		return nil, ErrCheckpointNotReady
	}
	agent, err := s.agents.GetByID(ctx, continuation.TargetAgentID)
	if err != nil {
		return nil, fmt.Errorf("get fork target agent: %w", err)
	}
	if agent == nil {
		return nil, ErrCheckpointAgentBound
	}
	bootstrap := checkpointBootstrapContext(cp.Markdown)
	result, err := s.forks.Create(ctx, model.CreateConversationForkInput{
		ParentConversationID: sourceConversationID,
		CheckpointID:         cp.ID,
		ForkedFromMessageID:  cp.SourceToMessageID,
		SourceAgentID:        cp.SourceAgentID,
		TargetAgentID:        continuation.TargetAgentID,
		CreatedBy:            userID,
		Title:                title,
		TargetCLITool:        agent.CLITool,
		ContextWindowTokens:  ContextWindowForCLITool(agent.CLITool),
		InitialContextTokens: EstimateTokens(bootstrap),
	})
	if err != nil {
		return nil, fmt.Errorf("create conversation fork: %w", err)
	}
	result.Session.AgentName = agent.Name
	return result, nil
}

func (s *ConversationContextService) GetFork(ctx context.Context, userID, childConversationID string) (*model.ConversationFork, error) {
	if s == nil || s.forks == nil {
		return nil, ErrConversationForkUnavailable
	}
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(childConversationID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	return s.forks.GetByChild(ctx, childConversationID, userID)
}
