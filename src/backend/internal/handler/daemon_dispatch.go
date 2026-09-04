package handler

import (
	"context"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

// DispatchTask 由任务队列创建回调触发，在线 daemon 立即收到 task.execute。
func (h *DaemonHandler) DispatchTask(task *model.DaemonTask) {
	if task == nil || task.ID == "" || task.MachineID == "" {
		return
	}

	if !h.daemonHub.IsConnected(task.MachineID) {
		return
	}
	h.daemonHub.RegisterTaskPromise(task.ID)

	data := map[string]interface{}{
		"task_id":          task.ID,
		"cli_tool":         task.CLITool,
		"runtime_variant":  task.RuntimeVariant,
		"prompt":           task.Prompt,
		"context_messages": task.ContextMessages,
		"agent_id":         task.AgentID,
		"conversation_id":  task.ConversationID,
		"user_id":          task.UserID,
	}
	if task.RuntimeConfig.Version > 0 {
		data["runtime_config"] = task.RuntimeConfig
	}
	message := ws.WSMessage{
		Type: "task.dispatch",
		Data: data,
	}
	var err error
	if task.CLITool == "codex" {
		err = h.daemonHub.SendToMachineRequiringCapability(task.MachineID, "agent_runtime_controls_v1", message)
	} else {
		err = h.daemonHub.SendToMachine(task.MachineID, message)
	}
	if err != nil {
		h.daemonHub.RemoveTaskPromise(task.ID)
		h.logger.Warn("daemon task dispatch failed",
			"machine", task.MachineID, "task", task.ID, "error", err)
		h.failTask(task.MachineID, task.ID, "daemon dispatch failed: "+err.Error())
	}
}

// handleTaskComplete 已在 daemon.go 中定义。

func (h *DaemonHandler) failTask(machineID, taskID, reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	machine := &model.DaemonMachine{ID: machineID}
	if _, err := h.agentSvc.CompleteDaemonTask(ctx, machine, taskID, "", reason); err != nil {
		h.logger.Warn("mark daemon task failed", "machine", machineID, "task", taskID, "error", err)
	}

	// 清理 promise
	h.daemonHub.ResolveTask(taskID, &ws.TaskResult{
		TaskID: taskID,
		Error:  reason,
	})
}
