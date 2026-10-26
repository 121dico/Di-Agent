package bossauth_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestVerifiedCompanyLoginCreatesIndependentApplicationSession(t *testing.T) {
	b, err := bossauth.New(config(), &identities{}, signingSecret)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(b.Guard())
	r.POST("/api/auth/boss/session", b.Session)
	r.GET("/api/me", middleware.Auth(middleware.JWTConfig{Secret: signingSecret}), func(c *gin.Context) { c.String(200, middleware.GetUserID(c)) })
	r.GET("/ws", middleware.Auth(middleware.JWTConfig{Secret: signingSecret}), func(c *gin.Context) { c.String(200, middleware.GetUserID(c)) })
	w := request(r, "POST", "/api/auth/boss/session", "", nil)
	var out struct{ Data struct{ Token string } }
	if w.Code != 200 {
		t.Fatalf("trusted login failed: %d", w.Code)
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/me", "/ws?token=" + out.Data.Token} {
		w = request(r, "GET", path, out.Data.Token, func(req *http.Request) {
			req.RemoteAddr = "198.51.100.12:123"
			req.Header.Del("Username")
			req.Header.Del(bossauth.OriginSecretHeader)
		})
		if w.Code != 200 || w.Body.String() != "f7737c36-8f9f-46ec-a24f-b8d3e2a85388" {
			t.Fatalf("application session wrongly depends on gateway: %s %d", path, w.Code)
		}
	}
}

func TestUnconfiguredCompanyLoginIsDiagnosable(t *testing.T) {
	r := routes(t, bossauth.Config{}, &identities{})
	w := request(r, "POST", "/api/auth/boss/session", "", nil)
	var out struct {
		Code    int
		Message string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != 503 || out.Code != 50371 || out.Message != "Boss login is not configured" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unconfigured endpoint must identify itself: %d %s", w.Code, w.Body.String())
	}
}

func TestProviderClaimsCannotReplaceTrustedLoginOrApplicationSignature(t *testing.T) {
	r := routes(t, config(), &identities{})
	// 即使是服务器已签发的应用令牌，也不是再次认证公司身份的凭据。
	token := sign(t, func(c jwt.MapClaims) { c["auth_provider"] = "unknown" })
	w := request(r, "POST", "/api/auth/boss/session", token, func(req *http.Request) { req.Header.Del(bossauth.OriginSecretHeader) })
	if w.Code != 401 {
		t.Fatal("provider claim replaced trusted identity", w.Code)
	}
	for _, provider := range []string{"boss", "unknown"} {
		forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": "id", "auth_provider": provider}).SignedString([]byte("attacker-key"))
		if err != nil {
			t.Fatal(err)
		}
		if got := request(r, "GET", "/api/test", forged, nil).Code; got != 401 {
			t.Fatal("original JWT verification bypassed", got)
		}
	}
}
