package tool_specs

import "testing"

func TestReportAgentToolSpecsExposeDiscoveryQueryAndSave(t *testing.T) {
	tests := []struct {
		name string
		got  string
	}{
		{"discover", DiscoverReportData().Name()},
		{"query", QueryReportData().Name()},
		{"save", SavePersonalReport().Name()},
	}
	wants := []string{"discover_report_data", "query_report_data", "save_personal_report"}
	for i, tt := range tests {
		if tt.got != wants[i] {
			t.Fatalf("%s tool name = %q, want %q", tt.name, tt.got, wants[i])
		}
	}
	if route := QueryReportData().RouteInfo(); route == nil || route.Method != "POST" || route.Path != "/mcp/report-data/query" {
		t.Fatalf("unexpected report query route: %#v", route)
	}
	queryProperties, _ := QueryReportData().InputSchema()["properties"].(map[string]interface{})
	if queryProperties["source_id"] == nil || queryProperties["fields"] == nil || queryProperties["query"] != nil {
		t.Fatalf("query tool must expose the same direct DSL as the daemon, got %#v", queryProperties)
	}
	saveProperties, _ := SavePersonalReport().InputSchema()["properties"].(map[string]interface{})
	if saveProperties["title"] == nil || saveProperties["query_id"] == nil || saveProperties["report"] != nil {
		t.Fatalf("save tool must expose direct report arguments, got %#v", saveProperties)
	}
}
