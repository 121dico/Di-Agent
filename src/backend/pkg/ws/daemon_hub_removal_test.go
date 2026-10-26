package ws

import (
	"context"
	"log/slog"
	"testing"
	"time"
)

func TestRemovedMachineRejectsDispatchAndQueuedReconnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hub := NewDaemonHub(slog.Default())
	go hub.Run(ctx)
	client := NewDaemonClient(nil, "removed")
	hub.Register(client)
	waitForDaemonConnection(t, hub, "removed", true)
	result := hub.RegisterTaskPromise("inflight")
	if err := hub.SendToMachine("removed", WSMessage{Type: "task.dispatch", Data: map[string]interface{}{"task_id": "inflight", "agent_id": "a"}}); err != nil {
		t.Fatal(err)
	}
	hub.RevokeMachine("removed")
	if hub.IsConnected("removed") {
		t.Fatal("removed computer remains connected")
	}
	if err := hub.SendToMachine("removed", WSMessage{Type: "task.dispatch"}); err == nil {
		t.Fatal("removed computer accepts work")
	}
	select {
	case got := <-result:
		if got.Error == "" {
			t.Fatal("pending task not failed")
		}
	case <-time.After(time.Second):
		t.Fatal("pending task left waiting")
	}
	old := NewDaemonClient(nil, "removed")
	hub.Register(old)
	// 已认证但排队中的旧连接必须收到关闭，不可重新加入 Hub。
	select {
	case <-old.done:
	case <-time.After(time.Second):
		t.Fatal("stale connection not closed")
	}
	if hub.IsConnected("removed") {
		t.Fatal("stale connection resurrected removed computer")
	}
}
