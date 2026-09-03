package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
)

func (s *ConversationCheckpointService) List(ctx context.Context, conversationID, userID string, limit int) ([]model.ConversationCheckpoint, error) {
	if _, err := s.requireMember(ctx, conversationID, userID); err != nil {
		return nil, err
	}
	checkpoints, err := s.repo.ListByConversation(ctx, conversationID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list checkpoints: %w", err)
	}
	visible := make([]model.ConversationCheckpoint, 0, len(checkpoints))
	for _, checkpoint := range checkpoints {
		bound, checkErr := s.agentRepo.IsAgentInConversation(ctx, conversationID, checkpoint.SourceAgentID, userID)
		if checkErr != nil {
			return nil, fmt.Errorf("check listed checkpoint agent: %w", checkErr)
		}
		if bound {
			visible = append(visible, checkpoint)
		}
	}
	return visible, nil
}

func (s *ConversationCheckpointService) Get(ctx context.Context, conversationID, checkpointID, userID string) (*model.ConversationCheckpoint, error) {
	if _, err := s.requireMember(ctx, conversationID, userID); err != nil {
		return nil, err
	}
	checkpoint, err := s.getCheckpoint(ctx, checkpointID)
	if err != nil {
		return nil, err
	}
	if checkpoint.ConversationID != conversationID {
		return nil, ErrCheckpointNotFound
	}
	if !checkpointReadableBy(*checkpoint, userID) {
		return nil, ErrCheckpointNoPerm
	}
	bound, err := s.agentRepo.IsAgentInConversation(ctx, conversationID, checkpoint.SourceAgentID, userID)
	if err != nil {
		return nil, fmt.Errorf("check checkpoint source agent: %w", err)
	}
	if !bound {
		return nil, ErrCheckpointNoPerm
	}
	return checkpoint, nil
}

func (s *ConversationCheckpointService) Delete(ctx context.Context, conversationID, checkpointID, userID string) error {
	conv, err := s.requireMember(ctx, conversationID, userID)
	if err != nil {
		return err
	}
	checkpoint, err := s.getCheckpoint(ctx, checkpointID)
	if err != nil {
		return err
	}
	if checkpoint.ConversationID != conversationID {
		return ErrCheckpointNotFound
	}
	bound, err := s.agentRepo.IsAgentInConversation(ctx, conversationID, checkpoint.SourceAgentID, userID)
	if err != nil {
		return fmt.Errorf("check deleted checkpoint agent: %w", err)
	}
	if !bound || (checkpoint.CreatedBy != userID && conv.UserID != userID) {
		return ErrCheckpointNoPerm
	}
	if err := s.repo.Delete(ctx, checkpointID); err != nil {
		if errors.Is(err, repository.ErrConversationCheckpointNotFound) {
			return ErrCheckpointNotFound
		}
		return fmt.Errorf("delete checkpoint: %w", err)
	}
	return nil
}

func (s *ConversationCheckpointService) PrepareContinuation(ctx context.Context, input model.ContinueFromCheckpointInput, userID string) (*model.CheckpointContinuation, error) {
	checkpoint, err := s.Get(ctx, input.ConversationID, input.CheckpointID, userID)
	if err != nil {
		return nil, err
	}
	targetAgentID := strings.TrimSpace(input.TargetAgentID)
	if targetAgentID == "" {
		targetAgentID = checkpoint.SourceAgentID
	}
	bound, err := s.agentRepo.IsAgentInConversation(ctx, input.ConversationID, targetAgentID, userID)
	if err != nil {
		return nil, fmt.Errorf("check continuation agent binding: %w", err)
	}
	if !bound {
		return nil, ErrCheckpointAgentBound
	}
	if (checkpoint.Scope == model.CheckpointScopePrivateAgent || checkpoint.Scope == model.CheckpointScopeOrchestratorOnly) && targetAgentID != checkpoint.SourceAgentID {
		return nil, ErrCheckpointScope
	}
	return &model.CheckpointContinuation{Checkpoint: *checkpoint, TargetAgentID: targetAgentID, FreshSession: true}, nil
}

func (s *ConversationCheckpointService) requireMember(ctx context.Context, conversationID, userID string) (*model.Conversation, error) {
	if strings.TrimSpace(conversationID) == "" || strings.TrimSpace(userID) == "" {
		return nil, ErrCheckpointInvalid
	}
	conv, err := s.convRepo.GetByID(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("get checkpoint conversation: %w", err)
	}
	if conv == nil {
		return nil, ErrCheckpointNotFound
	}
	member, err := s.convRepo.GetMember(ctx, conversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check checkpoint member: %w", err)
	}
	if member == nil && conv.UserID != userID {
		return nil, ErrCheckpointNoPerm
	}
	return conv, nil
}

func (s *ConversationCheckpointService) getCheckpoint(ctx context.Context, checkpointID string) (*model.ConversationCheckpoint, error) {
	checkpoint, err := s.repo.GetByID(ctx, checkpointID)
	if errors.Is(err, repository.ErrConversationCheckpointNotFound) {
		return nil, ErrCheckpointNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get checkpoint: %w", err)
	}
	return checkpoint, nil
}

func checkpointReadableBy(checkpoint model.ConversationCheckpoint, userID string) bool {
	return checkpoint.Scope == model.CheckpointScopeConversationShared ||
		checkpoint.Scope == model.CheckpointScopeTaskShared || checkpoint.CreatedBy == userID
}

func validCheckpointScope(scope string) bool {
	switch scope {
	case model.CheckpointScopePrivateAgent, model.CheckpointScopeTaskShared,
		model.CheckpointScopeConversationShared, model.CheckpointScopeOrchestratorOnly:
		return true
	default:
		return false
	}
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
