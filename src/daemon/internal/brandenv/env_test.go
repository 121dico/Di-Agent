package brandenv

import "testing"

func TestReadPrefersCanonicalAndFallsBackToRetiredDeployment(t *testing.T) {
	t.Setenv("AGENTHUB_MACHINE_KEY", "retired") // [brand-compat]
	if got := Read("MACHINE_KEY"); got != "retired" {
		t.Fatalf("expected retired value, got %q", got)
	}
	t.Setenv("DI_AGENT_MACHINE_KEY", "canonical")
	if got := Read("MACHINE_KEY"); got != "canonical" {
		t.Fatalf("expected canonical value, got %q", got)
	}
}
