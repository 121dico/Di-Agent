package bossauth_test

import (
	"github.com/121dico/Di-Agent/src/backend/internal/bossauth"
	"testing"
)

func TestEnabledConfigurationRejectsIncompleteBoundary(t *testing.T) {
	for name, change := range map[string]func(*bossauth.Config){
		"no secret":       func(c *bossauth.Config) { c.OriginSecret = "" },
		"short secret":    func(c *bossauth.Config) { c.OriginSecret = "short" },
		"no CIDRs":        func(c *bossauth.Config) { c.TrustedProxyCIDRs = nil },
		"all peers":       func(c *bossauth.Config) { c.TrustedProxyCIDRs = []string{"0.0.0.0/0"} },
		"invalid CIDR":    func(c *bossauth.Config) { c.TrustedProxyCIDRs = []string{"localhost"} },
		"no ACL":          func(c *bossauth.Config) { c.AllowedUsernames = nil },
		"wildcard ACL":    func(c *bossauth.Config) { c.AllowedUsernames = []string{"*"} },
		"reserved header": func(c *bossauth.Config) { c.IdentityHeader = "Authorization" },
		"invalid header":  func(c *bossauth.Config) { c.IdentityHeader = "User name" },
		"HTTP login":      func(c *bossauth.Config) { c.LoginURL = "http://example.test" },
		"credential URL":  func(c *bossauth.Config) { c.LoginURL = "https://secret@example.test" },
		"long TTL":        func(c *bossauth.Config) { c.SessionTTLMinutes = 481 },
	} {
		t.Run(name, func(t *testing.T) {
			c := config()
			change(&c)
			if c.Validate() == nil {
				t.Fatal("unsafe config accepted")
			}
		})
	}
	if err := (bossauth.Config{}).Validate(); err != nil {
		t.Fatal("disabled mode rejected", err)
	}
	if err := config().Validate(); err != nil {
		t.Fatal(err)
	}
}
