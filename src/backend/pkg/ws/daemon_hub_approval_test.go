package ws

import (
	"log/slog"
	"testing"
	"time"
)

func TestAgentApprovalIsBoundToOwnerAndConsumedOnce(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	client := NewDaemonClient(nil, "machine-1")
	hub.RegisterTestClient("machine-1", client)
	hub.RegisterAgentApproval(AgentApprovalContext{
		ApprovalID: "approval-1", MachineID: "machine-1", TaskID: "task-1",
		ConversationID: "conversation-1", UserID: "user-1", ExpiresAt: time.Now().Add(time.Minute),
	})

	if err := hub.ResolveAgentApproval("approval-1", "other-user", "conversation-1", "accept"); err == nil {
		t.Fatal("expected owner mismatch")
	}
	if err := hub.ResolveAgentApproval("approval-1", "user-1", "conversation-1", "accept"); err != nil {
		t.Fatal(err)
	}
	select {
	case raw := <-client.sendCh:
		if len(raw) == 0 {
			t.Fatal("expected approval decision payload")
		}
	default:
		t.Fatal("expected decision to be queued for the daemon")
	}
	if err := hub.ResolveAgentApproval("approval-1", "user-1", "conversation-1", "accept"); err == nil {
		t.Fatal("expected consumed approval to be unavailable")
	}
}
