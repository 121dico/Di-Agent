package handler

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	"github.com/gin-gonic/gin"
	"nhooyr.io/websocket"
)

// 数据库边界替身；通过真实 HTTP / WebSocket 验证撤销链路。
type removableMachineRepo struct {
	fakeDaemonAgentRepo
	removed atomic.Bool
}

func (r *removableMachineRepo) GetDaemonMachineByAPIKeyHash(ctx context.Context, _ string) (*model.DaemonMachine, error) {
	return r.GetDaemonMachineByID(ctx, "machine")
}
func (r *removableMachineRepo) GetDaemonMachineByID(_ context.Context, id string) (*model.DaemonMachine, error) {
	if r.removed.Load() || id != "machine" {
		return nil, nil
	}
	return &model.DaemonMachine{ID: "machine", UserID: "owner", APIKeyHash: "test-hash"}, nil
}
func (r *removableMachineRepo) DeleteDaemonMachine(_ context.Context, id, user string) (bool, error) {
	if id != "machine" || user != "owner" {
		return false, nil
	}
	return !r.removed.Swap(true), nil
}

func TestRemoveMachineHTTPClosesSocketAndRejectsOldKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := &removableMachineRepo{}
	svc := service.NewAgentService(r, nil)
	hub := ws.NewDaemonHub(slog.Default())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go hub.Run(ctx)
	svc.SetDaemonHub(hub)
	daemon := NewDaemonHandler(svc, nil, "", slog.Default(), []string{"*"}, hub, nil, nil, nil)
	agents := NewAgentHandler(svc, nil)
	router := gin.New()
	router.GET("/daemon/ws", daemon.Handle)
	router.DELETE("/machines/:id", func(c *gin.Context) { c.Set("user_id", "owner"); agents.DeleteDaemonMachine(c) })
	server := httptest.NewServer(router)
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/daemon/ws?token=sk_machine_test"
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if err = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err = conn.Read(ctx); err != nil {
		t.Fatalf("initial ping: %v", err)
	}
	closed := make(chan error, 1)
	go func() { _, _, err := conn.Read(ctx); closed <- err }()
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, server.URL+"/machines/machine", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete HTTP=%d", resp.StatusCode)
	}
	select {
	case err := <-closed:
		if err == nil {
			t.Fatal("old websocket remains usable")
		}
	case <-ctx.Done():
		t.Fatal("old socket was not closed")
	}
	if newConn, resp, err := websocket.Dial(ctx, url, nil); err == nil {
		newConn.CloseNow()
		t.Fatal("old key reconnected")
	} else if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old key rejection: %v %v", resp, err)
	}
}
