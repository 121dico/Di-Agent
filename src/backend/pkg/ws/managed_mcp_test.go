package ws

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"
)

func setupMCPTest(t *testing.T) (*DaemonHub, *DaemonClient) {
	t.Helper()
	hub := NewDaemonHub(slog.Default())
	client := NewDaemonClient(nil, "machine")
	client.SetCapabilities([]string{"managed_mcp_v1", "managed_mcp_setup_v1"})
	hub.RegisterTestClient("machine", client)
	return hub, client
}

func readMCPRequest(t *testing.T, client *DaemonClient) json.RawMessage {
	t.Helper()
	select {
	case raw := <-client.sendCh:
		var env struct {
			Type string            `json:"type"`
			Data map[string]string `json:"data"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatal(err)
		}
		if env.Type != "managed_mcp.inspect" || env.Data["user_id"] != "owner" {
			t.Fatalf("unexpected dispatch: %s", raw)
		}
		result, _ := json.Marshal(map[string]string{"request_id": env.Data["request_id"], "status": "connected"})
		return result
	case <-time.After(time.Second):
		t.Fatal("no dispatch")
		return nil
	}
}

func TestManagedMCPResultBindsToExactLiveMachineConnection(t *testing.T) {
	hub, client := setupMCPTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "inspect"); finished <- err }()
	response := readMCPRequest(t, client)
	hub.ResolveManagedMCP(NewDaemonClient(nil, "other"), response)
	hub.ResolveManagedMCP(NewDaemonClient(nil, "machine"), response)
	select {
	case err := <-finished:
		t.Fatalf("wrong connection resolved: %v", err)
	default:
	}
	hub.ResolveManagedMCP(client, response)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	hub.ResolveManagedMCP(client, response)
	if _, busy := hub.managedMCPMachines.Load("machine"); busy {
		t.Fatal("request retained after completion")
	}
}

func TestManagedMCPTimeoutDisconnectCapabilityAndBusy(t *testing.T) {
	hub, client := setupMCPTest(t)
	client.SetCapabilities([]string{"managed_mcp_v1"})
	if _, err := hub.RequestManagedMCP(context.Background(), "machine", "owner", "inspect"); !errors.Is(err, ErrManagedMCPUpgrade) {
		t.Fatalf("expected upgrade: %v", err)
	}
	client.SetCapabilities([]string{"managed_mcp_v1", "managed_mcp_setup_v1"})
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() { _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "inspect"); finished <- err }()
	response := readMCPRequest(t, client)
	if _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "configure"); !errors.Is(err, ErrManagedMCPBusy) {
		t.Fatalf("expected busy: %v", err)
	}
	cancel()
	if err := <-finished; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	hub.ResolveManagedMCP(client, response)
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	go func() { _, err := hub.RequestManagedMCP(ctx2, "machine", "owner", "inspect"); finished <- err }()
	readMCPRequest(t, client)
	client.closeNow()
	if err := <-finished; !errors.Is(err, ErrManagedMCPOffline) {
		t.Fatalf("expected offline: %v", err)
	}
	if _, busy := hub.managedMCPMachines.Load("machine"); busy {
		t.Fatal("request retained after disconnect")
	}
}

func TestManagedMCPMalformedAndLateResponseCannotResolveAnotherRequest(t *testing.T) {
	hub, client := setupMCPTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "inspect"); finished <- err }()
	oldResponse := readMCPRequest(t, client)
	hub.ResolveManagedMCP(client, json.RawMessage(`{"request_id":`))
	if err := <-finished; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("malformed response resolved: %v", err)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	go func() { _, err := hub.RequestManagedMCP(ctx2, "machine", "owner", "inspect"); finished <- err }()
	newResponse := readMCPRequest(t, client)
	hub.ResolveManagedMCP(client, oldResponse)
	select {
	case err := <-finished:
		t.Fatalf("late response resolved new request: %v", err)
	default:
	}
	hub.ResolveManagedMCP(client, newResponse)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestManagedMCPInlineRequiresNewCapabilityAndBindsEncryptedRelay(t *testing.T) {
	hub, client := setupMCPTest(t)
	if _, err := hub.RequestManagedMCP(context.Background(), "machine", "owner", "setup_session"); !errors.Is(err, ErrManagedMCPUpgrade) {
		t.Fatalf("old accepted: %v", err)
	}
	client.SetCapabilities([]string{"managed_mcp_v1", "managed_mcp_setup_v1", "managed_mcp_inline_setup_v1"})
	envelope := json.RawMessage(`{"session_id":"opaque","client_public_key":"public","nonce":"nonce","ciphertext":"encrypted"}`)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "save", envelope); finished <- err }()
	var response json.RawMessage
	select {
	case raw := <-client.sendCh:
		var msg struct {
			Type string `json:"type"`
			Data struct {
				RequestID string          `json:"request_id"`
				UserID    string          `json:"user_id"`
				MachineID string          `json:"machine_id"`
				Envelope  json.RawMessage `json:"envelope"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &msg) != nil || msg.Type != "managed_mcp.save" || msg.Data.UserID != "owner" || msg.Data.MachineID != "machine" || string(msg.Data.Envelope) != string(envelope) {
			t.Fatalf("bad relay %s", raw)
		}
		response, _ = json.Marshal(map[string]any{"request_id": msg.Data.RequestID, "saved": true})
	case <-ctx.Done():
		t.Fatal("dispatch missing")
	}
	hub.ResolveManagedMCP(NewDaemonClient(nil, "machine"), response)
	select {
	case <-finished:
		t.Fatal("different connection resolved")
	default:
	}
	hub.ResolveManagedMCP(client, response)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "save"); err == nil {
		t.Fatal("save without envelope accepted")
	}
	if _, err := hub.RequestManagedMCP(ctx, "machine", "owner", "inspect", envelope); err == nil {
		t.Fatal("inspect with envelope accepted")
	}
}
