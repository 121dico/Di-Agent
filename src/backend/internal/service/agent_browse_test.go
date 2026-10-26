package service

import (
	"context"
	"errors"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

func TestBrowseAgentFilesPersistsOwnershipBeforeDispatch(t *testing.T) {
	user, machine := "owner", "machine"
	repo := &fakeAgentRepo{currentAgent: &model.Agent{ID: "agent", UserID: &user, MachineID: &machine, RuntimeVariant: "desktop"}}
	ch := make(chan *ws.TaskResult, 1)
	hub := &fakeDaemonDispatcher{isConnected: func(string) bool { return true }, registerTaskPromise: func(string) chan *ws.TaskResult { return ch }}
	hub.sendToMachine = func(id string, msg ws.WSMessage) error {
		data := msg.Data.(map[string]interface{})
		if repo.daemonTask == nil {
			t.Fatal("file RPC needs persisted ownership before task.complete can resolve it")
		}
		task := repo.daemonTask
		if task.MachineID != machine || task.UserID != user || task.AgentID != "agent" ||
			task.CLITool != daemonBrowseFilesTool || data["task_id"] != task.ID ||
			data["user_id"] != user || id != machine || data["prompt"] != task.Prompt {
			t.Fatal("file RPC dispatch lost authenticated task identity")
		}
		ch <- &ws.TaskResult{Result: `{"content":"<!doctype html><h1>Preview</h1>"}`}
		return nil
	}
	svc := &AgentService{repo: repo, daemonHub: hub}
	result, err := svc.BrowseAgentFiles(context.Background(), user, "agent", BrowseRequest{Action: "read", WorkDir: "/tmp/project", Path: "/tmp/project/index.html"})
	if err != nil || result == nil || string(*result) != `{"content":"<!doctype html><h1>Preview</h1>"}` {
		t.Fatalf("unexpected result: %v, %v", result, err)
	}
	if hub.Calls().RemoveTaskPromise != 1 {
		t.Fatal("promise leaked")
	}
	_, err = svc.BrowseAgentFiles(context.Background(), "other", "agent", BrowseRequest{Action: "read", WorkDir: "/tmp/project"})
	if !errors.Is(err, ErrAgentNotFound) || hub.Calls().SendToMachine != 1 {
		t.Fatal("cross-user file read was not rejected")
	}
}
