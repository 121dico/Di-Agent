package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

var ErrConversationCheckpointNotFound = errors.New("conversation checkpoint not found")

const checkpointColumns = `id, conversation_id, source_agent_id, source_session_id,
	task_id, version, generation, source_from_message_id, source_to_message_id,
	source_message_count, summary_json, markdown, tokens_before, tokens_after,
	scope, status, error_message, created_by, created_at, updated_at`

// ConversationCheckpointRepo 管理检查点及其稳定消息范围。
type ConversationCheckpointRepo struct {
	db *sqlx.DB
}

func NewConversationCheckpointRepo(db *sqlx.DB) *ConversationCheckpointRepo {
	return &ConversationCheckpointRepo{db: db}
}

func (r *ConversationCheckpointRepo) ListSourceMessages(ctx context.Context, conversationID, toMessageID string) ([]model.Message, error) {
	query := `SELECT id, conversation_id, role, content,
		COALESCE(artifacts_json, '') AS artifacts_json, created_at, sender_id
		FROM messages
		WHERE conversation_id = $1 AND deleted_at IS NULL
		  AND COALESCE(NULLIF(status, ''), 'complete') <> 'streaming'`
	args := []any{conversationID}
	if toMessageID != "" {
		query += ` AND (created_at, id) <= (
			SELECT created_at, id FROM messages WHERE id = $2 AND conversation_id = $1
		)`
		args = append(args, toMessageID)
	}
	query += ` ORDER BY created_at ASC, id ASC`

	var messages []model.Message
	if err := r.db.SelectContext(ctx, &messages, query, args...); err != nil {
		return nil, fmt.Errorf("list checkpoint source messages: %w", err)
	}
	return messages, nil
}

func (r *ConversationCheckpointRepo) Create(ctx context.Context, checkpoint *model.ConversationCheckpoint) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin checkpoint create: %w", err)
	}
	defer tx.Rollback()

	// 同一会话并发创建时串行分配可读版本号。
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, checkpoint.ConversationID); err != nil {
		return fmt.Errorf("lock checkpoint version: %w", err)
	}
	checkpoint.ID = uuid.NewString()
	err = tx.QueryRowxContext(ctx,
		`INSERT INTO conversation_checkpoints (
			id, conversation_id, source_agent_id, source_session_id, task_id,
			version, generation, source_from_message_id, source_to_message_id,
			source_message_count, summary_json, markdown, tokens_before, tokens_after,
			scope, status, error_message, created_by
		) VALUES (
			$1, $2, $3, NULLIF($4, ''), NULLIF($5, '')::uuid,
			(SELECT COALESCE(MAX(version), 0) + 1 FROM conversation_checkpoints WHERE conversation_id = $2),
			$6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '', $16
		) RETURNING `+checkpointColumns,
		checkpoint.ID, checkpoint.ConversationID, checkpoint.SourceAgentID,
		valueOrEmpty(checkpoint.SourceSessionID), valueOrEmpty(checkpoint.TaskID),
		checkpoint.Generation, checkpoint.SourceFromMessageID, checkpoint.SourceToMessageID,
		checkpoint.SourceMessageCount, checkpoint.SummaryJSON, checkpoint.Markdown,
		checkpoint.TokensBefore, checkpoint.TokensAfter, checkpoint.Scope,
		checkpoint.Status, checkpoint.CreatedBy,
	).StructScan(checkpoint)
	if err != nil {
		return fmt.Errorf("insert conversation checkpoint: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit checkpoint create: %w", err)
	}
	return hydrateCheckpoint(checkpoint)
}

func (r *ConversationCheckpointRepo) UpdateSummary(ctx context.Context, id string, summary model.CheckpointSummary, markdown, status, errorMessage string, tokensAfter int64) (*model.ConversationCheckpoint, error) {
	raw, err := json.Marshal(summary)
	if err != nil {
		return nil, fmt.Errorf("marshal checkpoint summary: %w", err)
	}
	var checkpoint model.ConversationCheckpoint
	err = r.db.QueryRowxContext(ctx,
		`UPDATE conversation_checkpoints
		 SET summary_json = $2, markdown = $3, status = $4, error_message = $5,
		     tokens_after = $6, updated_at = NOW()
		 WHERE id = $1 AND deleted_at IS NULL
		 RETURNING `+checkpointColumns,
		id, raw, markdown, status, errorMessage, tokensAfter,
	).StructScan(&checkpoint)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrConversationCheckpointNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("update checkpoint summary: %w", err)
	}
	return &checkpoint, hydrateCheckpoint(&checkpoint)
}

func (r *ConversationCheckpointRepo) GetByID(ctx context.Context, id string) (*model.ConversationCheckpoint, error) {
	var checkpoint model.ConversationCheckpoint
	err := r.db.QueryRowxContext(ctx,
		`SELECT `+checkpointColumns+` FROM conversation_checkpoints
		 WHERE id = $1 AND deleted_at IS NULL`, id,
	).StructScan(&checkpoint)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrConversationCheckpointNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation checkpoint: %w", err)
	}
	return &checkpoint, hydrateCheckpoint(&checkpoint)
}

func (r *ConversationCheckpointRepo) ListByConversation(ctx context.Context, conversationID, userID string, limit int) ([]model.ConversationCheckpoint, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var checkpoints []model.ConversationCheckpoint
	err := r.db.SelectContext(ctx, &checkpoints,
		`SELECT `+checkpointColumns+` FROM conversation_checkpoints
		 WHERE conversation_id = $1 AND deleted_at IS NULL
		   AND (scope IN ('conversation_shared', 'task_shared') OR created_by = $2)
		 ORDER BY version DESC LIMIT $3`,
		conversationID, userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list conversation checkpoints: %w", err)
	}
	for i := range checkpoints {
		if err := hydrateCheckpoint(&checkpoints[i]); err != nil {
			return nil, err
		}
	}
	return checkpoints, nil
}

func (r *ConversationCheckpointRepo) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE conversation_checkpoints SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
		 WHERE id = $1 AND deleted_at IS NULL`, id,
	)
	if err != nil {
		return fmt.Errorf("delete conversation checkpoint: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return ErrConversationCheckpointNotFound
	}
	return nil
}

func hydrateCheckpoint(checkpoint *model.ConversationCheckpoint) error {
	if len(checkpoint.SummaryJSON) == 0 {
		return nil
	}
	if err := json.Unmarshal(checkpoint.SummaryJSON, &checkpoint.Summary); err != nil {
		return fmt.Errorf("decode checkpoint summary: %w", err)
	}
	return nil
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
