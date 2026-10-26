package model

import (
	"encoding/json"
	"time"
)

const (
	PersonalReportDraft  = "draft"
	PersonalReportSaved  = "saved"
	PersonalReportFailed = "failed"
)

// PersonalReport is an owner-only report composed from an Agent conversation.
// Query, document and provenance stay structured so later renderer versions can
// evolve without changing the persistence interface.
type PersonalReport struct {
	ID             string          `json:"id" db:"id"`
	OwnerUserID    string          `json:"owner_user_id" db:"owner_user_id"`
	ConversationID *string         `json:"conversation_id,omitempty" db:"conversation_id"`
	MessageID      *string         `json:"message_id,omitempty" db:"message_id"`
	DataSourceID   *string         `json:"data_source_id,omitempty" db:"data_source_id"`
	Title          string          `json:"title" db:"title"`
	Description    string          `json:"description" db:"description"`
	Status         string          `json:"status" db:"status"`
	StylePreset    string          `json:"style_preset" db:"style_preset"`
	StylePrompt    string          `json:"style_prompt" db:"style_prompt"`
	QueryJSON      json.RawMessage `json:"query" db:"query_json"`
	DocumentJSON   json.RawMessage `json:"document" db:"document_json"`
	ProvenanceJSON json.RawMessage `json:"provenance" db:"provenance_json"`
	Revision       int             `json:"revision" db:"revision"`
	CreatedAt      time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at" db:"updated_at"`
}

// ReportAgentQueryReceipt is a bounded, owner-scoped copy of a successful
// governed query. Personal reports bind to this receipt, never to numbers
// supplied by the model in its save request.
type ReportAgentQueryReceipt struct {
	ID              string          `json:"id" db:"id"`
	OwnerUserID     string          `json:"owner_user_id" db:"owner_user_id"`
	SourceID        string          `json:"source_id" db:"source_id"`
	SourceName      string          `json:"source_name" db:"source_name"`
	RequestJSON     json.RawMessage `json:"request" db:"request_json"`
	RowsJSON        json.RawMessage `json:"rows" db:"rows_json"`
	PaginationJSON  json.RawMessage `json:"pagination" db:"pagination_json"`
	SourcePartition string          `json:"source_partition" db:"source_partition"`
	UpstreamQueryID string          `json:"upstream_query_id" db:"upstream_query_id"`
	DurationMS      int64           `json:"duration_ms" db:"duration_ms"`
	CreatedAt       time.Time       `json:"created_at" db:"created_at"`
}
