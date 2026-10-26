package bossauth_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestProviderMetadataModes(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		enabled, local, ready bool
		url, mode             string
	}{
		{"disabled", false, false, false, "", "local"}, {"disabled configured", false, true, false, "https://login.example.test/start", "local"},
		{"hybrid", true, true, true, "https://login.example.test/start", "hybrid"}, {"hybrid no URL", true, true, false, "", "hybrid"}, {"exclusive", true, false, true, "https://login.example.test/start", "boss"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := config()
			cfg.Enabled = tc.enabled
			cfg.AllowLocalLogin = tc.local
			cfg.LoginURL = tc.url
			w := request(routes(t, cfg, &identities{}), "GET", "/api/auth/providers", "", nil)
			var out struct {
				Data struct {
					Mode     string `json:"mode"`
					LoginURL string `json:"login_url"`
					Local    bool   `json:"local_login_enabled"`
					Enabled  bool   `json:"boss_enabled"`
					Ready    bool   `json:"boss_ready"`
				}
			}
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || out.Data.Mode != tc.mode || out.Data.Local != (!tc.enabled || tc.local) || out.Data.Enabled != tc.enabled || out.Data.Ready != tc.ready {
				t.Fatalf("unexpected metadata: %s", w.Body.String())
			}
			if !tc.enabled && out.Data.LoginURL != "" {
				t.Fatal("disabled URL exposed")
			}
		})
	}
}

func TestLoginSwitchDoesNotChangeExistingApplicationOrMachineAuth(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		for _, allow := range []bool{true, false} {
			cfg := config()
			cfg.Enabled = enabled
			cfg.AllowLocalLogin = allow
			r := routes(t, cfg, &identities{})
			want := 204
			if enabled && !allow {
				want = 401
			}
			for _, path := range []string{"/api/auth/login", "/api/auth/register"} {
				if got := request(r, "POST", path, "", nil).Code; got != want {
					t.Fatalf("login switch got %d want %d", got, want)
				}
			}
			for _, token := range []string{sign(t, nil), sign(t, func(c jwt.MapClaims) { delete(c, "auth_provider"); delete(c, "sub"); c["scope"] = "agent_management" })} {
				if got := request(r, "GET", "/api/test", token, func(req *http.Request) {
					req.RemoteAddr = "198.51.100.8:1"
					req.Header.Del(bossauth.OriginSecretHeader)
				}).Code; got != 204 {
					t.Fatal("existing signed application token blocked", got)
				}
			}
			for _, token := range []string{"", "malformed", sign(t, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() })} {
				if got := request(r, "GET", "/api/test", token, nil).Code; got != 401 {
					t.Fatal("existing JWT verifier bypassed", got)
				}
			}
			for _, path := range []string{"/daemon/test", "/mcp/test", "/api/internal/test"} {
				if request(r, "GET", path, "", nil).Code != 401 || request(r, "GET", path, "machine-test", nil).Code != 204 {
					t.Fatal("machine authentication changed")
				}
			}
		}
	}
}

func TestExistingScopedRouteStillEnforcesScope(t *testing.T) {
	b, err := bossauth.New(config(), &identities{}, signingSecret)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(b.Guard())
	r.GET("/api/scoped", middleware.Auth(middleware.JWTConfig{Secret: signingSecret, RequiredScope: "agent_management"}), func(c *gin.Context) { c.Status(204) })
	if got := request(r, "GET", "/api/scoped", sign(t, nil), nil).Code; got != 403 {
		t.Fatal("ordinary session bypassed scoped route", got)
	}
	token := sign(t, func(c jwt.MapClaims) { delete(c, "auth_provider"); c["scope"] = "agent_management" })
	if got := request(r, "GET", "/api/scoped", token, nil).Code; got != 204 {
		t.Fatal("legitimate scoped token broken", got)
	}
}
