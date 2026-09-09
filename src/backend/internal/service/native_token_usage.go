package service

import (
	"context"
	"fmt"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type nativeUsageRepository interface {
	SaveNativeUsage(context.Context, *model.AgentSession, string, *model.TokenUsage) error
	ReadNativeUsage(context.Context, *model.AgentSession) error
}

func (s *ContextMeterService) RecordNativeUsage(ctx context.Context, task *model.DaemonTask, usage *model.TokenUsage) error {
	if task == nil || task.ID == "" || task.ConversationID == "" || task.AgentID == "" {
		return ErrContextMeterInvalidInput
	}
	if usage == nil {
		usage = &model.TokenUsage{Provider: task.CLITool, Source: "unknown", ObservedAt: time.Now()}
	} else if !usage.Valid() {
		return ErrContextMeterInvalidInput
	}
	repo, ok := s.repo.(nativeUsageRepository)
	if !ok {
		return fmt.Errorf("native usage repository unavailable")
	}
	session, err := s.repo.EnsureActive(ctx, task.ConversationID, task.AgentID, task.CLITool, 0)
	if err != nil {
		return err
	}
	if err := repo.SaveNativeUsage(ctx, session, task.ID, usage); err != nil {
		return err
	}
	if models, ok := s.repo.(interface {
		SaveObservedModel(context.Context, string, *model.TokenUsage) error
	}); ok {
		return models.SaveObservedModel(ctx, task.AgentID, usage)
	}
	return nil
}

// 历史字符估算不能作为当前上下文或真实累计。原生容量和当前快照缺一时不算百分比。
func (s *ContextMeterService) presentUsage(ctx context.Context, session *model.AgentSession) (*model.AgentSession, error) {
	if session == nil {
		return nil, nil
	}
	session.EstimatedSubmittedTokens = session.ActiveContextTokens
	session.ActiveContextTokens = 0
	session.ContextWindowTokens = 0
	session.UsageRatio = 0
	session.Status = "unknown"
	session.Source = "estimated"
	session.TotalInputTokens = 0
	session.TotalOutputTokens = 0
	if repo, ok := s.repo.(nativeUsageRepository); ok {
		if err := repo.ReadNativeUsage(ctx, session); err != nil {
			return nil, err
		}
	}
	if u := session.NativeUsage; u != nil {
		session.Source = "actual"
		session.UpdatedAt = u.ObservedAt
		if u.ContextTokens != nil {
			session.ActiveContextTokens = *u.ContextTokens
		}
		if u.ContextWindowTokens != nil {
			session.ContextWindowTokens = *u.ContextWindowTokens
		}
		if u.ContextTokens != nil && u.ContextWindowTokens != nil {
			session.UsageRatio, session.Status = contextBudget(*u.ContextTokens, *u.ContextWindowTokens)
		}
	}
	if u := session.NativeTotals; u != nil {
		if u.InputTokens != nil {
			session.TotalInputTokens = *u.InputTokens
		}
		if u.OutputTokens != nil {
			session.TotalOutputTokens = *u.OutputTokens
		}
	}
	return session, nil
}

func (s *ContextMeterService) RecordConfiguredModel(ctx context.Context, agentID, machineID, name string) error {
	if len(name) > 200 {
		return ErrContextMeterInvalidInput
	}
	if repo, ok := s.repo.(interface {
		SaveConfiguredModel(context.Context, string, string, string) error
	}); ok {
		return repo.SaveConfiguredModel(ctx, agentID, machineID, name)
	}
	return nil
}
