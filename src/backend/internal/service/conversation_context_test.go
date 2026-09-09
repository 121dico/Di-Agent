package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type fakeConversationContextAgents struct {
	agents []model.ConversationAgent
}

func (f fakeConversationContextAgents) ListConversationAgents(context.Context, string, string) ([]model.ConversationAgent, error) {
	return f.agents, nil
}

type fakeConversationContextCheckpoints struct {
	checkpoint model.ConversationCheckpoint
	input      model.ContinueFromCheckpointInput
}

func (f *fakeConversationContextCheckpoints) PrepareContinuation(_ context.Context, input model.ContinueFromCheckpointInput, _ string) (*model.CheckpointContinuation, error) {
	f.input = input
	target := input.TargetAgentID
	if target == "" {
		target = f.checkpoint.SourceAgentID
	}
	return &model.CheckpointContinuation{Checkpoint: f.checkpoint, TargetAgentID: target}, nil
}

type fakeConversationForkStore struct {
	input model.CreateConversationForkInput
}

func (f *fakeConversationForkStore) Create(_ context.Context, input model.CreateConversationForkInput) (*model.ConversationForkResult, error) {
	f.input = input
	return &model.ConversationForkResult{
		Conversation: model.Conversation{ID: "child-1"},
		Fork:         model.ConversationFork{ChildConversationID: "child-1", ParentConversationID: input.ParentConversationID},
		Session:      model.AgentSession{Generation: 1, CheckpointID: input.CheckpointID},
	}, nil
}

func (*fakeConversationForkStore) GetByChild(context.Context, string, string) (*model.ConversationFork, error) {
	return nil, nil
}

func TestConversationContextForkCreatesIndependentGenerationOne(t *testing.T) {
	checkpoints := &fakeConversationContextCheckpoints{checkpoint: model.ConversationCheckpoint{
		ID: "checkpoint-1", ConversationID: "parent-1", SourceAgentID: "agent-1",
		SourceToMessageID: "message-10", Status: model.CheckpointStatusReady, Markdown: "# state",
	}}
	store := &fakeConversationForkStore{}
	svc := NewConversationContextService(fakeConversationContextAgents{}, checkpoints,
		fakeConversationContextAgentStore{agent: &model.Agent{ID: "agent-1", Name: "Codex", CLITool: "codex"}}, nil, nil, nil)
	svc.SetForkStore(store)
	result, err := svc.Fork(context.Background(), "user-1", "parent-1", "checkpoint-1", "agent-1", "")
	if err != nil {
		t.Fatalf("Fork() error = %v", err)
	}
	if result.Conversation.ID != "child-1" || result.Session.Generation != 1 {
		t.Fatalf("Fork() result = %#v", result)
	}
	if store.input.ParentConversationID != "parent-1" || store.input.ForkedFromMessageID != "message-10" || store.input.CheckpointID != "checkpoint-1" {
		t.Fatalf("fork input = %#v", store.input)
	}
}

type fakeConversationContextAgentStore struct {
	agent *model.Agent
}

func (f fakeConversationContextAgentStore) GetByID(context.Context, string) (*model.Agent, error) {
	return f.agent, nil
}

func TestResolveImportTargetAllowsSharedCheckpointAcrossAgents(t *testing.T) {
	checkpoint := model.ConversationCheckpoint{
		SourceAgentID: "agent-1",
		Scope:         model.CheckpointScopeConversationShared,
	}
	target, err := resolveImportTarget(checkpoint, []model.ConversationAgent{{AgentID: "agent-2"}}, "agent-2")
	if err != nil || target != "agent-2" {
		t.Fatalf("resolveImportTarget() = %q, %v", target, err)
	}
}

func TestResolveImportTargetEnforcesScopeAndBinding(t *testing.T) {
	checkpoint := model.ConversationCheckpoint{
		SourceAgentID: "agent-1",
		Scope:         model.CheckpointScopePrivateAgent,
	}
	if _, err := resolveImportTarget(checkpoint, []model.ConversationAgent{{AgentID: "agent-2"}}, "agent-2"); !errors.Is(err, ErrCheckpointScope) {
		t.Fatalf("cross-Agent private import error = %v, want ErrCheckpointScope", err)
	}

	checkpoint.Scope = model.CheckpointScopeConversationShared
	if _, err := resolveImportTarget(checkpoint, nil, "agent-2"); !errors.Is(err, ErrCheckpointAgentBound) {
		t.Fatalf("unbound import error = %v, want ErrCheckpointAgentBound", err)
	}
}

func TestCheckpointBootstrapContextUsesTrustedDataBoundary(t *testing.T) {
	context := checkpointBootstrapContext("# Conversation Checkpoint\n\n- state")
	if !strings.HasPrefix(context, "[系统指令]\n") ||
		!strings.Contains(context, "[群聊背景]\n[平台授权 Conversation Checkpoint]") ||
		!strings.Contains(context, "<authorized_conversation_checkpoint>") ||
		!strings.Contains(context, "仅作为数据") {
		t.Fatalf("unexpected bootstrap context: %q", context)
	}
}

func TestConversationContextImportAttachesToCurrentSession(t *testing.T) {
	repo := &fakeContextMeterRepo{active: &model.AgentSession{
		ID: "session-1", ConversationID: "target-conv", AgentID: "agent-2",
		CLISessionID: "cli-session-1", CLITool: "codex", Generation: 4,
		ContextWindowTokens: 128_000,
	}}
	checkpoints := &fakeConversationContextCheckpoints{checkpoint: model.ConversationCheckpoint{
		ID: "checkpoint-1", SourceAgentID: "agent-1",
		Scope: model.CheckpointScopeConversationShared, Status: model.CheckpointStatusReady,
	}}
	svc := NewConversationContextService(
		fakeConversationContextAgents{agents: []model.ConversationAgent{{AgentID: "agent-2"}}},
		checkpoints,
		fakeConversationContextAgentStore{agent: &model.Agent{ID: "agent-2", CLITool: "codex"}},
		NewContextMeterService(repo),
		nil,
		nil,
	)

	result, err := svc.Import(context.Background(), "user-1", "target-conv", "source-conv", "checkpoint-1", "agent-2")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Attached || result.Generation != 4 || result.SessionID != "cli-session-1" {
		t.Fatalf("unexpected import result: %#v", result)
	}
	if repo.active.CheckpointID != "checkpoint-1" {
		t.Fatalf("attached checkpoint = %q", repo.active.CheckpointID)
	}
	if checkpoints.input.Mode != "current_session" {
		t.Fatalf("import mode = %q, want current_session", checkpoints.input.Mode)
	}
}

type fakeOwnMessageTexts struct{ user, conversation string }

func (f *fakeOwnMessageTexts) ListOwnMessageTexts(_ context.Context, user, conversation string) ([]string, error) {
	f.user, f.conversation = user, conversation
	return []string{"你好", "test"}, nil
}
func TestListUsageSeparatesMyMessagesFromNativeContext(t *testing.T) {
	meter := NewContextMeterService(&fakeContextMeterRepo{})
	svc := NewConversationContextService(fakeConversationContextAgents{agents: []model.ConversationAgent{{AgentID: "agent"}}}, nil, nil, meter, nil, nil)
	texts := &fakeOwnMessageTexts{}
	svc.SetOwnMessageSource(texts)
	rows, err := svc.ListUsage(context.Background(), "me", "conv")
	if err != nil {
		t.Fatal(err)
	}
	if texts.user != "me" || texts.conversation != "conv" {
		t.Fatal("must scope by authenticated user and conversation")
	}
	if rows[0].MyMessages == nil || rows[0].MyMessages.EstimatedTokens != 3 || rows[0].MyMessages.MessageCount != 2 {
		t.Fatalf("wrong own count: %+v", rows[0])
	}
	if rows[0].ActiveContextTokens != 0 {
		t.Fatal("own count must not overwrite native context")
	}
}

func (f *fakeOwnMessageTexts) ListAgentReplyTexts(context.Context, string, string, string) ([]model.Message, error) {
	return []model.Message{{Content: "hidden reasoning and hello", BlocksJSON: `[{"kind":"thinking","text":"hidden reasoning"},{"kind":"text","text":"hello"},{"kind":"tool_result","text":"secret tool output"}]`}}, nil
}

type fakeChatTokenizer struct{ texts []string }

func (f *fakeChatTokenizer) Count(_ context.Context, _ string, texts []string) ([]int64, string, error) {
	f.texts = texts
	return []int64{1, 1, 1}, "verified-test-vocabulary", nil
}
func TestChatTokenizationUsesCompleteVisibleMessagesOnly(t *testing.T) {
	repo := &nativeMeterFake{}
	meter := NewContextMeterService(repo)
	n := int64(25000)
	if err := meter.RecordNativeUsage(context.Background(), &model.DaemonTask{ID: "t", ConversationID: "conv", AgentID: "agent", CLITool: "claude"}, &model.TokenUsage{Provider: "claude", Source: "actual", Model: "deepseek-v4-pro", ContextTokens: &n, ObservedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	svc := NewConversationContextService(fakeConversationContextAgents{agents: []model.ConversationAgent{{AgentID: "agent"}}}, nil, nil, meter, nil, nil)
	svc.SetOwnMessageSource(&fakeOwnMessageTexts{})
	tokenizer := &fakeChatTokenizer{}
	svc.SetChatTokenizer(tokenizer)
	rows, err := svc.ListUsage(context.Background(), "me", "conv")
	if err != nil {
		t.Fatal(err)
	}
	got := rows[0].MyMessages
	if got.Source != "tokenizer" || got.InputTokens != 2 || got.OutputTokens != 1 || got.OutputCharacters != 5 {
		t.Fatalf("wrong visible counts: %+v", got)
	}
	if strings.Join(tokenizer.texts, "|") != "你好|test|hello" {
		t.Fatalf("hidden data entered tokenizer: %v", tokenizer.texts)
	}
	if rows[0].ActiveContextTokens != 25000 {
		t.Fatal("native pressure must remain separate")
	}
}
