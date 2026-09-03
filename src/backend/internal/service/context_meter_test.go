package service

import (
	"context"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type fakeContextMeterRepo struct {
	active *model.AgentSession
}

func (f *fakeContextMeterRepo) EnsureActive(_ context.Context, conversationID, agentID, cliTool string, capacity int64) (*model.AgentSession, error) {
	if f.active == nil {
		f.active = &model.AgentSession{
			ID: "session-1", ConversationID: conversationID, AgentID: agentID,
			CLITool: cliTool, Generation: 1, LifecycleStatus: model.AgentSessionActive,
			ContextWindowTokens: capacity, Status: model.ContextBudgetNormal,
			Source: model.ContextUsageEstimated,
		}
	}
	copy := *f.active
	return &copy, nil
}

func (f *fakeContextMeterRepo) GetActive(_ context.Context, _, _ string) (*model.AgentSession, error) {
	if f.active == nil {
		return nil, nil
	}
	copy := *f.active
	return &copy, nil
}

func (f *fakeContextMeterRepo) AddUsage(_ context.Context, _ string, inputTokens, outputTokens int64, ratio float64, status, source string) (*model.AgentSession, error) {
	f.active.ActiveContextTokens += inputTokens + outputTokens
	f.active.TotalInputTokens += inputTokens
	f.active.TotalOutputTokens += outputTokens
	f.active.UsageRatio = ratio
	f.active.Status = status
	f.active.Source = source
	copy := *f.active
	return &copy, nil
}

func (f *fakeContextMeterRepo) AttachCheckpoint(_ context.Context, _ string, checkpointID string) (*model.AgentSession, error) {
	f.active.CheckpointID = checkpointID
	copy := *f.active
	return &copy, nil
}

func (f *fakeContextMeterRepo) Rollover(_ context.Context, conversationID, agentID, cliTool, checkpointID string, capacity, initialTokens int64, ratio float64, status, source string) (*model.AgentSession, error) {
	generation, compactions := 1, 0
	if f.active != nil {
		generation = f.active.Generation + 1
		compactions = f.active.CompactionCount + 1
	}
	f.active = &model.AgentSession{
		ID: "session-next", ConversationID: conversationID, AgentID: agentID, CLITool: cliTool,
		Generation: generation, LifecycleStatus: model.AgentSessionActive,
		ActiveContextTokens: initialTokens, TotalInputTokens: initialTokens,
		ContextWindowTokens: capacity, UsageRatio: ratio, Status: status, Source: source,
		CompactionCount: compactions, CheckpointID: checkpointID,
	}
	copy := *f.active
	return &copy, nil
}

func (f *fakeContextMeterRepo) SetCLISessionID(_ context.Context, _, _, cliSessionID string) error {
	f.active.CLISessionID = cliSessionID
	return nil
}

func TestEstimateTokensMixedText(t *testing.T) {
	if got := EstimateTokens("abcd你好"); got != 3 {
		t.Fatalf("EstimateTokens() = %d, want 3", got)
	}
}

func TestContextMeterRecordDispatchTracksEstimatedBudget(t *testing.T) {
	repo := &fakeContextMeterRepo{}
	svc := NewContextMeterService(repo)

	usage, err := svc.RecordDispatch(context.Background(), RecordContextUsageInput{
		ConversationID: "conv-1", AgentID: "agent-1", CLITool: "claude",
		Prompt: "abcdefgh", Context: "上下文", Output: "done",
	})
	if err != nil {
		t.Fatal(err)
	}
	if usage.ActiveContextTokens != 6 {
		t.Fatalf("active tokens = %d, want 6", usage.ActiveContextTokens)
	}
	if usage.ContextWindowTokens != 200_000 {
		t.Fatalf("capacity = %d, want 200000", usage.ContextWindowTokens)
	}
	if usage.Source != model.ContextUsageEstimated || usage.Status != model.ContextBudgetNormal {
		t.Fatalf("unexpected meter labels: source=%s status=%s", usage.Source, usage.Status)
	}
}

func TestContextMeterUsesActualUsageWhenProvided(t *testing.T) {
	repo := &fakeContextMeterRepo{}
	svc := NewContextMeterService(repo)

	usage, err := svc.RecordDispatch(context.Background(), RecordContextUsageInput{
		ConversationID: "conv-1", AgentID: "agent-1", CLITool: "codex",
		InputTokens: 90_000, OutputTokens: 2_000, Source: model.ContextUsageActual,
	})
	if err != nil {
		t.Fatal(err)
	}
	if usage.Source != model.ContextUsageActual {
		t.Fatalf("source = %q, want actual", usage.Source)
	}
	if usage.Status != model.ContextBudgetWarning {
		t.Fatalf("status = %q, want warning", usage.Status)
	}
}

func TestContextMeterRolloverReturnsFreshDirective(t *testing.T) {
	repo := &fakeContextMeterRepo{active: &model.AgentSession{
		ID: "session-1", ConversationID: "conv-1", AgentID: "agent-1",
		Generation: 3, CompactionCount: 2, ContextWindowTokens: 128_000,
	}}
	svc := NewContextMeterService(repo)

	directive, err := svc.Rollover(context.Background(), RolloverAgentSessionInput{
		ConversationID: "conv-1", AgentID: "agent-1", CLITool: "codex",
		CheckpointID: "checkpoint-1", InitialContext: "压缩后的上下文",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !directive.ForceFreshSession {
		t.Fatal("rollover must force a fresh CLI session")
	}
	if directive.Session.Generation != 4 || directive.Session.CompactionCount != 3 {
		t.Fatalf("generation/compaction = %d/%d, want 4/3", directive.Session.Generation, directive.Session.CompactionCount)
	}
	if directive.Session.CheckpointID != "checkpoint-1" {
		t.Fatalf("checkpoint = %q", directive.Session.CheckpointID)
	}
}

func TestContextMeterAttachCheckpointKeepsCurrentGeneration(t *testing.T) {
	repo := &fakeContextMeterRepo{active: &model.AgentSession{
		ID: "session-1", ConversationID: "conv-1", AgentID: "agent-1",
		Generation: 3, ContextWindowTokens: 128_000,
	}}
	svc := NewContextMeterService(repo)

	usage, err := svc.AttachCheckpoint(context.Background(), "conv-1", "agent-1", "codex", "checkpoint-1")
	if err != nil {
		t.Fatal(err)
	}
	if usage.Generation != 3 || usage.CheckpointID != "checkpoint-1" {
		t.Fatalf("generation/checkpoint = %d/%q, want 3/checkpoint-1", usage.Generation, usage.CheckpointID)
	}
}
