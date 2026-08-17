package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/agent-hub/backend/internal/model"
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
