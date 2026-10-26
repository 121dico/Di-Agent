package bossauth_test

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"github.com/121dico/Di-Agent/src/backend/internal/handler"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	"github.com/gin-gonic/gin"
	"nhooyr.io/websocket"
)

type sessionUsers struct{}

func (sessionUsers) CreateUser(context.Context, string, string) (*model.User, error) { return nil, nil }
func (sessionUsers) GetUserByUsername(context.Context, string) (*model.User, error)  { return nil, nil }
func (sessionUsers) GetUserByID(_ context.Context, id string) (*model.User, error) {
	return &model.User{ID: id, Username: "company-test"}, nil
}

func TestOriginalWebSocketHandlerAcceptsApplicationTokenWithoutGateway(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(logger)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	auth := service.NewAuthService(sessionUsers{}, service.AuthConfig{JWTSecret: signingSecret, JWTExpiryHours: 1})
	h := handler.NewWebSocketHandler(auth, hub, nil, nil, logger, nil)
	b, err := bossauth.New(config(), &identities{}, signingSecret)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(b.Guard())
	r.GET("/ws", h.Handle)
	srv := httptest.NewServer(r)
	defer srv.Close()
	dialCtx, done := context.WithTimeout(ctx, 3*time.Second)
	defer done()
	conn, resp, err := websocket.Dial(dialCtx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?token="+sign(t, nil), nil)
	if err != nil {
		t.Fatalf("original WS session rejected without gateway: %v", err)
	}
	if resp.StatusCode != 101 {
		t.Fatalf("upgrade status %d", resp.StatusCode)
	}
	conn.Close(websocket.StatusNormalClosure, "done")
}
