package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/repository"
)

type fakeCheckpointStore struct {
	mu       sync.Mutex
	messages []model.Message
	current  *model.ConversationCheckpoint
	updated  chan model.ConversationCheckpoint
}

func (f *fakeCheckpointStore) ListSourceMessages(context.Context, string, string) ([]model.Message, error) {
	return append([]model.Message(nil), f.messages...), nil
}

func (f *fakeCheckpointStore) Create(_ context.Context, checkpoint *model.ConversationCheckpoint) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	checkpoint.ID = "checkpoint-1"
	checkpoint.Version = 1
	checkpoint.CreatedAt = time.Now()
	checkpoint.UpdatedAt = checkpoint.CreatedAt
	copy := *checkpoint
	f.current = &copy
	return nil
}

func (f *fakeCheckpointStore) UpdateSummary(_ context.Context, id string, summary model.CheckpointSummary, markdown, status, errorMessage string, tokensAfter int64) (*model.ConversationCheckpoint, error) {
	f.mu.Lock()
	if f.current == nil || f.current.ID != id {
		f.mu.Unlock()
		return nil, repository.ErrConversationCheckpointNotFound
	}
	f.current.Summary = summary
	f.current.Markdown = markdown
	f.current.Status = status
	f.current.ErrorMessage = errorMessage
	f.current.TokensAfter = tokensAfter
	copy := *f.current
	f.mu.Unlock()
	if f.updated != nil {
		f.updated <- copy
	}
	return &copy, nil
}

func (f *fakeCheckpointStore) GetByID(_ context.Context, id string) (*model.ConversationCheckpoint, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.current == nil || f.current.ID != id {
		return nil, repository.ErrConversationCheckpointNotFound
	}
	copy := *f.current
	return &copy, nil
}

func (f *fakeCheckpointStore) ListByConversation(context.Context, string, string, int) ([]model.ConversationCheckpoint, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.current == nil {
		return nil, nil
	}
	return []model.ConversationCheckpoint{*f.current}, nil
}

func (f *fakeCheckpointStore) Delete(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.current == nil || f.current.ID != id {
		return repository.ErrConversationCheckpointNotFound
	}
	f.current = nil
	return nil
}

type fakeCheckpointConvStore struct {
	conv   *model.Conversation
	member *model.ConversationMember
}

func (f fakeCheckpointConvStore) GetByID(context.Context, string) (*model.Conversation, error) {
	return f.conv, nil
}

func (f fakeCheckpointConvStore) GetMember(context.Context, string, string) (*model.ConversationMember, error) {
	return f.member, nil
}

type fakeCheckpointAgentStore struct{ bound bool }

func (f fakeCheckpointAgentStore) IsAgentInConversation(context.Context, string, string, string) (bool, error) {
	return f.bound, nil
}

type checkpointGeneratorFunc func(context.Context, CheckpointSummaryRequest) (model.CheckpointSummary, error)

func (f checkpointGeneratorFunc) GenerateCheckpointSummary(ctx context.Context, request CheckpointSummaryRequest) (model.CheckpointSummary, error) {
	return f(ctx, request)
}

type fakeCheckpointSessionSource struct {
	session *model.AgentSession
}

func (f fakeCheckpointSessionSource) GetActiveUsage(context.Context, string, string) (*model.AgentSession, error) {
	return f.session, nil
}

func newCheckpointTestService(store *fakeCheckpointStore, generator CheckpointSummaryGenerator) *ConversationCheckpointService {
	return NewConversationCheckpointService(store,
		fakeCheckpointConvStore{
			conv:   &model.Conversation{ID: "conv-1", UserID: "user-1"},
			member: &model.ConversationMember{ConversationID: "conv-1", UserID: "user-1"},
		},
		fakeCheckpointAgentStore{bound: true}, generator,
	)
}

func checkpointMessages() []model.Message {
	return []model.Message{
		{ID: "message-1", ConversationID: "conv-1", Role: "user", Content: "完成会话迁移能力"},
		{ID: "message-2", ConversationID: "conv-1", Role: "assistant", Content: "已经完成数据模型设计"},
	}
}

func TestConversationCheckpointCreateReturnsBeforeAgentSummary(t *testing.T) {
	store := &fakeCheckpointStore{messages: checkpointMessages(), updated: make(chan model.ConversationCheckpoint, 1)}
	release := make(chan struct{})
	generator := checkpointGeneratorFunc(func(context.Context, CheckpointSummaryRequest) (model.CheckpointSummary, error) {
		<-release
		return model.CheckpointSummary{Objective: "精炼后的目标", CurrentState: "可以续接"}, nil
	})
	svc := newCheckpointTestService(store, generator)

	result, err := svc.Create(context.Background(), model.CreateCheckpointInput{
		ConversationID: "conv-1", SourceAgentID: "agent-1", CreatedBy: "user-1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if result.Status != model.CheckpointStatusGenerating {
		t.Fatalf("status = %q, want generating", result.Status)
	}
	if result.SourceFromMessageID != "message-1" || result.SourceToMessageID != "message-2" {
		t.Fatalf("unexpected source range: %s..%s", result.SourceFromMessageID, result.SourceToMessageID)
	}
	close(release)
	select {
	case updated := <-store.updated:
		if updated.Status != model.CheckpointStatusReady || updated.Summary.Objective != "精炼后的目标" {
			t.Fatalf("unexpected refined checkpoint: %#v", updated)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async refinement")
	}
}

func TestConversationCheckpointAgentFailureKeepsFallback(t *testing.T) {
	store := &fakeCheckpointStore{messages: checkpointMessages(), updated: make(chan model.ConversationCheckpoint, 1)}
	svc := newCheckpointTestService(store, checkpointGeneratorFunc(func(context.Context, CheckpointSummaryRequest) (model.CheckpointSummary, error) {
		return model.CheckpointSummary{}, errors.New("agent offline")
	}))
	_, err := svc.Create(context.Background(), model.CreateCheckpointInput{
		ConversationID: "conv-1", SourceAgentID: "agent-1", CreatedBy: "user-1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	select {
	case updated := <-store.updated:
		if updated.Status != model.CheckpointStatusFailedFallback {
			t.Fatalf("status = %q, want failed_fallback", updated.Status)
		}
		if updated.Summary.Objective != "完成会话迁移能力" || updated.Markdown == "" {
			t.Fatalf("fallback was not preserved: %#v", updated)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for fallback persistence")
	}
}

func TestConversationCheckpointCreateRequiresBoundAgent(t *testing.T) {
	store := &fakeCheckpointStore{messages: checkpointMessages()}
	svc := NewConversationCheckpointService(store,
		fakeCheckpointConvStore{conv: &model.Conversation{ID: "conv-1", UserID: "user-1"}},
		fakeCheckpointAgentStore{bound: false}, nil,
	)
	_, err := svc.Create(context.Background(), model.CreateCheckpointInput{
		ConversationID: "conv-1", SourceAgentID: "agent-2", CreatedBy: "user-1",
	})
	if !errors.Is(err, ErrCheckpointAgentBound) {
		t.Fatalf("Create() error = %v, want ErrCheckpointAgentBound", err)
	}
}

func TestConversationCheckpointCapturesActiveSessionMetadata(t *testing.T) {
	store := &fakeCheckpointStore{messages: checkpointMessages()}
	svc := newCheckpointTestService(store, nil)
	svc.SetSessionSource(fakeCheckpointSessionSource{session: &model.AgentSession{
		CLISessionID: "cli-session-2", Generation: 2, ActiveContextTokens: 4321,
	}})

	checkpoint, err := svc.Create(context.Background(), model.CreateCheckpointInput{
		ConversationID: "conv-1", SourceAgentID: "agent-1", CreatedBy: "user-1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if checkpoint.SourceSessionID == nil || *checkpoint.SourceSessionID != "cli-session-2" {
		t.Fatalf("source session = %#v, want cli-session-2", checkpoint.SourceSessionID)
	}
	if checkpoint.Generation != 2 || checkpoint.TokensBefore != 4321 {
		t.Fatalf("generation/tokens = %d/%d, want 2/4321", checkpoint.Generation, checkpoint.TokensBefore)
	}
}

func TestConversationCheckpointPrivateScopeBlocksCrossAgentContinuation(t *testing.T) {
	store := &fakeCheckpointStore{current: &model.ConversationCheckpoint{
		ID: "checkpoint-1", ConversationID: "conv-1", SourceAgentID: "agent-1",
		CreatedBy: "user-1", Scope: model.CheckpointScopePrivateAgent,
	}}
	svc := newCheckpointTestService(store, nil)
	_, err := svc.PrepareContinuation(context.Background(), model.ContinueFromCheckpointInput{
		ConversationID: "conv-1", CheckpointID: "checkpoint-1", TargetAgentID: "agent-2",
	}, "user-1")
	if !errors.Is(err, ErrCheckpointScope) {
		t.Fatalf("PrepareContinuation() error = %v, want ErrCheckpointScope", err)
	}
}
