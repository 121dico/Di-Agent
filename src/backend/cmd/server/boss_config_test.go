package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBossConfigLoadDefaultsAndEnvironmentOnlySecret(t *testing.T) {
	t.Setenv("DI_AGENT_CONFIG", "")
	t.Setenv("DI_AGENT_BOSS_ORIGIN_SECRET", "")
	base := "server:\n  port: 8080\ndatabase:\n  host: localhost\n  dbname: isolated-test\njwt:\n  secret: test-jwt-key-at-least-thirty-two-characters\nrag:\n  enabled: false\n"
	p := filepath.Join(t.TempDir(), "config.yaml")
	write := func(s string) {
		t.Helper()
		if err := os.WriteFile(p, []byte(s), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(base)
	c, err := loadConfig(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.Boss.Enabled || c.Boss.IdentityHeader != "Username" || c.Boss.SessionTTLMinutes != 60 {
		t.Fatal("incorrect Boss defaults")
	}
	enabled := base + "boss:\n  enabled: true\n  trusted_proxy_cidrs: [192.0.2.10/32]\n  allowed_usernames: [alice]\n  originsecret: forbidden-file-secret-at-least-thirty-two-chars\n  origin_secret: forbidden-file-secret-at-least-thirty-two-chars\n"
	write(enabled)
	if _, err = loadConfig(p); err == nil || !strings.Contains(err.Error(), "DI_AGENT_BOSS_ORIGIN_SECRET") {
		t.Fatalf("file secret accepted: %v", err)
	}
	t.Setenv("DI_AGENT_BOSS_ORIGIN_SECRET", "test-env-secret-at-least-thirty-two-characters")
	c, err = loadConfig(p)
	if err != nil {
		t.Fatal(err)
	}
	if c.Boss.OriginSecret != "test-env-secret-at-least-thirty-two-characters" {
		t.Fatal("environment not authoritative")
	}
}
