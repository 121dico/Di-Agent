package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"
)

func TestTaskSteerRequiresExactOwnerAndAcknowledgement(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	client := NewDaemonClient(nil, "machine")
	client.SetCapabilities([]string{"task_steer_v1"})
	hub.RegisterTestClient("machine", client)
	hub.RegisterTaskPromise("task")
	if err := hub.SendToMachine("machine", WSMessage{Type: "task.dispatch", Data: map[string]interface{}{"task_id": "task", "agent_id": "agent", "conversation_id": "conv", "user_id": "owner"}}); err != nil {
		t.Fatal(err)
	}
	<-client.sendCh
	if _, ok := hub.ActiveTask("conv", "other", "agent"); ok {
		t.Fatal("another user must not find owner's task")
	}
	task, ok := hub.ActiveTask("conv", "owner", "agent")
	if !ok || task.TaskID != "task" {
		t.Fatal("active task missing")
	}
	done := make(chan TaskSteerResult, 1)
	go func() { done <- hub.SteerTask(context.Background(), task, "change direction") }()
	var envelope struct {
		Data struct {
			RequestID string `json:"request_id"`
		} `json:"data"`
	}
	select {
	case data := <-client.sendCh:
		if err := json.Unmarshal(data, &envelope); err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("steer not sent")
	}
	ack, _ := json.Marshal(map[string]string{"request_id": envelope.Data.RequestID, "task_id": "task", "status": "accepted"})
	hub.ResolveTaskSteer(NewDaemonClient(nil, "machine"), ack)
	select {
	case <-done:
		t.Fatal("replacement connection must not acknowledge request")
	case <-time.After(10 * time.Millisecond):
	}
	hub.ResolveTaskSteer(client, ack)
	select {
	case result := <-done:
		if result.Status != "accepted" {
			t.Fatalf("result %#v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("ack not delivered")
	}
	hub.RemoveTaskPromise("task")
	if _, ok := hub.ActiveTask("conv", "owner", "agent"); ok {
		t.Fatal("completed task still active")
	}
}

func TestTaskSteerTimeoutIsUnknownAndUnsupportedIsUnavailable(t *testing.T) {
	hub := NewDaemonHub(slog.Default())
	client := NewDaemonClient(nil, "machine")
	hub.RegisterTestClient("machine", client)
	hub.RegisterTaskPromise("task")
	if err := hub.SendToMachine("machine", WSMessage{Type: "task.dispatch", Data: map[string]interface{}{"task_id": "task", "agent_id": "agent", "conversation_id": "conv", "user_id": "owner"}}); err != nil {
		t.Fatal(err)
	}
	<-client.sendCh
	task, _ := hub.ActiveTask("conv", "owner", "agent")
	if got := hub.SteerTask(context.Background(), task, "hello"); got.Status != "unavailable" {
		t.Fatal(got)
	}
	client.SetCapabilities([]string{"task_steer_v1"})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if got := hub.SteerTask(ctx, task, "hello"); got.Status != "unknown" {
		t.Fatal(got)
	}
	select {
	case <-client.sendCh:
	case <-time.After(time.Second):
		t.Fatal("unknown must refer to an actually enqueued request")
	}
}
