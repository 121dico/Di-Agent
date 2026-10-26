package bossauth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type IdentityRepository interface {
	GetOrCreateExternalUser(context.Context, string, string) (*model.User, error)
}

type Boundary struct {
	config    Config
	repo      IdentityRepository
	jwtSecret string
	peers     []netip.Prefix
	allowed   map[string]bool
}

func New(cfg Config, repo IdentityRepository, jwtSecret string) (*Boundary, error) {
	cfg.Defaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.Enabled && (repo == nil || len(jwtSecret) < 32) {
		return nil, fmt.Errorf("Boss mode requires identity repository and jwt.secret of at least 32 characters")
	}
	b := &Boundary{config: cfg, repo: repo, jwtSecret: jwtSecret, allowed: make(map[string]bool)}
	if cfg.Enabled {
		for _, p := range cfg.TrustedProxyCIDRs {
			prefix, _ := netip.ParsePrefix(p)
			b.peers = append(b.peers, prefix)
		}
		for _, s := range cfg.AllowedUsernames {
			b.allowed[s] = true
		}
	}
	return b, nil
}

func (b *Boundary) Providers(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	mode, login := "local", ""
	if b.config.Enabled {
		mode, login = "boss", b.config.LoginURL
		if b.config.AllowLocalLogin {
			mode = "hybrid"
		}
	}
	middleware.SuccessResponse(c, gin.H{
		"mode": mode, "login_url": login,
		"local_login_enabled": !b.config.Enabled || b.config.AllowLocalLogin,
		"boss_enabled":        b.config.Enabled,
		"boss_ready":          b.config.Enabled && b.config.LoginURL != "",
	})
}

func (b *Boundary) subject(r *http.Request) (string, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", false
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return "", false
	}
	trusted := false
	for _, p := range b.peers {
		if p.Contains(addr.Unmap()) {
			trusted = true
			break
		}
	}
	if !trusted {
		return "", false
	}
	secrets, subjects := r.Header.Values(OriginSecretHeader), r.Header.Values(b.config.IdentityHeader)
	if len(secrets) != 1 || len(subjects) != 1 {
		return "", false
	}
	actual, expected := sha256.Sum256([]byte(secrets[0])), sha256.Sum256([]byte(b.config.OriginSecret))
	if subtle.ConstantTimeCompare(actual[:], expected[:]) != 1 || !ValidSubject(subjects[0]) || !b.allowed[subjects[0]] {
		return "", false
	}
	return subjects[0], true
}

func deny(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	middleware.ErrorResponse(c, http.StatusUnauthorized, 40170, "Boss gateway authentication required")
	c.Abort()
}

func (b *Boundary) Session(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !b.config.Enabled {
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50371, "Boss login is not configured")
		return
	}
	subject := c.GetString("boss_verified_subject")
	if subject == "" {
		deny(c)
		return
	}
	user, err := b.repo.GetOrCreateExternalUser(c.Request.Context(), "boss", subject)
	if err != nil || user == nil {
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50370, "Boss identity service unavailable")
		return
	}
	now := time.Now()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID, "username": user.Username, "auth_provider": "boss", "sub": subject,
		"iat": now.Unix(), "exp": now.Add(time.Duration(b.config.SessionTTLMinutes) * time.Minute).Unix(),
	}).SignedString([]byte(b.jwtSecret))
	if err != nil {
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50099, "Session creation failed")
		return
	}
	middleware.SuccessResponse(c, gin.H{"token": token, "user": user})
}

// Guard 仅验证公司登录入口并清除专用密钥，不改变业务 API/WS 的既有鉴权。
// 必须在路由注册前安装，避免专用密钥被后续代理透传。
func (b *Boundary) Guard() gin.HandlerFunc {
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if b.config.Enabled && p == "/api/auth/boss/session" && c.Request.Method == http.MethodPost {
			if subject, trusted := b.subject(c.Request); trusted {
				c.Set("boss_verified_subject", subject)
			}
		}
		c.Request.Header.Del(OriginSecretHeader)
		// 独占选项只控制新本地登录，不撤销已经签发的应用会话。
		if b.config.Enabled && !b.config.AllowLocalLogin && (p == "/api/auth/login" || p == "/api/auth/register") {
			deny(c)
			return
		}
		c.Next()
	}
}
