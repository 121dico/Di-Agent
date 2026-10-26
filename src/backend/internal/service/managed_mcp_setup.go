package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/port"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
)

var (
	ErrManagedMCPNotFound        = errors.New("machine_not_found")
	ErrManagedMCPInvalidResult   = errors.New("invalid_result")
	ErrManagedMCPInvalidEnvelope = errors.New("invalid_envelope")
)

type ManagedMCPEnvelope struct {
	SessionID       string `json:"session_id"`
	ClientPublicKey string `json:"client_public_key"`
	Nonce           string `json:"nonce"`
	Ciphertext      string `json:"ciphertext"`
}

func validBase64(value string, min, max int) bool {
	if len(value) > ((max+2)/3)*4 {
		return false
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(value)
	return err == nil && len(decoded) >= min && len(decoded) <= max && base64.StdEncoding.EncodeToString(decoded) == value
}

func (e *ManagedMCPEnvelope) Valid() bool {
	return e != nil && regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(e.SessionID) && validBase64(e.ClientPublicKey, 32, 32) && validBase64(e.Nonce, 24, 24) && validBase64(e.Ciphertext, 16, 12288)
}

type ManagedMCPSetupSession struct {
	ID        string `json:"id"`
	PublicKey string `json:"public_key"`
	ExpiresAt string `json:"expires_at"`
	Supported bool   `json:"supported"`
	Reason    string `json:"reason"`
}

type ManagedMCPCheck struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Code   string `json:"code"`
}

// ManagedMCPSetupStatus 是唯一允许返回浏览器的字段集合，无凭据、原始错误或本机 URL。
type ManagedMCPSetupStatus struct {
	RequestID            string                  `json:"request_id,omitempty"`
	Status               string                  `json:"status"`
	CheckedAt            string                  `json:"checked_at"`
	ConfigurationChanged bool                    `json:"configuration_changed"`
	KeyConfigured        bool                    `json:"key_configured"`
	ProjectCode          string                  `json:"project_code"`
	CredentialSource     string                  `json:"credential_source"`
	ProjectSource        string                  `json:"project_source"`
	Checks               []ManagedMCPCheck       `json:"checks"`
	Opened               bool                    `json:"opened"`
	ErrorCode            string                  `json:"error_code,omitempty"`
	SetupSession         *ManagedMCPSetupSession `json:"setup_session,omitempty"`
	Saved                bool                    `json:"saved,omitempty"`
}

type ManagedMCPSetupService struct {
	machines repository.AgentStore
	control  port.ManagedMCPControl
}

func NewManagedMCPSetupService(machines repository.AgentStore, control port.ManagedMCPControl) *ManagedMCPSetupService {
	return &ManagedMCPSetupService{machines: machines, control: control}
}

// Execute 先验证本人电脑，再调度固定本机动作；响应不持久化。
func (s *ManagedMCPSetupService) Execute(ctx context.Context, userID, machineID, action string, envelope ...*ManagedMCPEnvelope) (*ManagedMCPSetupStatus, error) {
	if userID == "" || machineID == "" {
		return nil, ErrManagedMCPNotFound
	}
	machine, err := s.machines.GetDaemonMachineByID(ctx, machineID)
	if err != nil {
		return nil, fmt.Errorf("get setup machine: %w", err)
	}
	if machine == nil || machine.UserID != userID {
		return nil, ErrManagedMCPNotFound
	}
	if !oneOf(action, "inspect", "configure", "setup_session", "save") {
		return nil, ErrAgentInvalidInput
	}
	var payload []json.RawMessage
	if action == "save" {
		if len(envelope) != 1 || !envelope[0].Valid() {
			return nil, ErrManagedMCPInvalidEnvelope
		}
		raw, _ := json.Marshal(envelope[0])
		payload = []json.RawMessage{raw}
	} else if len(envelope) != 0 {
		return nil, ErrManagedMCPInvalidEnvelope
	}
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	raw, err := s.control.RequestManagedMCP(ctx, machineID, userID, action, payload...)
	if err != nil {
		return nil, fmt.Errorf("managed MCP control: %w", err)
	}
	result, err := decodeManagedMCPStatus(raw)
	if err != nil {
		return nil, err
	}
	if (result.SetupSession != nil && action != "setup_session") || (result.Saved && action != "save") || (action == "setup_session" && result.SetupSession == nil && result.ErrorCode == "") {
		return nil, ErrManagedMCPInvalidResult
	}
	// 等待期间电脑可能已移除或被收回，返回前再次验证所有权。
	machine, err = s.machines.GetDaemonMachineByID(ctx, machineID)
	if err != nil {
		return nil, fmt.Errorf("recheck setup machine: %w", err)
	}
	if machine == nil || machine.UserID != userID {
		return nil, ErrManagedMCPNotFound
	}
	result.RequestID = ""
	return result, nil
}

func oneOf(value string, choices ...string) bool {
	for _, choice := range choices {
		if value == choice {
			return true
		}
	}
	return false
}

func decodeManagedMCPStatus(raw []byte) (*ManagedMCPSetupStatus, error) {
	if len(raw) > 8192 {
		return nil, ErrManagedMCPInvalidResult
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var result ManagedMCPSetupStatus
	if decoder.Decode(&result) != nil {
		return nil, ErrManagedMCPInvalidResult
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, ErrManagedMCPInvalidResult
	}
	// 拒绝/忙碌响应不附带本机配置，防止向未授权请求泄露个人项目。
	if result.Status == "failed" && result.CheckedAt == "" && result.ProjectCode == "" && result.CredentialSource == "" && result.ProjectSource == "" && len(result.Checks) == 0 && !result.Opened && !result.KeyConfigured && !result.ConfigurationChanged {
		switch result.ErrorCode {
		case "busy":
			return nil, port.ErrManagedMCPBusy
		case "request_denied":
			return nil, ErrManagedMCPNotFound
		case "open_failed", "configure_failed":
			result.CheckedAt = time.Now().UTC().Format(time.RFC3339Nano)
			result.CredentialSource, result.ProjectSource = "missing", "missing"
			result.Checks = []ManagedMCPCheck{}
		}
	}
	if !oneOf(result.Status, "setup_required", "configured_unverified", "connected", "failed") ||
		!oneOf(result.CredentialSource, "environment", "keychain", "file", "missing") ||
		!oneOf(result.ProjectSource, "environment", "file", "default", "missing") ||
		!oneOf(result.ErrorCode, "", "request_denied", "busy", "open_failed", "configure_failed", "session_expired", "invalid_envelope", "invalid_configuration", "environment_override", "unsupported_platform", "save_failed") {
		return nil, ErrManagedMCPInvalidResult
	}
	if result.Saved && (result.ErrorCode != "" || result.Status != "configured_unverified" || !result.ConfigurationChanged || !result.KeyConfigured || result.SetupSession != nil) {
		return nil, ErrManagedMCPInvalidResult
	}
	if session := result.SetupSession; session != nil {
		if !oneOf(session.Reason, "", "environment_override", "unsupported_platform") || result.Opened || result.Status == "connected" {
			return nil, ErrManagedMCPInvalidResult
		}
		if session.Supported {
			expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
			if session.Reason != "" || !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(session.ID) || !validBase64(session.PublicKey, 32, 32) || err != nil || expires.Before(time.Now()) || expires.After(time.Now().Add(6*time.Minute)) {
				return nil, ErrManagedMCPInvalidResult
			}
		} else if session.Reason == "" || session.ID != "" || session.PublicKey != "" || session.ExpiresAt != "" {
			return nil, ErrManagedMCPInvalidResult
		}
	}
	if len(result.ProjectCode) > 128 || (result.ProjectCode != "" && !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(result.ProjectCode)) {
		return nil, ErrManagedMCPInvalidResult
	}
	if len(result.CheckedAt) > 40 {
		return nil, ErrManagedMCPInvalidResult
	}
	if _, err := time.Parse(time.RFC3339Nano, result.CheckedAt); err != nil {
		return nil, ErrManagedMCPInvalidResult
	}
	if len(result.Checks) > 5 {
		return nil, ErrManagedMCPInvalidResult
	}
	seen := map[string]bool{}
	verified := false
	for _, check := range result.Checks {
		if seen[check.ID] || !oneOf(check.ID, "daemon", "proxy", "identity", "credential", "project") ||
			!oneOf(check.Status, "passed", "failed", "unverified") ||
			!oneOf(check.Code, "daemon_ready", "proxy_reachable", "proxy_unreachable", "identity_verified", "identity_required", "mcp_failed", "key_present", "key_missing", "project_unverified", "configuration_changed", "timeout") {
			return nil, ErrManagedMCPInvalidResult
		}
		seen[check.ID] = true
		if check.ID == "identity" && check.Status == "passed" && check.Code == "identity_verified" {
			verified = true
		}
		if check.ID == "project" && check.Status == "passed" {
			return nil, ErrManagedMCPInvalidResult
		}
	}
	if result.Status == "connected" && (!verified || !result.KeyConfigured || result.ProjectCode == "" || result.ConfigurationChanged) {
		return nil, ErrManagedMCPInvalidResult
	}
	return &result, nil
}
