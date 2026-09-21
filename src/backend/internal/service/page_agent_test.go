package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type pageAgentRepoFake struct {
	ConvRepo
	workspace   string
	title       string
	selectAgent bool
	result      *model.Conversation
	err         error
}

func (r *pageAgentRepoFake) ResolvePageAgentChat(_ context.Context, userID, agentID, workspace, title string, selected bool) (*model.Conversation, error) {
	if userID != "owner" || agentID != "chosen" {
		panic("wrong identity")
	}
	r.workspace = workspace
	r.title = title
	r.selectAgent = selected
	return r.result, r.err
}
func TestPageAgentRetainsConversationWhenSwitching(t *testing.T) {
	repo := &pageAgentRepoFake{result: &model.Conversation{ID: "existing-history", PeerID: "chosen"}}
	svc := NewConversationService(repo, nil)
	conv, err := svc.GetOrCreatePageAgentChat(context.Background(), "owner", "chosen", "delivery", true)
	if err != nil || conv.ID != "existing-history" || repo.workspace != "delivery" || repo.title != "投放agent" || !repo.selectAgent {
		t.Fatalf("unexpected selection: %+v %v", conv, err)
	}
	_, err = svc.GetOrCreatePageAgentChat(context.Background(), "owner", "chosen", "report", false)
	if err != nil || repo.title != "报表agent" || repo.selectAgent {
		t.Fatalf("opening must restore saved agent: %v", err)
	}
}
func TestPageAgentRejectsInvalidWorkspaceAndInaccessibleAgent(t *testing.T) {
	repo := &pageAgentRepoFake{}
	svc := NewConversationService(repo, nil)
	if _, err := svc.GetOrCreatePageAgentChat(context.Background(), "owner", "chosen", "arbitrary", true); !errors.Is(err, ErrConvInvalidTitle) {
		t.Fatalf("invalid workspace: %v", err)
	}
	if _, err := svc.GetOrCreatePageAgentChat(context.Background(), "owner", "chosen", "delivery", true); !errors.Is(err, ErrConvNotFound) {
		t.Fatalf("inaccessible agent: %v", err)
	}
}

func TestPageBlackboardKeepsCompleteSnapshotBeforeLargePins(t *testing.T) {
	for _, scene := range []string{"delivery", "report"} {
		manual := "用户备注\n<di-" + scene + "-page-context>" + strings.Repeat("真实数据", 1800) + "口径与缺口完整</di-" + scene + "-page-context>"
		repo := &fakeMsgRepo{blackboard: &model.ConversationBlackboard{ManualContext: manual}}
		for i := 0; i < 20; i++ {
			repo.pinnedMessages = append(repo.pinnedMessages, model.PinnedMessage{Content: strings.Repeat("置顶消息", 400)})
		}
		result := BuildBlackboardText(context.Background(), repo, "page-history")
		if !strings.Contains(result, manual) {
			t.Fatal("daemon context must contain the entire accepted page snapshot")
		}
		if len([]rune(result)) > 11000 {
			t.Fatal("page context must remain bounded")
		}
	}
}
