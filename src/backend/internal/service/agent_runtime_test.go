package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type fakeAgentRuntimeStore struct {
	overview *model.AgentRuntimeOverview
	err      error
	userID   string
	agentID  string
	since    time.Time
	limit    int
}

func (f *fakeAgentRuntimeStore) GetRuntimeOverview(
	_ context.Context,
	userID, agentID string,
	since time.Time,
	recentLimit int,
) (*model.AgentRuntimeOverview, error) {
	f.userID = userID
	f.agentID = agentID
	f.since = since
	f.limit = recentLimit
	return f.overview, f.err
}

func TestAgentRuntimeOverviewUsesRequestedPeriod(t *testing.T) {
	store := &fakeAgentRuntimeStore{overview: &model.AgentRuntimeOverview{
		ConversationCount: 2,
		ExecutionCount:    4,
		ToolCallCount:     7,
		TotalTokens:       1200,
	}}
	svc := NewAgentRuntimeService(store)
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	got, err := svc.GetOverview(context.Background(), "user-1", "agent-1", 7, now)
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if got.PeriodDays != 7 {
		t.Fatalf("period_days = %d, want 7", got.PeriodDays)
	}
	if store.userID != "user-1" || store.agentID != "agent-1" {
		t.Fatalf("scope = %q/%q", store.userID, store.agentID)
	}
	if want := now.AddDate(0, 0, -7); !store.since.Equal(want) {
		t.Fatalf("since = %v, want %v", store.since, want)
	}
	if store.limit != 5 {
		t.Fatalf("recent limit = %d, want 5", store.limit)
	}
}

func TestAgentRuntimeOverviewRejectsInvalidInput(t *testing.T) {
	svc := NewAgentRuntimeService(&fakeAgentRuntimeStore{})
	for _, tc := range []struct {
		name    string
		userID  string
		agentID string
		days    int
	}{
		{name: "missing user", agentID: "agent-1", days: 7},
		{name: "missing agent", userID: "user-1", days: 7},
		{name: "zero days", userID: "user-1", agentID: "agent-1"},
		{name: "too many days", userID: "user-1", agentID: "agent-1", days: 91},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.GetOverview(context.Background(), tc.userID, tc.agentID, tc.days, time.Now())
			if !errors.Is(err, ErrAgentInvalidInput) {
				t.Fatalf("error = %v, want ErrAgentInvalidInput", err)
			}
		})
	}
}

func TestAgentRuntimeOverviewReturnsEmptyRecentRuns(t *testing.T) {
	store := &fakeAgentRuntimeStore{overview: &model.AgentRuntimeOverview{}}
	svc := NewAgentRuntimeService(store)
	got, err := svc.GetOverview(context.Background(), "user-1", "agent-1", 7, time.Now())
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if got.RecentRuns == nil || len(got.RecentRuns) != 0 {
		t.Fatalf("recent_runs = %#v, want non-nil empty slice", got.RecentRuns)
	}
}

func TestNormalizeAgentRuntimeConfigDefaultsSafely(t *testing.T) {
	got, err := NormalizeAgentRuntimeConfig(model.AgentRuntimeConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if got.ReasoningEffort != "medium" || got.ApprovalMode != "auto" || got.Version != 1 {
		t.Fatalf("unexpected defaults: %#v", got)
	}
}

func TestNormalizeAgentRuntimeConfigAcceptsSupportedCodexValues(t *testing.T) {
	got, err := NormalizeAgentRuntimeConfig(model.AgentRuntimeConfig{
		Version: 1, Model: "gpt-5.6-sol", ReasoningEffort: "high", ApprovalMode: "request",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Model != "gpt-5.6-sol" || got.ReasoningEffort != "high" || got.ApprovalMode != "request" {
		t.Fatalf("unexpected normalized config: %#v", got)
	}
}

func TestNormalizeAgentRuntimeConfigRejectsRawFlags(t *testing.T) {
	_, err := NormalizeAgentRuntimeConfig(model.AgentRuntimeConfig{
		Model:           "--dangerously-bypass-approvals-and-sandbox",
		ReasoningEffort: "medium",
		ApprovalMode:    "auto",
	})
	if err == nil {
		t.Fatal("expected unsupported model to be rejected")
	}
}
