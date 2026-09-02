package service

import (
	"context"
	"fmt"
	"time"

	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/repository"
)

const agentRuntimeRecentLimit = 5

// AgentRuntimeService 提供 Agent Profile 所需的真实持久化运行概览。
type AgentRuntimeService struct {
	store repository.AgentRuntimeStore
}

func NewAgentRuntimeService(store repository.AgentRuntimeStore) *AgentRuntimeService {
	return &AgentRuntimeService{store: store}
}

func (s *AgentRuntimeService) GetOverview(
	ctx context.Context,
	userID, agentID string,
	days int,
	now time.Time,
) (*model.AgentRuntimeOverview, error) {
	if s == nil || s.store == nil || userID == "" || agentID == "" || days < 1 || days > 90 {
		return nil, ErrAgentInvalidInput
	}
	overview, err := s.store.GetRuntimeOverview(ctx, userID, agentID, now.AddDate(0, 0, -days), agentRuntimeRecentLimit)
	if err != nil {
		return nil, fmt.Errorf("get agent runtime overview: %w", err)
	}
	if overview == nil {
		return nil, ErrAgentNotFound
	}
	overview.PeriodDays = days
	if overview.RecentRuns == nil {
		overview.RecentRuns = make([]model.AgentRuntimeRecentRun, 0)
	}
	return overview, nil
}
