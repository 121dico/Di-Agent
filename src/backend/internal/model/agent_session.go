package model

import "time"

const (
	AgentSessionActive     = "active"
	AgentSessionRolledOver = "rolled_over"

	ContextBudgetNormal   = "normal"
	ContextBudgetWarning  = "warning"
	ContextBudgetCritical = "critical"

	ContextUsageEstimated = "estimated"
	ContextUsageActual    = "actual"
)

// AgentSession is the durable context budget ledger for one CLI session generation.
type AgentSession struct {
	NativeUsage              *TokenUsage `json:"native_usage,omitempty" db:"-"`
	NativeTotals             *TokenUsage `json:"native_totals,omitempty" db:"-"`
	MeasuredTurns            int64       `json:"measured_turns" db:"-"`
	EstimatedSubmittedTokens int64       `json:"estimated_submitted_tokens,omitempty" db:"-"`
	ID                       string      `json:"id" db:"id"`
	ConversationID           string      `json:"conversation_id" db:"conversation_id"`
	AgentID                  string      `json:"agent_id" db:"agent_id"`
	AgentName                string      `json:"agent_name,omitempty" db:"agent_name"`
	CLISessionID             string      `json:"session_id,omitempty" db:"cli_session_id"`
	CLITool                  string      `json:"cli_tool,omitempty" db:"cli_tool"`
	Generation               int         `json:"generation" db:"generation"`
	LifecycleStatus          string      `json:"-" db:"lifecycle_status"`
	ActiveContextTokens      int64       `json:"active_context_tokens" db:"active_context_tokens"`
	ContextWindowTokens      int64       `json:"context_window_tokens" db:"context_window_tokens"`
	TotalInputTokens         int64       `json:"total_input_tokens" db:"total_input_tokens"`
	TotalOutputTokens        int64       `json:"total_output_tokens" db:"total_output_tokens"`
	UsageRatio               float64     `json:"usage_ratio" db:"usage_ratio"`
	Status                   string      `json:"status" db:"budget_status"`
	Source                   string      `json:"source" db:"usage_source"`
	CompactionCount          int         `json:"compaction_count" db:"compaction_count"`
	CheckpointID             string      `json:"checkpoint_id,omitempty" db:"checkpoint_id"`
	CreatedAt                time.Time   `json:"created_at" db:"created_at"`
	UpdatedAt                time.Time   `json:"updated_at" db:"updated_at"`
	ClosedAt                 *time.Time  `json:"-" db:"closed_at"`
}
