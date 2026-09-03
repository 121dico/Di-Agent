package repository

import (
	"reflect"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestPruneMachineAgentCandidatesQueryIsMachineScopedAndKeepsActiveVariants(t *testing.T) {
	query, args := pruneMachineAgentCandidatesQuery("machine-1", []model.AgentCandidateRuntime{
		{CLITool: "codex", Variant: "cli"},
		{CLITool: "codex", Variant: "desktop"},
	})

	if !strings.HasPrefix(query, "DELETE FROM daemon_agent_candidates WHERE machine_id = $1") {
		t.Fatalf("prune must be scoped to one machine: %s", query)
	}
	if strings.Contains(query, "DELETE FROM agents") {
		t.Fatalf("candidate synchronization must never delete created Agents: %s", query)
	}
	if !strings.Contains(query, "(cli_tool = $2 AND variant = $3) OR (cli_tool = $4 AND variant = $5)") {
		t.Fatalf("active CLI/Desktop variants are not protected: %s", query)
	}
	wantArgs := []interface{}{"machine-1", "codex", "cli", "codex", "desktop"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("prune args = %#v, want %#v", args, wantArgs)
	}
}

func TestPruneMachineAgentCandidatesQueryEmptySnapshotRemovesOnlyThatMachinesCandidates(t *testing.T) {
	query, args := pruneMachineAgentCandidatesQuery("machine-empty", nil)
	if query != "DELETE FROM daemon_agent_candidates WHERE machine_id = $1" {
		t.Fatalf("empty snapshot query = %q", query)
	}
	if !reflect.DeepEqual(args, []interface{}{"machine-empty"}) {
		t.Fatalf("empty snapshot args = %#v", args)
	}
}
