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

func TestAgentApprovalExpiresWithoutAUserDecision(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	hub.RegisterAgentApproval(AgentApprovalContext{
		ApprovalID: "approval-expiring", MachineID: "machine-1", TaskID: "task-1",
		ConversationID: "conversation-1", UserID: "user-1", ExpiresAt: time.Now().Add(10 * time.Millisecond),
	})
	time.Sleep(30 * time.Millisecond)
	if err := hub.ResolveAgentApproval("approval-expiring", "user-1", "conversation-1", "accept"); err == nil {
		t.Fatal("expected expired approval to be removed")
	}
}

func TestDaemonCapabilityHandshakeFailsClosedWhenCapabilityIsMissing(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	client := NewDaemonClient(nil, "machine-1")
	hub.RegisterTestClient("machine-1", client)
	if hub.SupportsCapability("machine-1", "agent_runtime_controls_v1") {
		t.Fatal("missing capability must not be inferred")
	}
	client.SetCapabilities([]string{"agent_runtime_controls_v1"})
	if !hub.SupportsCapability("machine-1", "agent_runtime_controls_v1") {
		t.Fatal("advertised capability should be available on the live connection")
	}
}

func TestPendingAgentApprovalsCanBeReplayedAfterBrowserReconnect(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	hub.RegisterAgentApproval(AgentApprovalContext{
		ApprovalID: "approval-replay", MachineID: "machine-1", TaskID: "task-1",
		ConversationID: "conversation-1", UserID: "user-1", AgentID: "agent-1",
		Kind: "command", Method: "item/commandExecution/requestApproval",
		DetailsJSON: `{"command":"pwd"}`, ExpiresAt: time.Now().Add(time.Minute),
	})

	got := hub.PendingAgentApprovals("user-1", "conversation-1")
	if len(got) != 1 || got[0].ApprovalID != "approval-replay" || got[0].AgentID != "agent-1" {
		t.Fatalf("unexpected replay payload: %#v", got)
	}
	if string(got[0].Details) != `{"command":"pwd"}` {
		t.Fatalf("details = %s", got[0].Details)
	}
	if other := hub.PendingAgentApprovals("other-user", "conversation-1"); len(other) != 0 {
		t.Fatalf("approval leaked to another user: %#v", other)
	}
}
