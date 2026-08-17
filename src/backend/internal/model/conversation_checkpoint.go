package model

import (
	"encoding/json"
	"time"
)

const (
	CheckpointScopePrivateAgent       = "private_agent"
	CheckpointScopeTaskShared         = "task_shared"
	CheckpointScopeConversationShared = "conversation_shared"
	CheckpointScopeOrchestratorOnly   = "orchestrator_only"

	CheckpointStatusGenerating     = "generating"
	CheckpointStatusReady          = "ready"
	CheckpointStatusFailedFallback = "failed_fallback"
	CheckpointStatusDeleted        = "deleted"
)

// CheckpointSummary 是续接时使用的结构化工作状态，不包含模型私有思维过程。
type CheckpointSummary struct {
	Objective     string   `json:"objective"`
	CompletedWork []string `json:"completed_work"`
	CurrentState  string   `json:"current_state"`
	Decisions     []string `json:"decisions"`
	Constraints   []string `json:"constraints"`
	RemainingWork []string `json:"remaining_work"`
	ChangedFiles  []string `json:"changed_files"`
	TestStatus    []string `json:"test_status"`
	ArtifactRefs  []string `json:"artifact_refs"`
	OpenQuestions []string `json:"open_questions"`
}

// ConversationCheckpoint 引用稳定的原始消息范围，并携带可跨 Session 使用的压缩结果。
type ConversationCheckpoint struct {
	ID                  string            `json:"id" db:"id"`
	ConversationID      string            `json:"conversation_id" db:"conversation_id"`
	SourceAgentID       string            `json:"source_agent_id" db:"source_agent_id"`
	SourceAgentName     string            `json:"source_agent_name,omitempty" db:"-"`
	SourceSessionID     *string           `json:"source_session_id,omitempty" db:"source_session_id"`
	TaskID              *string           `json:"task_id,omitempty" db:"task_id"`
	Version             int               `json:"version" db:"version"`
	Generation          int               `json:"generation" db:"generation"`
	SourceFromMessageID string            `json:"source_from_message_id" db:"source_from_message_id"`
	SourceToMessageID   string            `json:"source_to_message_id" db:"source_to_message_id"`
	SourceMessageCount  int               `json:"source_message_count" db:"source_message_count"`
	SummaryJSON         json.RawMessage   `json:"-" db:"summary_json"`
	Summary             CheckpointSummary `json:"summary_json" db:"-"`
	Markdown            string            `json:"markdown_content" db:"markdown"`
	TokensBefore        int64             `json:"tokens_before" db:"tokens_before"`
	TokensAfter         int64             `json:"tokens_after" db:"tokens_after"`
	Scope               string            `json:"scope" db:"scope"`
	Status              string            `json:"status" db:"status"`
	ErrorMessage        string            `json:"error_message,omitempty" db:"error_message"`
	CreatedBy           string            `json:"created_by" db:"created_by"`
	CreatedAt           time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time         `json:"updated_at" db:"updated_at"`
}

// CreateCheckpointInput 是服务层创建契约，边界消息为空时使用当前最新消息。
type CreateCheckpointInput struct {
	ConversationID    string
	SourceAgentID     string
	SourceSessionID   string
	TaskID            string
	SourceToMessageID string
	Generation        int
	TokensBefore      int64
	Scope             string
	CreatedBy         string
}

// ContinueFromCheckpointInput 为后续 Session 服务预留，不绑定具体运行时实现。
type ContinueFromCheckpointInput struct {
	ConversationID string `json:"conversation_id"`
	CheckpointID   string `json:"checkpoint_id"`
	TargetAgentID  string `json:"target_agent_id"`
	Mode           string `json:"mode"`
}

// CheckpointContinuation 是校验通过后交给 Session 服务的稳定续接载荷。
type CheckpointContinuation struct {
	Checkpoint    ConversationCheckpoint `json:"checkpoint"`
	TargetAgentID string                 `json:"target_agent_id"`
	FreshSession  bool                   `json:"fresh_session"`
}
