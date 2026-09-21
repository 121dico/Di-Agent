package service

import (
	"context"
	"errors"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	"strings"
	"testing"
)

func TestListAgentModelsUsesOwnedRuntimeAndCleansPromise(t *testing.T) {
	user, machine := "owner", "machine"
	repo := &fakeAgentRepo{currentAgent: &model.Agent{ID: "agent", UserID: &user, MachineID: &machine, CLITool: "codex", RuntimeVariant: "desktop"}}
	ch := make(chan *ws.TaskResult, 1)
	hub := &fakeDaemonDispatcher{isConnected: func(string) bool { return true }, registerTaskPromise: func(string) chan *ws.TaskResult { return ch }}
	hub.sendToMachine = func(id string, msg ws.WSMessage) error {
		data := msg.Data.(map[string]interface{})
		if id != machine || data["runtime_variant"] != "desktop" || data["cli_tool"] != daemonModelListTool {
			t.Fatalf("wrong dispatch: %#v", data)
		}
		if repo.daemonTask == nil || repo.daemonTask.MachineID != machine {
			t.Fatal("scan must have authenticated task ownership")
		}
		ch <- &ws.TaskResult{Result: `{"models":[{"id":"runtime-only","label":"Runtime"}],"source":"runtime"}`}
		return nil
	}
	svc := &AgentService{repo: repo, daemonHub: hub}
	got, err := svc.ListAgentModels(context.Background(), user, "agent")
	if err != nil || len(got.Models) != 1 || got.Models[0].ID != "runtime-only" {
		t.Fatalf("got %#v, %v", got, err)
	}
	if hub.Calls().RemoveTaskPromise != 1 {
		t.Fatal("promise leaked")
	}
	_, err = svc.ListAgentModels(context.Background(), "other", "agent")
	if !errors.Is(err, ErrAgentNotFound) || hub.Calls().SendToMachine != 1 {
		t.Fatalf("ownership failed: %v", err)
	}
}
func TestListAgentModelsOfflineOldDaemonAndCancellation(t *testing.T) {
	user, machine := "owner", "machine"
	repo := &fakeAgentRepo{currentAgent: &model.Agent{UserID: &user, MachineID: &machine}}
	hub := &fakeDaemonDispatcher{}
	svc := &AgentService{repo: repo, daemonHub: hub}
	if _, err := svc.ListAgentModels(context.Background(), user, "a"); !errors.Is(err, ErrAgentOffline) {
		t.Fatal(err)
	}
	hub.isConnected = func(string) bool { return true }
	hub.supportsCapability = func(string, string) bool { return false }
	if _, err := svc.ListAgentModels(context.Background(), user, "a"); !errors.Is(err, ErrMsgInvalidRuntime) {
		t.Fatal(err)
	}
	hub.supportsCapability = nil
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.ListAgentModels(ctx, user, "a"); !errors.Is(err, ErrMsgAgentTimeout) {
		t.Fatal(err)
	}
	if hub.Calls().RemoveTaskPromise != 1 {
		t.Fatal("cancel leaked promise")
	}
}
func TestNormalizeRuntimeSupportsDiscoveredModelsAndWireDefaults(t *testing.T) {
	for _, name := range []string{"default", "", "runtime/new-model[1m]"} {
		got, err := NormalizeAgentRuntimeConfig(model.AgentRuntimeConfig{Model: name, ReasoningEffort: "ultra"})
		if err != nil {
			t.Fatal(err)
		}
		if name == "default" && got.Model != "" {
			t.Fatal("default alias must be omitted natively")
		}
	}
	for _, name := range []string{"--model", "bad\nmodel", strings.Repeat("x", 201)} {
		if _, err := NormalizeAgentRuntimeConfig(model.AgentRuntimeConfig{Model: name}); err == nil {
			t.Fatalf("accepted invalid model %q", name)
		}
	}
}
