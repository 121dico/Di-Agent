package main

import (
	"os"
	"strings"
	"testing"
)

func TestBrandMigrationOnlyUpdatesTheExactPlatformDefaultPrompt(t *testing.T) {
	sqlBytes, err := os.ReadFile("../../migrations/079_update_di_agent_platform_defaults.sql")
	if err != nil {
		t.Fatalf("read brand migration: %v", err)
	}
	sql := string(sqlBytes)
	for _, required := range []string{
		"UPDATE agent_prompt_templates",
		"md5(system_prompt) = 'ac3705d9000676a2bb20f72c65630808'",
		"name = '通用执行型 Agent'",
		"你是 Di Agent 中的通用执行型 Agent",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing exact platform-default guard %q", required)
		}
	}
	for _, forbidden := range []string{"UPDATE messages", "UPDATE attachments", "UPDATE user_templates"} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("migration must not rewrite user content: %s", forbidden)
		}
	}
}
