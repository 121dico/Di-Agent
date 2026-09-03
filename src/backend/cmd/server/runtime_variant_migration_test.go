package main

import (
	"os"
	"strings"
	"testing"
)

func TestRuntimeVariantMigrationPreservesCandidatesAndAgentSelection(t *testing.T) {
	content, err := os.ReadFile("../../migrations/080_add_agent_runtime_variant.sql")
	if err != nil {
		t.Fatalf("read runtime variant migration: %v", err)
	}
	sql := strings.ToLower(string(content))
	for _, required := range []string{
		"add column if not exists runtime_variant",
		"check (runtime_variant in ('cli', 'desktop'))",
		"set runtime_variant = c.variant",
		"on daemon_agent_candidates (machine_id, cli_tool, variant)",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
	if strings.Index(sql, "add column if not exists runtime_variant") > strings.Index(sql, "set runtime_variant = c.variant") {
		t.Fatal("runtime_variant must exist before startup migration backfills old Agents")
	}
	if strings.Index(sql, "set runtime_variant = c.variant") > strings.Index(sql, "drop index if exists idx_daemon_agent_candidates_machine_cli") {
		t.Fatal("old one-candidate uniqueness must remain in force during Agent backfill")
	}
}
