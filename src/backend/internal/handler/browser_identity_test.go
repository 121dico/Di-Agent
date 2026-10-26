package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type identityHTTPStore struct{ repository.AgentStore }

func (*identityHTTPStore) ListDaemonMachines(context.Context, string) ([]model.DaemonMachine, error) {
	return nil, nil
}

func TestBrowserIdentityHTTPStrictSchemaAndLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	valid := fmt.Sprintf(`{"nonce":"%s","issued_at":%d,"proof":"%s"}`, strings.Repeat("a", 64), time.Now().Unix(), strings.Repeat("b", 64))
	for _, tc := range []struct {
		name, user, body string
		status           int
	}{
		{"unauthenticated", "", valid, 401},
		{"no matching machine", "owner", valid, 404},
		{"empty", "owner", "{}", 400},
		{"null", "owner", "null", 400},
		{"trailing value", "owner", valid + " {}", 400},
		{"unknown field", "owner", strings.TrimSuffix(valid, "}") + `,"api_key":"secret"}`, 400},
		{"oversized", "owner", strings.Repeat(" ", 513) + valid, 400},
		{"invalid nonce", "owner", strings.Replace(valid, strings.Repeat("a", 64), "short", 1), 400},
		{"fraction timestamp", "owner", strings.Replace(valid, fmt.Sprint(time.Now().Unix()), "0.5", 1), 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewAgentHandler(service.NewAgentService(&identityHTTPStore{}, nil), nil)
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("user_id", tc.user); c.Next() })
			router.POST("/identity", h.VerifyBrowserIdentity)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/identity", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("%d %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" || strings.Contains(response.Body.String(), "secret") {
				t.Fatal("unsafe response")
			}
		})
	}
}
