package tool_specs

import "testing"

func TestInternalDiscoveryToolSpecsMatchDaemonNames(t *testing.T) {
	if got := DiscoverInternalSources().Name(); got != "discover_internal_sources" {
		t.Fatalf("discover tool name = %q", got)
	}
	if got := GetInternalSourceGuide().Name(); got != "get_internal_source_guide" {
		t.Fatalf("guide tool name = %q", got)
	}
	if DiscoverInternalSources().RouteInfo() != nil || GetInternalSourceGuide().RouteInfo() != nil {
		t.Fatal("internal discovery is daemon-local metadata, not a privileged backend route")
	}
}
