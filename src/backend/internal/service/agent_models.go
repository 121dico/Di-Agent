package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

const daemonModelListTool = "__di_agent_list_models__"
const modelDiscoveryCapability = "model_discovery_v1"

type RuntimeModelOption struct {
	ID                     string   `json:"id"`
	Label                  string   `json:"label"`
	ResolvedModel          string   `json:"resolved_model,omitempty"`
	IsDefault              bool     `json:"is_default"`
	ReasoningEfforts       []string `json:"reasoning_efforts"`
	DefaultReasoningEffort string   `json:"default_reasoning_effort,omitempty"`
	SupportsPriority       bool     `json:"supports_priority"`
}
type RuntimeModelCatalog struct {
	Models       []RuntimeModelOption `json:"models"`
	DefaultModel string               `json:"default_model"`
	Source       string               `json:"source"`
	Warning      string               `json:"warning,omitempty"`
	ScannedAt    string               `json:"scanned_at,omitempty"`
}

// ListAgentModels 只扫描已鉴权 Agent 的原生运行器，不接受客户端提供的命令或机器路径。
func (s *AgentService) ListAgentModels(ctx context.Context, userID, agentID string) (*RuntimeModelCatalog, error) {
	if userID == "" || agentID == "" {
		return nil, ErrAgentInvalidInput
	}
	agent, err := s.repo.GetByID(ctx, agentID)
	if err != nil {
		return nil, fmt.Errorf("get agent: %w", err)
	}
	if agent == nil || (agent.UserID != nil && *agent.UserID != userID) {
		return nil, ErrAgentNotFound
	}
	if agent.MachineID == nil || s.daemonHub == nil || !s.daemonHub.IsConnected(*agent.MachineID) {
		return nil, ErrAgentOffline
	}
	capabilities, ok := s.daemonHub.(interface{ SupportsCapability(string, string) bool })
	if !ok || !capabilities.SupportsCapability(*agent.MachineID, modelDiscoveryCapability) {
		return nil, fmt.Errorf("%w: 请更新这台电脑的 daemon 后扫描模型", ErrMsgInvalidRuntime)
	}
	payload, err := json.Marshal(map[string]string{"cli_tool": agent.CLITool})
	if err != nil {
		return nil, fmt.Errorf("marshal model request: %w", err)
	}
	// 注册任务归属，确保 task.complete 只能由目标机器返回。
	task, err := s.repo.CreateDaemonTask(ctx, userID, "", agentID, *agent.MachineID, daemonModelListTool, agent.RuntimeVariant, string(payload), "")
	if err != nil {
		return nil, fmt.Errorf("create model scan: %w", err)
	}
	ch := s.daemonHub.RegisterTaskPromise(task.ID)
	defer s.daemonHub.RemoveTaskPromise(task.ID)
	if err := s.daemonHub.SendToMachine(*agent.MachineID, ws.WSMessage{Type: "task.dispatch", Data: map[string]interface{}{
		"task_id": task.ID, "cli_tool": daemonModelListTool, "runtime_variant": agent.RuntimeVariant,
		"prompt": string(payload), "agent_id": agentID, "conversation_id": "", "user_id": userID,
	}}); err != nil {
		return nil, fmt.Errorf("send model scan: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	select {
	case result := <-ch:
		if result == nil {
			return nil, ErrMsgAgentTimeout
		}
		if result.Error != "" {
			return nil, fmt.Errorf("%w: 本地运行器扫描失败，请检查登录状态并重新扫描", ErrMsgInvalidRuntime)
		}
		var catalog RuntimeModelCatalog
		if err := json.Unmarshal([]byte(result.Result), &catalog); err != nil {
			return nil, fmt.Errorf("decode models: %w", err)
		}
		if catalog.Models == nil {
			catalog.Models = []RuntimeModelOption{}
		}
		return &catalog, nil
	case <-ctx.Done():
		return nil, ErrMsgAgentTimeout
	}
}
