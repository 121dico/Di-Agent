package router_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/router"
	"github.com/gin-gonic/gin"
)

func TestBrowserCanOpenDisabledBossSessionStatus(t *testing.T) {
	b, err := bossauth.New(bossauth.Config{}, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	r := gin.New()
	r.Use(b.Guard())
	router.Setup(r, router.Deps{BossBoundary: b})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/boss/session", nil))
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "text/html; charset=utf-8" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("browser status: %d %v", w.Code, w.Header())
	}
	for _, text := range []string{"Di Agent", "服务可访问", "Boss 登录尚未启用", "页面可打开不代表公司登录已打通", `href="/login"`} {
		if !strings.Contains(w.Body.String(), text) {
			t.Errorf("missing status content %q", text)
		}
	}
	post := httptest.NewRecorder()
	r.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/api/auth/boss/session", nil))
	if post.Code != http.StatusServiceUnavailable || !strings.Contains(post.Body.String(), `"code":50371`) {
		t.Fatalf("status page changed disabled login: %d %s", post.Code, post.Body.String())
	}
}

type statusIdentityStore struct{ t *testing.T }

func (s statusIdentityStore) GetOrCreateExternalUser(context.Context, string, string) (*model.User, error) {
	s.t.Fatal("read-only browser status must not provision a user")
	return nil, nil
}

func TestConfiguredBossStatusDoesNotAuthenticateOrRevealIdentity(t *testing.T) {
	const secret = "test-status-origin-secret-0123456789"
	cfg := bossauth.Config{
		Enabled: true, AllowLocalLogin: true, OriginSecret: secret,
		IdentityHeader: "Username", AllowedUsernames: []string{"private-pilot"},
		TrustedProxyCIDRs: []string{"192.0.2.10/32"},
	}
	b, err := bossauth.New(cfg, statusIdentityStore{t}, "test-status-signing-secret-0123456789")
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	r := gin.New()
	r.Use(b.Guard())
	router.Setup(r, router.Deps{BossBoundary: b})
	for _, peer := range []string{"198.51.100.1:1234", "192.0.2.10:1234"} {
		for i := 0; i < 2; i++ {
			req := httptest.NewRequest(http.MethodGet, "/api/auth/boss/session?name=private-query", nil)
			req.RemoteAddr = peer
			req.Header.Set("Username", "private-pilot")
			req.Header.Set(bossauth.OriginSecretHeader, secret)
			req.Header.Set("Cookie", "private-cookie")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || len(w.Result().Cookies()) != 0 {
				t.Fatalf("configured status response: %d %v", w.Code, w.Header())
			}
			if !strings.Contains(w.Body.String(), "Boss 登录配置已启用") || !strings.Contains(w.Body.String(), "尚不能据此确认") {
				t.Fatal("configured status must distinguish configuration from authentication")
			}
			for _, forbidden := range []string{secret, "private-pilot", "private-query", "private-cookie", "192.0.2.10", `"token"`, "<script", "<form", "https://", "http://"} {
				if strings.Contains(w.Body.String(), forbidden) {
					t.Errorf("status page contains forbidden content %q", forbidden)
				}
			}
		}
	}
	post := httptest.NewRecorder()
	r.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/api/auth/boss/session", nil))
	if post.Code != http.StatusUnauthorized || !strings.Contains(post.Body.String(), `"code":40170`) {
		t.Fatalf("status page bypassed trusted login: %d %s", post.Code, post.Body.String())
	}
}
