package bossauth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"github.com/121dico/Di-Agent/src/backend/internal/handler"
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type identities struct {
	calls int
	fail  bool
}

func (r *identities) GetOrCreateExternalUser(_ context.Context, provider, subject string) (*model.User, error) {
	r.calls++
	if provider != "boss" || subject != "alice" {
		return nil, errors.New("unexpected identity")
	}
	if r.fail {
		return nil, errors.New("private database error")
	}
	return &model.User{ID: "f7737c36-8f9f-46ec-a24f-b8d3e2a85388", Username: "boss:unique"}, nil
}

const signingSecret = "test-signing-key-not-production-0123456789"
const originSecret = "test-origin-key-not-production-0123456789"

func config() bossauth.Config {
	return bossauth.Config{Enabled: true, IdentityHeader: "Username", TrustedProxyCIDRs: []string{"192.0.2.10/32"}, AllowedUsernames: []string{"alice", "bob"}, OriginSecret: originSecret, SessionTTLMinutes: 60, LoginURL: "https://login.example.test/di-agent"}
}
func routes(t *testing.T, cfg bossauth.Config, repo *identities) *gin.Engine {
	t.Helper()
	b, err := bossauth.New(cfg, repo, signingSecret)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(b.Guard())
	r.GET("/api/auth/providers", b.Providers)
	r.POST("/api/auth/boss/session", b.Session)
	r.POST("/api/auth/login", func(c *gin.Context) { c.Status(204) })
	r.POST("/api/auth/register", func(c *gin.Context) { c.Status(204) })
	r.GET("/api/test", middleware.Auth(middleware.JWTConfig{Secret: signingSecret}), func(c *gin.Context) { c.Status(204) })
	for _, p := range []string{"/daemon/test", "/mcp/test", "/api/internal/test"} {
		r.GET(p, middleware.MCPAuth("machine-test"), func(c *gin.Context) { c.Status(204) })
	}
	return r
}
func request(r *gin.Engine, method, path, token string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = "192.0.2.10:8080"
	req.Header.Set("Username", "alice")
	req.Header.Set(bossauth.OriginSecretHeader, originSecret)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if mutate != nil {
		mutate(req)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}
func sign(t *testing.T, change func(jwt.MapClaims)) string {
	t.Helper()
	c := jwt.MapClaims{"user_id": "id", "auth_provider": "boss", "sub": "alice", "exp": time.Now().Add(time.Hour).Unix()}
	if change != nil {
		change(c)
	}
	s, e := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(signingSecret))
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestForgedOrAmbiguousGatewayDenied(t *testing.T) {
	for name, mutate := range map[string]func(*http.Request){
		"forged XFF":         func(r *http.Request) { r.RemoteAddr = "198.51.100.1:32"; r.Header.Set("X-Forwarded-For", "192.0.2.10") },
		"missing secret":     func(r *http.Request) { r.Header.Del(bossauth.OriginSecretHeader) },
		"wrong secret":       func(r *http.Request) { r.Header.Set(bossauth.OriginSecretHeader, "wrong") },
		"duplicate secret":   func(r *http.Request) { r.Header.Add(bossauth.OriginSecretHeader, originSecret) },
		"duplicate identity": func(r *http.Request) { r.Header.Add("Username", "alice") },
		"combined identity":  func(r *http.Request) { r.Header.Set("Username", "alice,bob") },
		"space identity":     func(r *http.Request) { r.Header.Set("Username", " alice") },
		"not allowed":        func(r *http.Request) { r.Header.Set("Username", "mallory") },
	} {
		t.Run(name, func(t *testing.T) {
			repo := &identities{}
			r := routes(t, config(), repo)
			w := request(r, "POST", "/api/auth/boss/session", "", mutate)
			if w.Code != 401 || repo.calls != 0 {
				t.Fatalf("status %d calls %d", w.Code, repo.calls)
			}
		})
	}
}
func TestIdentityOutageDoesNotLeakOrIssueSession(t *testing.T) {
	r := routes(t, config(), &identities{fail: true})
	w := request(r, "POST", "/api/auth/boss/session", "", nil)
	if w.Code != 503 || strings.Contains(w.Body.String(), "private database") {
		t.Fatal(w.Body.String())
	}
}
func TestOriginSecretNeverReachesBusinessProxy(t *testing.T) {
	seen := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Header.Get(bossauth.OriginSecretHeader)
		w.WriteHeader(204)
	}))
	defer upstream.Close()
	proxy, err := handler.NewDeliveryAnalysisHandler(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{true, false} {
		cfg := config()
		cfg.Enabled = enabled
		b, err := bossauth.New(cfg, &identities{}, signingSecret)
		if err != nil {
			t.Fatal(err)
		}
		r := gin.New()
		r.Use(b.Guard())
		r.GET("/delivery-analysis-app/*filepath", proxy.Static)
		w := request(r, "GET", "/delivery-analysis-app/api/status", "", nil)
		if w.Code != 204 {
			t.Fatalf("existing proxy route changed: %d", w.Code)
		}
		if <-seen != "" {
			t.Fatal("origin secret forwarded")
		}
	}
}
