package main

import "testing"

func TestReadDiAgentEnvMigratesRetiredPrefixWithoutOverridingCanonicalValue(t *testing.T) {
	t.Setenv("AGENTHUB_CONFIG", "retired.yaml") // [brand-compat] 旧部署输入。

	if got := readDiAgentEnv("CONFIG"); got != "retired.yaml" {
		t.Fatalf("expected retired deployment value, got %q", got)
	}

	t.Setenv("DI_AGENT_CONFIG", "canonical.yaml")
	if got := readDiAgentEnv("CONFIG"); got != "canonical.yaml" {
		t.Fatalf("canonical value must win, got %q", got)
	}
}
