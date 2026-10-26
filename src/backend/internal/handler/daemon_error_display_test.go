package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	"nhooyr.io/websocket"
)

// 真实 task.progress 入站与用户 WS 出站：错误不能先在实时增量中泄露，再等终态脱敏。
func TestDaemonProgressErrorRedactedBeforeUserWebSocketAndReplay(t *testing.T) {
	handler, daemonHub, _ := newTestDaemonHandler(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userHub := ws.NewHub(slog.Default())
	go userHub.Run(ctx)
	buf := service.NewStreamingBuffer()
	handler.userHub = userHub
	handler.streamingBuffer = buf
	handler.convRepo = &fakeDaemonConversationRepo{memberIDs: []string{"user-1"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")
		clientCtx, stop := context.WithCancel(r.Context())
		defer stop()
		if r.URL.Path == "/user" {
			client := ws.NewClient(conn, "user-1")
			userHub.Register(client)
			defer userHub.Unregister(client)
			go client.WritePump(clientCtx)
			_, _, _ = conn.Read(clientCtx)
			return
		}
		client := ws.NewDaemonClient(conn, "machine-1")
		daemonHub.Register(client)
		go client.WritePump(clientCtx)
		handler.readLoop(clientCtx, client, &model.DaemonMachine{ID: "machine-1", UserID: "user-1"})
	}))
	defer server.Close()
	base := "ws" + strings.TrimPrefix(server.URL, "http")
	userConn, _, err := websocket.Dial(ctx, base+"/user", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer userConn.CloseNow()
	for !userHub.IsOnline("user-1") {
		select {
		case <-ctx.Done():
			t.Fatal("user WS did not register")
		case <-time.After(time.Millisecond):
		}
	}
	daemonConn, _, err := websocket.Dial(ctx, base+"/daemon", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer daemonConn.CloseNow()
	writeWSJSON(t, ctx, daemonConn, map[string]interface{}{"type": "task.progress", "data": map[string]interface{}{
		"task_id": "task-1", "message_id": "message-1", "conversation_id": "conv-1", "agent_id": "agent-1", "agent_name": "Codex",
		"events": []model.AgentEvent{{Type: model.AgentEventTextDelta, Content: "已经输出"}, {Type: model.AgentEventError, Message: "workspace routing discovery timed out\nAuthorization: Bearer ws-secret", Content: "password=ws-secret", Result: map[string]string{"token": "ws-secret"}}},
	}})
	for {
		_, wire, err := userConn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(wire, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Type != ws.TypeMessageStreaming {
			continue
		}
		if strings.Contains(string(wire), "ws-secret") {
			t.Fatalf("credential in live WS: %s", wire)
		}
		if !strings.Contains(string(wire), "workspace routing discovery timed out") || !strings.Contains(string(wire), "已经输出") || !strings.Contains(string(wire), "message-1") {
			t.Fatalf("lost reason/text/routing: %s", wire)
		}
		state, ok := buf.GetState("task-1")
		stored, _ := json.Marshal(state)
		if !ok || state.Status != model.MessageStatusError || strings.Contains(string(stored), "ws-secret") {
			t.Fatalf("unsafe replay: %s", stored)
		}
		return
	}
}
