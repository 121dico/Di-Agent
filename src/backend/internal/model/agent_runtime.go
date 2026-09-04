package model

import "time"

// AgentRuntimeOverview 是 Agent Profile 展示的真实持久化运行统计。
type AgentRuntimeOverview struct {
	PeriodDays        int                     `json:"period_days" db:"-"`
	ConversationCount int64                   `json:"conversation_count" db:"conversation_count"`
	ExecutionCount    int64                   `json:"execution_count" db:"execution_count"`
	ToolCallCount     int64                   `json:"tool_call_count" db:"tool_call_count"`
	TotalTokens       int64                   `json:"total_tokens" db:"total_tokens"`
	RecentRuns        []AgentRuntimeRecentRun `json:"recent_runs" db:"-"`
}

// AgentRuntimeRecentRun 是一次真实 Agent 回复对应的最近执行摘要。
type AgentRuntimeRecentRun struct {
	ID             string    `json:"id" db:"id"`
	ConversationID string    `json:"conversation_id" db:"conversation_id"`
	Prompt         string    `json:"prompt" db:"prompt"`
	RequesterName  string    `json:"requester_name" db:"requester_name"`
	Status         string    `json:"status" db:"status"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

// AgentRuntimeConfig is the validated, per-message execution policy sent to a daemon.
// It deliberately exposes only an allowlisted product contract, never arbitrary CLI flags.
type AgentRuntimeConfig struct {
	Version         int    `json:"version"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoning_effort"`
	ApprovalMode    string `json:"approval_mode"`
	ServiceTier     string `json:"service_tier"`
}
