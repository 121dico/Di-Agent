package model

import "time"

// ConversationFork 记录独立 Conversation 的直接父分支和稳定分叉点。
type ConversationFork struct {
	ChildConversationID  string    `json:"child_conversation_id" db:"child_conversation_id"`
	ParentConversationID string    `json:"parent_conversation_id" db:"parent_conversation_id"`
	CheckpointID         string    `json:"checkpoint_id" db:"checkpoint_id"`
	ForkedFromMessageID  string    `json:"forked_from_message_id" db:"forked_from_message_id"`
	SourceAgentID        string    `json:"source_agent_id" db:"source_agent_id"`
	TargetAgentID        string    `json:"target_agent_id" db:"target_agent_id"`
	CreatedBy            string    `json:"created_by" db:"created_by"`
	CreatedAt            time.Time `json:"created_at" db:"created_at"`
	ParentTitle          string    `json:"parent_title,omitempty" db:"parent_title"`
}

type CreateConversationForkInput struct {
	ParentConversationID string
	CheckpointID         string
	ForkedFromMessageID  string
	SourceAgentID        string
	TargetAgentID        string
	CreatedBy            string
	Title                string
	TargetCLITool        string
	ContextWindowTokens  int64
	InitialContextTokens int64
}

type ConversationForkResult struct {
	Conversation Conversation     `json:"conversation"`
	Fork         ConversationFork `json:"fork"`
	Session      AgentSession     `json:"session"`
}
