package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/port"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type setupHTTPStore struct{ repository.AgentStore }

func (*setupHTTPStore) GetDaemonMachineByID(context.Context, string) (*model.DaemonMachine, error) {
	return &model.DaemonMachine{UserID: "owner"}, nil
}

func TestManagedMCPInlineHTTPRejectsPlaintextAndRequiresBoundedEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	envelope := service.ManagedMCPEnvelope{SessionID: strings.Repeat("a", 43), ClientPublicKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), Nonce: base64.StdEncoding.EncodeToString(make([]byte, 24)), Ciphertext: base64.StdEncoding.EncodeToString(make([]byte, 32))}
	valid, _ := json.Marshal(envelope)
	for _, tc := range []struct {
		route, body   string
		status, calls int
	}{
		{"save", `{"api_key":"should-not-reach-daemon","project_code":"epower_platform"}`, 400, 0},
		{"save", `null`, 400, 0}, {"save", `{}`, 400, 0},
		{"save", string(valid) + ` {}`, 400, 0},
		{"save", strings.TrimSuffix(string(valid), "}") + `,"extra":"secret"}`, 400, 0},
		{"save", strings.Replace(string(valid), `"ciphertext":"`, `"ciphertext":"`+strings.Repeat("A", 20000), 1), 400, 0},
		{"save", string(valid), 409, 1},
		{"setup-session", `{"project_code":"epower_platform"}`, 400, 0},
		{"setup-session", `{}`, 409, 1},
		{"setup-session", `null`, 400, 0},
		{"setup-session", ``, 400, 0},
	} {
		control := &setupHTTPControl{err: port.ErrManagedMCPOffline}
		h := NewManagedMCPSetupHandler(service.NewManagedMCPSetupService(&setupHTTPStore{}, control))
		router := gin.New()
		router.Use(func(c *gin.Context) { c.Set("user_id", "owner"); c.Next() })
		router.POST("/machines/:id/save", h.Save)
		router.POST("/machines/:id/setup-session", h.SetupSession)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/machines/machine/"+tc.route, strings.NewReader(tc.body)))
		if response.Code != tc.status || control.calls != tc.calls {
			t.Fatalf("route %s: %d %s calls%d", tc.route, response.Code, response.Body.String(), control.calls)
		}
		if response.Header().Get("Cache-Control") != "no-store" || strings.Contains(response.Body.String(), "secret") {
			t.Fatal("unsafe response")
		}
	}
}

type setupHTTPControl struct {
	calls int
	err   error
}

func (s *setupHTTPControl) RequestManagedMCP(context.Context, string, string, string, ...json.RawMessage) (json.RawMessage, error) {
	s.calls++
	return nil, s.err
}

func TestManagedMCPSetupHTTPRejectsCredentialsAndMapsSafeErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name, user, body string
		upstream         error
		status           int
		message          string
		calls            int
	}{
		{"credential", "owner", `{"api_key":"not-allowed"}`, nil, 400, "empty_body_required", 0},
		{"project", "owner", `{"project_code":"epower_platform"}`, nil, 400, "empty_body_required", 0},
		{"duplicate", "owner", `{} {}`, nil, 400, "empty_body_required", 0},
		{"owner", "other", `{}`, nil, 404, "machine_not_found", 0},
		{"offline", "owner", `{}`, port.ErrManagedMCPOffline, 409, "machine_offline", 1},
		{"upgrade", "owner", `{}`, port.ErrManagedMCPUpgrade, 409, "upgrade_required", 1},
		{"busy", "owner", `{}`, port.ErrManagedMCPBusy, 409, "busy", 1},
		{"timeout", "owner", `{}`, context.DeadlineExceeded, 504, "timeout", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			control := &setupHTTPControl{err: tc.upstream}
			handler := NewManagedMCPSetupHandler(service.NewManagedMCPSetupService(&setupHTTPStore{}, control))
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("user_id", tc.user); c.Next() })
			router.POST("/machines/:id/inspect", handler.Inspect)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/machines/machine/inspect", strings.NewReader(tc.body)))
			if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.message) || control.calls != tc.calls {
				t.Fatalf("response=%d %s calls=%d", response.Code, response.Body.String(), control.calls)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("diagnostic must not be cached")
			}
		})
	}
}
