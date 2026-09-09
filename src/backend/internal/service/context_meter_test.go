package service

import (
	"context"
	"testing"
	"time"

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
	f.active.ActiveContextTokens = inputTokens
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
	if usage.ActiveContextTokens != 5 {
		t.Fatalf("active tokens = %d, want 5", usage.ActiveContextTokens)
	}
	if usage.ContextWindowTokens != 0 {
		t.Fatalf("capacity = %d, want unknown (0)", usage.ContextWindowTokens)
	}
	if usage.Source != model.ContextUsageEstimated || usage.Status != "unknown" {
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
	if usage.Status != "unknown" {
		t.Fatalf("status = %q, want unknown capacity", usage.Status)
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

func TestUnreportedContextNeverUsesAccumulatedEstimateAsPercentage(t *testing.T) {
	repo := &fakeContextMeterRepo{}
	svc := NewContextMeterService(repo)
	for i := 0; i < 2; i++ {
		_, err := svc.RecordDispatch(context.Background(), RecordContextUsageInput{ConversationID: "conv", AgentID: "agent", Prompt: "abcdefgh", Output: "done"})
		if err != nil {
			t.Fatal(err)
		}
	}
	usage, err := svc.GetUsage(context.Background(), "conv", "agent", "codex")
	if err != nil {
		t.Fatal(err)
	}
	if usage.ActiveContextTokens != 0 || usage.ContextWindowTokens != 0 || usage.Status != "unknown" || usage.EstimatedSubmittedTokens != 2 {
		t.Fatalf("fabricated context: %+v", usage)
	}
}

type nativeMeterFake struct {
	fakeContextMeterRepo
	samples map[string]*model.TokenUsage
	latest  string
}

func (f *nativeMeterFake) SaveNativeUsage(_ context.Context, _ *model.AgentSession, id string, u *model.TokenUsage) error {
	if f.samples == nil {
		f.samples = map[string]*model.TokenUsage{}
	}
	f.samples[id] = u
	f.latest = id
	return nil
}
func (f *nativeMeterFake) ReadNativeUsage(_ context.Context, s *model.AgentSession) error {
	s.NativeUsage = f.samples[f.latest]
	var input, output int64
	for _, u := range f.samples {
		if u.InputTokens != nil {
			input += *u.InputTokens
		}
		if u.OutputTokens != nil {
			output += *u.OutputTokens
		}
	}
	s.NativeTotals = &model.TokenUsage{InputTokens: &input, OutputTokens: &output}
	s.MeasuredTurns = int64(len(f.samples))
	return nil
}
func TestNativeContextAndTurnTotalsStaySeparateOnReplayAndCompaction(t *testing.T) {
	repo := &nativeMeterFake{}
	svc := NewContextMeterService(repo)
	a, b, out, window := int64(10000), int64(12000), int64(1000), int64(1000000)
	task := &model.DaemonTask{ID: "first", ConversationID: "conv", AgentID: "agent", CLITool: "codex"}
	u := &model.TokenUsage{Provider: "codex", Source: "actual", InputTokens: &a, OutputTokens: &out, ContextTokens: &a, ContextWindowTokens: &window, ObservedAt: time.Now(), Complete: true}
	if err := svc.RecordNativeUsage(context.Background(), task, u); err != nil {
		t.Fatal(err)
	}
	task.ID = "second"
	v := *u
	v.InputTokens = &b
	v.ContextTokens = &b
	for i := 0; i < 2; i++ {
		if err := svc.RecordNativeUsage(context.Background(), task, &v); err != nil {
			t.Fatal(err)
		}
	}
	usage, err := svc.GetUsage(context.Background(), "conv", "agent", "codex")
	if err != nil {
		t.Fatal(err)
	}
	if usage.ActiveContextTokens != 12000 || usage.TotalInputTokens != 22000 || usage.MeasuredTurns != 2 || usage.UsageRatio != 0.012 {
		t.Fatalf("wrong scopes: %+v", usage)
	}
	active, err := svc.GetActiveUsage(context.Background(), "conv", "agent")
	if err != nil || active.ActiveContextTokens != 12000 || active.Source != "actual" {
		t.Fatalf("checkpoint must use native context: %+v, %v", active, err)
	}
	v.ContextTokens = nil
	if err := svc.RecordNativeUsage(context.Background(), task, &v); err != nil {
		t.Fatal(err)
	}
	usage, err = svc.GetUsage(context.Background(), "conv", "agent", "codex")
	if err != nil {
		t.Fatal(err)
	}
	if usage.Status != "unknown" || usage.TotalInputTokens != 22000 {
		t.Fatalf("compaction changed historical consumption: %+v", usage)
	}
}
