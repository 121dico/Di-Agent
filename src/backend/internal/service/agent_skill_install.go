package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	"github.com/google/uuid"
)

type GitHubSkillInstallRequest struct {
	SourceURL string `json:"source_url"`
	Ref       string `json:"ref,omitempty"`
	Subpath   string `json:"subpath,omitempty"`
}

type InstalledGitHubSkill struct {
	Name          string `json:"name"`
	InstalledPath string `json:"installed_path"`
}

func validateGitHubSkillInstallRequest(req GitHubSkillInstallRequest) (GitHubSkillInstallRequest, error) {
	req.SourceURL = strings.TrimSpace(req.SourceURL)
	req.Ref = strings.TrimSpace(req.Ref)
	req.Subpath = strings.Trim(strings.TrimSpace(req.Subpath), "/")
	parsed, err := url.Parse(req.SourceURL)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "github.com") {
		return GitHubSkillInstallRequest{}, ErrAgentInvalidInput
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || strings.TrimSuffix(parts[1], ".git") == "" {
		return GitHubSkillInstallRequest{}, ErrAgentInvalidInput
	}
	if strings.Contains(req.Ref, "..") || strings.Contains(req.Subpath, "..") || strings.Contains(req.Subpath, "\\") {
		return GitHubSkillInstallRequest{}, ErrAgentInvalidInput
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = "/" + parts[0] + "/" + strings.TrimSuffix(parts[1], ".git")
	req.SourceURL = parsed.String()
	return req, nil
}

// InstallGitHubSkill asks the authenticated user's connected machine to install
// one public GitHub Skill. The daemon performs validation and an atomic rename;
// this service only dispatches after ownership and source checks pass.
func (s *AgentService) InstallGitHubSkill(ctx context.Context, userID, agentID string, req GitHubSkillInstallRequest) (*InstalledGitHubSkill, error) {
	if userID == "" || agentID == "" {
		return nil, ErrAgentInvalidInput
	}
	validated, err := validateGitHubSkillInstallRequest(req)
	if err != nil {
		return nil, err
	}
	agent, err := s.repo.GetByID(ctx, agentID)
	if err != nil {
		return nil, fmt.Errorf("get agent: %w", err)
	}
	if agent == nil || agent.MachineID == nil || *agent.MachineID == "" {
		return nil, ErrAgentNotFound
	}
	machine, err := s.repo.GetDaemonMachineByID(ctx, *agent.MachineID)
	if err != nil {
		return nil, fmt.Errorf("get daemon machine: %w", err)
	}
	if machine == nil || machine.UserID != userID {
		return nil, ErrAgentNotFound
	}
	if s.daemonHub == nil || !s.daemonHub.IsConnected(machine.ID) {
		return nil, ErrAgentOffline
	}
	payload, err := json.Marshal(map[string]string{
		"source_url": validated.SourceURL,
		"ref":        validated.Ref,
		"subpath":    validated.Subpath,
		"cli_tool":   agent.CLITool,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal skill install payload: %w", err)
	}
	taskID := uuid.NewString()
	resultCh := s.daemonHub.RegisterTaskPromise(taskID)
	defer s.daemonHub.RemoveTaskPromise(taskID)
	if err := s.daemonHub.SendToMachine(machine.ID, ws.WSMessage{
		Type: "task.dispatch",
		Data: map[string]interface{}{
			"task_id":         taskID,
			"cli_tool":        daemonInstallSkillTool,
			"runtime_variant": agent.RuntimeVariant,
			"prompt":          string(payload),
			"agent_id":        agentID,
			"conversation_id": "",
		},
	}); err != nil {
		return nil, fmt.Errorf("send skill install task: %w", err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	select {
	case result := <-resultCh:
		if result == nil || result.Error != "" {
			if result != nil && result.Error != "" {
				return nil, fmt.Errorf("install skill: %s", result.Error)
			}
			return nil, fmt.Errorf("install skill failed")
		}
		var installed InstalledGitHubSkill
		if err := json.Unmarshal([]byte(result.Result), &installed); err != nil {
			return nil, fmt.Errorf("decode installed skill: %w", err)
		}
		if installed.Name == "" {
			return nil, fmt.Errorf("decode installed skill: missing name")
		}
		return &installed, nil
	case <-waitCtx.Done():
		return nil, ErrMsgAgentTimeout
	}
}
