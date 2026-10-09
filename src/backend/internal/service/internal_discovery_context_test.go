package service

import (
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestAgentConfigDisclosesOnlyInternalDiscoveryEntry(t *testing.T) {
	got := BuildAgentConfigText(&model.Agent{ID: "a-1", Name: "助手", CLITool: "codex"}, "", "你好")
	for _, want := range []string{"discover_internal_sources", "get_internal_source_guide"} {
		if !strings.Contains(got, want) {
			t.Fatalf("initial context missing progressive discovery tool %q", want)
		}
	}
	for _, forbidden := range []string{"boss.xiaojukeji.com", "git.xiaojukeji.com", "HiveServer2", "DI_AGENT_HIVE_PASSWORD", "适合寻找业务解释、指标口径和方案线索"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("initial context leaked source detail %q", forbidden)
		}
	}
}
