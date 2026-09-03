package model

import "time"

// AgentCandidate 表示 daemon 在某台电脑上检测到但尚未添加的 Agent。
type AgentCandidate struct {
	ID               string     `json:"id" db:"id"`
	MachineID        string     `json:"machine_id" db:"machine_id"`
	MachineName      string     `json:"machine_name" db:"machine_name"`
	Name             string     `json:"name" db:"name"`
	CLITool          string     `json:"cli_tool" db:"cli_tool"`
	Variant          string     `json:"variant" db:"variant"` // cli | desktop（底座类型）
	Version          string     `json:"version,omitempty" db:"version"`
	CapabilitiesJSON string     `json:"capabilities_json,omitempty" db:"capabilities_json"`
	LastSeenAt       *time.Time `json:"last_seen_at,omitempty" db:"last_seen_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
}

// AgentCandidateRuntime identifies one independently runnable product/runtime
// reported by a daemon scan. It intentionally excludes the candidate row ID:
// every scan is a fresh machine-scoped snapshot keyed by CLI tool + variant.
type AgentCandidateRuntime struct {
	CLITool string
	Variant string
}
