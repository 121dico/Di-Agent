package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode"

	"github.com/agent-hub/backend/internal/model"
)

var ErrContextMeterInvalidInput = errors.New("invalid context meter input")

const (
	contextWarningRatio  = 0.70
	contextCriticalRatio = 0.85
	defaultContextWindow = int64(128_000)
)

var cliContextWindows = map[string]int64{
	"claude":   200_000,
	"codex":    128_000,
	"opencode": 128_000,
	"openclaw": 128_000,
}

type ContextMeterRepository interface {
	EnsureActive(ctx context.Context, conversationID, agentID, cliTool string, capacity int64) (*model.AgentSession, error)
	GetActive(ctx context.Context, conversationID, agentID string) (*model.AgentSession, error)
	AddUsage(ctx context.Context, sessionID string, inputTokens, outputTokens int64, ratio float64, status, source string) (*model.AgentSession, error)
	AttachCheckpoint(ctx context.Context, sessionID, checkpointID string) (*model.AgentSession, error)
	Rollover(ctx context.Context, conversationID, agentID, cliTool, checkpointID string, capacity, initialTokens int64, ratio float64, status, source string) (*model.AgentSession, error)
	SetCLISessionID(ctx context.Context, conversationID, agentID, cliSessionID string) error
}

type ContextMeterService struct {
	repo ContextMeterRepository
}

type RecordContextUsageInput struct {
	ConversationID string
	AgentID        string
	CLITool        string
	Prompt         string
	Context        string
	Output         string
	InputTokens    int64
	OutputTokens   int64
	Source         string
}

type RolloverAgentSessionInput struct {
	ConversationID string
	AgentID        string
	CLITool        string
	CheckpointID   string
	InitialContext string
	InitialTokens  int64
	Source         string
}

type SessionDispatchDirective struct {
	Session           *model.AgentSession `json:"session"`
	ForceFreshSession bool                `json:"force_fresh_session"`
}

func NewContextMeterService(repo ContextMeterRepository) *ContextMeterService {
	return &ContextMeterService{repo: repo}
}

func ContextWindowForCLITool(cliTool string) int64 {
	if capacity, ok := cliContextWindows[strings.ToLower(strings.TrimSpace(cliTool))]; ok {
		return capacity
	}
	return defaultContextWindow
}

// EstimateTokens is deliberately conservative and must be presented as estimated.
func EstimateTokens(text string) int64 {
	var asciiLike, wide int64
	for _, r := range text {
		if r <= unicode.MaxASCII {
			asciiLike++
		} else {
			wide++
		}
	}
	return wide + (asciiLike+3)/4
}

func (s *ContextMeterService) GetUsage(ctx context.Context, conversationID, agentID, cliTool string) (*model.AgentSession, error) {
	if strings.TrimSpace(conversationID) == "" || strings.TrimSpace(agentID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	session, err := s.repo.GetActive(ctx, conversationID, agentID)
	if err != nil {
		return nil, fmt.Errorf("get context usage: %w", err)
	}
	if session != nil {
		return session, nil
	}
	session, err = s.repo.EnsureActive(ctx, conversationID, agentID, cliTool, ContextWindowForCLITool(cliTool))
	if err != nil {
		return nil, fmt.Errorf("ensure context usage: %w", err)
	}
	return session, nil
}

// GetActiveUsage 只读取已存在的活动 Session，不会为了查询检查点来源而创建新代次。
func (s *ContextMeterService) GetActiveUsage(ctx context.Context, conversationID, agentID string) (*model.AgentSession, error) {
	if strings.TrimSpace(conversationID) == "" || strings.TrimSpace(agentID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	session, err := s.repo.GetActive(ctx, conversationID, agentID)
	if err != nil {
		return nil, fmt.Errorf("get active context usage: %w", err)
	}
	return session, nil
}

func (s *ContextMeterService) RecordDispatch(ctx context.Context, in RecordContextUsageInput) (*model.AgentSession, error) {
	if strings.TrimSpace(in.ConversationID) == "" || strings.TrimSpace(in.AgentID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	session, err := s.GetUsage(ctx, in.ConversationID, in.AgentID, in.CLITool)
	if err != nil {
		return nil, err
	}
	inputTokens := in.InputTokens
	outputTokens := in.OutputTokens
	source := in.Source
	if inputTokens <= 0 {
		inputTokens = EstimateTokens(in.Prompt) + EstimateTokens(in.Context)
		source = model.ContextUsageEstimated
	}
	if outputTokens <= 0 && in.Output != "" {
		outputTokens = EstimateTokens(in.Output)
		source = model.ContextUsageEstimated
	}
	if source != model.ContextUsageActual {
		source = model.ContextUsageEstimated
	}
	active := session.ActiveContextTokens + inputTokens + outputTokens
	ratio, status := contextBudget(active, session.ContextWindowTokens)
	updated, err := s.repo.AddUsage(ctx, session.ID, inputTokens, outputTokens, ratio, status, source)
	if err != nil {
		return nil, fmt.Errorf("record context usage: %w", err)
	}
	updated.AgentName = session.AgentName
	return updated, nil
}

// AttachCheckpoint 把已授权的检查点挂到当前活动 Session，不触发 Agent 执行或 Session 换代。
func (s *ContextMeterService) AttachCheckpoint(ctx context.Context, conversationID, agentID, cliTool, checkpointID string) (*model.AgentSession, error) {
	if strings.TrimSpace(conversationID) == "" || strings.TrimSpace(agentID) == "" || strings.TrimSpace(checkpointID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	session, err := s.GetUsage(ctx, conversationID, agentID, cliTool)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.AttachCheckpoint(ctx, session.ID, checkpointID)
	if err != nil {
		return nil, fmt.Errorf("attach context checkpoint: %w", err)
	}
	updated.AgentName = session.AgentName
	return updated, nil
}

func (s *ContextMeterService) Rollover(ctx context.Context, in RolloverAgentSessionInput) (*SessionDispatchDirective, error) {
	if strings.TrimSpace(in.ConversationID) == "" || strings.TrimSpace(in.AgentID) == "" {
		return nil, ErrContextMeterInvalidInput
	}
	initialTokens := in.InitialTokens
	source := in.Source
	if initialTokens <= 0 && in.InitialContext != "" {
		initialTokens = EstimateTokens(in.InitialContext)
		source = model.ContextUsageEstimated
	}
	if source != model.ContextUsageActual {
		source = model.ContextUsageEstimated
	}
	capacity := ContextWindowForCLITool(in.CLITool)
	ratio, status := contextBudget(initialTokens, capacity)
	session, err := s.repo.Rollover(ctx, in.ConversationID, in.AgentID, in.CLITool, in.CheckpointID, capacity, initialTokens, ratio, status, source)
	if err != nil {
		return nil, fmt.Errorf("roll over context session: %w", err)
	}
	return &SessionDispatchDirective{Session: session, ForceFreshSession: true}, nil
}

func (s *ContextMeterService) SetCLISessionID(ctx context.Context, conversationID, agentID, cliSessionID string) error {
	if conversationID == "" || agentID == "" || cliSessionID == "" {
		return ErrContextMeterInvalidInput
	}
	return s.repo.SetCLISessionID(ctx, conversationID, agentID, cliSessionID)
}

func contextBudget(active, capacity int64) (float64, string) {
	if capacity <= 0 {
		capacity = defaultContextWindow
	}
	ratio := math.Max(0, float64(active)/float64(capacity))
	status := model.ContextBudgetNormal
	if ratio >= contextCriticalRatio {
		status = model.ContextBudgetCritical
	} else if ratio >= contextWarningRatio {
		status = model.ContextBudgetWarning
	}
	return ratio, status
}
