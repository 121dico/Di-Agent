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
	if pending := hub.PendingAgentApprovals("user-1", "conversation-1"); len(pending) != 1 {
		t.Fatalf("approval must remain pending until daemon acknowledgement: %#v", pending)
	}
	acknowledged, err := hub.AcknowledgeAgentApproval("approval-1", "machine-1", "task-1")
	if err != nil || acknowledged.UserID != "user-1" {
		t.Fatalf("unexpected acknowledgement: %#v, %v", acknowledged, err)
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

func TestCapabilityCheckAndSendUseTheSameLiveDaemonClient(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	oldClient := NewDaemonClient(nil, "machine-1")
	oldClient.SetCapabilities([]string{"agent_runtime_controls_v1"})
	hub.RegisterTestClient("machine-1", oldClient)
	newClient := NewDaemonClient(nil, "machine-1")
	hub.RegisterTestClient("machine-1", newClient)

	err := hub.SendToMachineRequiringCapability("machine-1", "agent_runtime_controls_v1", WSMessage{Type: "task.dispatch"})
	if err == nil {
		t.Fatal("replacement daemon without capability must reject dispatch")
	}
	select {
	case <-newClient.sendCh:
		t.Fatal("task must not be queued on a daemon that omitted the capability")
	default:
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

func TestAgentApprovalSnapshotsCarryMonotonicCompleteState(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	first, initialRevision := hub.PendingAgentApprovalsWithRevision("user-1", "conversation-1")
	if len(first) != 0 || initialRevision != 0 {
		t.Fatalf("unexpected initial snapshot: %#v revision=%d", first, initialRevision)
	}

	hub.RegisterAgentApproval(AgentApprovalContext{
		ApprovalID: "approval-revision", MachineID: "machine-1", TaskID: "task-1",
		ConversationID: "conversation-1", UserID: "user-1", ExpiresAt: time.Now().Add(time.Minute),
	})
	pending, requiredRevision := hub.PendingAgentApprovalsWithRevision("user-1", "conversation-1")
	if len(pending) != 1 || requiredRevision <= initialRevision {
		t.Fatalf("required snapshot is not newer and complete: %#v revision=%d", pending, requiredRevision)
	}

	if _, err := hub.AcknowledgeAgentApproval("approval-revision", "machine-1", "task-1"); err != nil {
		t.Fatal(err)
	}
	resolved, resolvedRevision := hub.PendingAgentApprovalsWithRevision("user-1", "conversation-1")
	if len(resolved) != 0 || resolvedRevision <= requiredRevision {
		t.Fatalf("resolved snapshot is not newer and complete: %#v revision=%d", resolved, resolvedRevision)
	}
}
