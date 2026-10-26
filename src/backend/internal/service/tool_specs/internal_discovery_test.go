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
	if got := SearchDataMapHiveTables().Name(); got != "search_data_map_hive_tables" {
		t.Fatalf("data map search name = %q", got)
	}
	if route := SearchDataMapHiveTables().RouteInfo(); route == nil || route.Method != "GET" || route.Path != "/daemon/internal-sources/data-map/hive/tables" {
		t.Fatalf("unexpected data map search route: %+v", route)
	}
	if got := ProbeHiveData().Name(); got != "probe_hive_data" {
		t.Fatalf("Hive data probe name = %q", got)
	}
	if route := ProbeHiveData().RouteInfo(); route == nil || route.Method != "POST" || route.Path != "/daemon/internal-sources/hive-data/probe" {
		t.Fatalf("unexpected Hive data probe route: %+v", route)
	}
}
