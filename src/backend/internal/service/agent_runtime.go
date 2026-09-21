package service

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
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

// 只验证参数形状，可用模型以目标运行器的实时目录为准。
var runtimeModelIdentifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]*$`)

// NormalizeAgentRuntimeConfig converts an omitted policy into the safe product default and
// rejects arbitrary model/config strings before they can reach a local CLI process.
func NormalizeAgentRuntimeConfig(input model.AgentRuntimeConfig) (model.AgentRuntimeConfig, error) {
	if (input.Version == 0 || input.Version == 1) && input.ServiceTier != "" {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: service tier requires runtime config v2", ErrMsgInvalidRuntime)
	}
	if input.Version == 0 || input.Version == 1 {
		input.Version = 2
		input.ServiceTier = "default"
	}
	if input.Version != 2 {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: unsupported version", ErrMsgInvalidRuntime)
	}
	if input.ReasoningEffort == "" {
		input.ReasoningEffort = "medium"
	}
	if input.ApprovalMode == "" {
		input.ApprovalMode = "auto"
	}
	if input.ServiceTier == "" {
		input.ServiceTier = "default"
	}
	if input.Model == "default" {
		input.Model = ""
	}
	if input.Model != "" && (len(input.Model) > 200 || !runtimeModelIdentifier.MatchString(input.Model)) {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: unsupported model", ErrMsgInvalidRuntime)
	}
	if input.ReasoningEffort != "none" && input.ReasoningEffort != "minimal" && input.ReasoningEffort != "low" && input.ReasoningEffort != "medium" && input.ReasoningEffort != "high" && input.ReasoningEffort != "xhigh" && input.ReasoningEffort != "max" && input.ReasoningEffort != "ultra" {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: unsupported reasoning effort", ErrMsgInvalidRuntime)
	}
	if input.ApprovalMode != "request" && input.ApprovalMode != "auto" && input.ApprovalMode != "full" {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: unsupported approval mode", ErrMsgInvalidRuntime)
	}
	if input.ServiceTier != "default" && input.ServiceTier != "priority" {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: unsupported service tier", ErrMsgInvalidRuntime)
	}
	if input.ServiceTier == "priority" && (input.Model == "gpt-5.4-mini" || input.Model == "gpt-5.3-codex-spark") {
		return model.AgentRuntimeConfig{}, fmt.Errorf("%w: model does not support priority service tier", ErrMsgInvalidRuntime)
	}
	return input, nil
}
