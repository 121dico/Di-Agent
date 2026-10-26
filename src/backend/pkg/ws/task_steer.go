package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// ActiveTaskIdentity 只包含服务端派发时已验证的身份，不接收浏览器指定任务。
type ActiveTaskIdentity struct {
	TaskID         string `json:"task_id"`
	MachineID      string `json:"machine_id"`
	ConversationID string `json:"conversation_id"`
	UserID         string `json:"user_id"`
	AgentID        string `json:"agent_id"`
}

type TaskSteerResult struct {
	RequestID string `json:"request_id"`
	TaskID    string `json:"task_id"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
}

type taskSteerPending struct {
	client *DaemonClient
	taskID string
	result chan TaskSteerResult
}

// ActiveTask 只返回同一会话、用户和 Agent 的唯一在途任务；歧义时不猜测。
func (dh *DaemonHub) ActiveTask(conversationID, userID, agentID string) (ActiveTaskIdentity, bool) {
	return dh.findActiveTask(conversationID, userID, agentID)
}

// ActiveAgentTask 用于排队等待；绝不将其他用户的任务作为引导目标。
func (dh *DaemonHub) ActiveAgentTask(conversationID, agentID string) (ActiveTaskIdentity, bool) {
	found, unique := dh.findActiveTask(conversationID, "", agentID)
	return found, unique || found.TaskID != ""
}

func (dh *DaemonHub) findActiveTask(conversationID, userID, agentID string) (ActiveTaskIdentity, bool) {
	var found ActiveTaskIdentity
	count := 0
	dh.taskCancelData.Range(func(key, value interface{}) bool {
		data, ok := value.(map[string]interface{})
		if !ok || data["conversation_id"] != conversationID || (userID != "" && data["user_id"] != userID) || data["agent_id"] != agentID {
			return true
		}
		machine, ok := dh.taskMachines.Load(key)
		if !ok {
			return true
		}
		count++
		owner, _ := data["user_id"].(string)
		found = ActiveTaskIdentity{TaskID: key.(string), MachineID: machine.(string), ConversationID: conversationID, UserID: owner, AgentID: agentID}
		return true
	})
	return found, count == 1
}

// SteerTask 成功入写队列之后的超时只能是未知，绝不能当作拒绝重新执行。
func (dh *DaemonHub) SteerTask(ctx context.Context, task ActiveTaskIdentity, prompt string) TaskSteerResult {
	unavailable := TaskSteerResult{TaskID: task.TaskID, Status: "unavailable"}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	dh.lifecycleMu.Lock()
	current, ok := dh.ActiveTask(task.ConversationID, task.UserID, task.AgentID)
	value, connected := dh.clients.Load(task.MachineID)
	if !ok || current != task || !connected {
		dh.lifecycleMu.Unlock()
		return unavailable
	}
	client := value.(*DaemonClient)
	requestID := uuid.NewString()
	pending := &taskSteerPending{client: client, taskID: task.TaskID, result: make(chan TaskSteerResult, 1)}
	dh.steerPending.Store(requestID, pending)
	err := client.sendRequiringCapability("task_steer_v1", WSMessage{Type: "task.steer", Data: map[string]interface{}{
		"request_id": requestID, "task_id": task.TaskID, "conversation_id": task.ConversationID, "user_id": task.UserID, "agent_id": task.AgentID, "prompt": prompt,
	}})
	dh.lifecycleMu.Unlock()
	defer dh.steerPending.Delete(requestID)
	if err != nil {
		return unavailable
	}
	select {
	case result := <-pending.result:
		return result
	case <-ctx.Done():
		return TaskSteerResult{TaskID: task.TaskID, RequestID: requestID, Status: "unknown", Reason: "引导回执未确认"}
	}
}

// ResolveTaskSteer 必须由发起请求的同一条已认证连接确认。
func (dh *DaemonHub) ResolveTaskSteer(client *DaemonClient, raw json.RawMessage) {
	var result TaskSteerResult
	if json.Unmarshal(raw, &result) != nil {
		return
	}
	value, ok := dh.steerPending.Load(result.RequestID)
	if !ok {
		return
	}
	pending := value.(*taskSteerPending)
	if pending.client != client || pending.taskID != result.TaskID {
		return
	}
	current, ok := dh.clients.Load(client.MachineID)
	if !ok || current != client {
		return
	}
	if result.Status != "accepted" && result.Status != "unavailable" && result.Status != "unknown" {
		result.Status = "unknown"
	}
	select {
	case pending.result <- result:
	default:
	}
}
