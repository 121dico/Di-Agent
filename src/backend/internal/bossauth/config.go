// Package bossauth 实现 Di Agent 的可信网关适配协议，
// 不假设或实现 Boss 原生 OAuth/SSO 协议。
package bossauth

import (
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

const OriginSecretHeader = "X-Di-Agent-Boss-Secret"

type Config struct {
	Enabled           bool     `koanf:"enabled"`
	AllowLocalLogin   bool     `koanf:"allow_local_login"`
	LoginURL          string   `koanf:"login_url"`
	IdentityHeader    string   `koanf:"identity_header"`
	TrustedProxyCIDRs []string `koanf:"trusted_proxy_cidrs"`
	AllowedUsernames  []string `koanf:"allowed_usernames"`
	SessionTTLMinutes int      `koanf:"session_ttl_minutes"`
	OriginSecret      string   `koanf:"-" json:"-"`
}

func (c *Config) Defaults() {
	if c.IdentityHeader == "" {
		c.IdentityHeader = "Username"
	}
	if c.SessionTTLMinutes == 0 {
		c.SessionTTLMinutes = 60
	}
}

func ValidSubject(s string) bool {
	return regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$`).MatchString(s)
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}
	if len(c.OriginSecret) < 32 || strings.TrimSpace(c.OriginSecret) != c.OriginSecret {
		return fmt.Errorf("boss requires DI_AGENT_BOSS_ORIGIN_SECRET of at least 32 characters")
	}
	if !regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`).MatchString(c.IdentityHeader) {
		return fmt.Errorf("boss.identity_header must be a valid dedicated header")
	}
	switch strings.ToLower(c.IdentityHeader) {
	case strings.ToLower(OriginSecretHeader), "authorization", "cookie", "host", "origin", "x-forwarded-for", "forwarded", "connection":
		return fmt.Errorf("boss.identity_header conflicts with a reserved header")
	}
	if c.SessionTTLMinutes < 1 || c.SessionTTLMinutes > 480 {
		return fmt.Errorf("boss.session_ttl_minutes must be 1-480")
	}
	if len(c.TrustedProxyCIDRs) == 0 {
		return fmt.Errorf("boss.trusted_proxy_cidrs is required")
	}
	for _, cidr := range c.TrustedProxyCIDRs {
		p, err := netip.ParsePrefix(cidr)
		if err != nil || p.Bits() == 0 {
			return fmt.Errorf("boss.trusted_proxy_cidrs requires explicit non-universal CIDRs")
		}
	}
	if len(c.AllowedUsernames) == 0 {
		return fmt.Errorf("boss.allowed_usernames is required")
	}
	for _, s := range c.AllowedUsernames {
		if !ValidSubject(s) {
			return fmt.Errorf("boss.allowed_usernames contains an invalid identity")
		}
	}
	if c.LoginURL != "" {
		u, err := url.Parse(c.LoginURL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
			return fmt.Errorf("boss.login_url must be an absolute HTTPS URL without credentials or fragment")
		}
	}
	return nil
}
