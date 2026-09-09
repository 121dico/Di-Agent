package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

const agentSessionColumns = `s.id, s.conversation_id, s.agent_id,
	COALESCE(a.name, '') AS agent_name, s.cli_session_id, s.cli_tool, s.generation,
	s.lifecycle_status, s.active_context_tokens, s.context_window_tokens,
	s.total_input_tokens, s.total_output_tokens, s.usage_ratio, s.budget_status,
	s.usage_source, s.compaction_count, COALESCE(s.checkpoint_id::text, '') AS checkpoint_id,
	s.created_at, s.updated_at, s.closed_at`

type AgentSessionRepo struct {
	db *sqlx.DB
}

func NewAgentSessionRepo(db *sqlx.DB) *AgentSessionRepo {
	return &AgentSessionRepo{db: db}
}

func (r *AgentSessionRepo) EnsureActive(ctx context.Context, conversationID, agentID, cliTool string, capacity int64) (*model.AgentSession, error) {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO agent_sessions (id, conversation_id, agent_id, cli_tool, generation, context_window_tokens)
		SELECT $1, $2, $3, $4, COALESCE(MAX(generation), 0) + 1, $5
		FROM agent_sessions
		WHERE conversation_id = $2 AND agent_id = $3
		ON CONFLICT DO NOTHING`, uuid.NewString(), conversationID, agentID, cliTool, capacity)
	if err != nil {
		return nil, fmt.Errorf("ensure active agent session: %w", err)
	}
	return r.GetActive(ctx, conversationID, agentID)
}

func (r *AgentSessionRepo) GetActive(ctx context.Context, conversationID, agentID string) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.QueryRowxContext(ctx, `SELECT `+agentSessionColumns+`
		FROM agent_sessions s
		JOIN agents a ON a.id = s.agent_id
		WHERE s.conversation_id = $1 AND s.agent_id = $2 AND s.lifecycle_status = 'active'`,
		conversationID, agentID).StructScan(&session)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active agent session: %w", err)
	}
	return &session, nil
}

func (r *AgentSessionRepo) AddUsage(ctx context.Context, sessionID string, inputTokens, outputTokens int64, _ float64, _ string, source string) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.QueryRowxContext(ctx, `UPDATE agent_sessions
		SET active_context_tokens = $2,
			total_input_tokens = total_input_tokens + $2,
			total_output_tokens = total_output_tokens + $3,
			usage_ratio = COALESCE($2::double precision / NULLIF(context_window_tokens, 0), 0),
			budget_status = CASE
				WHEN context_window_tokens=0 THEN 'unknown'
				WHEN COALESCE($2::double precision / NULLIF(context_window_tokens, 0), 0) >= 0.85 THEN 'critical'
				WHEN COALESCE($2::double precision / NULLIF(context_window_tokens, 0), 0) >= 0.70 THEN 'warning'
				ELSE 'normal'
			END,
			usage_source = $4,
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, conversation_id, agent_id, '' AS agent_name, cli_session_id, cli_tool,
			generation, lifecycle_status, active_context_tokens, context_window_tokens,
			total_input_tokens, total_output_tokens, usage_ratio, budget_status,
			usage_source, compaction_count, COALESCE(checkpoint_id::text, '') AS checkpoint_id,
			created_at, updated_at, closed_at`,
		sessionID, inputTokens, outputTokens, source).StructScan(&session)
	if err != nil {
		return nil, fmt.Errorf("add agent session usage: %w", err)
	}
	return &session, nil
}

func (r *AgentSessionRepo) AttachCheckpoint(ctx context.Context, sessionID, checkpointID string) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.QueryRowxContext(ctx, `UPDATE agent_sessions
		SET checkpoint_id = NULLIF($2, '')::uuid,
			updated_at = NOW()
		WHERE id = $1 AND lifecycle_status = 'active'
		RETURNING id, conversation_id, agent_id, '' AS agent_name, cli_session_id, cli_tool,
			generation, lifecycle_status, active_context_tokens, context_window_tokens,
			total_input_tokens, total_output_tokens, usage_ratio, budget_status,
			usage_source, compaction_count, COALESCE(checkpoint_id::text, '') AS checkpoint_id,
			created_at, updated_at, closed_at`, sessionID, checkpointID).StructScan(&session)
	if err != nil {
		return nil, fmt.Errorf("attach checkpoint to agent session: %w", err)
	}
	return &session, nil
}

func (r *AgentSessionRepo) Rollover(ctx context.Context, conversationID, agentID, cliTool, checkpointID string, capacity, initialTokens int64, ratio float64, status, source string) (*model.AgentSession, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin agent session rollover: %w", err)
	}
	defer tx.Rollback()

	var generation, compactionCount int
	err = tx.QueryRowxContext(ctx, `SELECT generation, compaction_count
		FROM agent_sessions
		WHERE conversation_id = $1 AND agent_id = $2 AND lifecycle_status = 'active'
		FOR UPDATE`, conversationID, agentID).Scan(&generation, &compactionCount)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("lock active agent session: %w", err)
	}
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE agent_sessions
			SET lifecycle_status = 'rolled_over', closed_at = NOW(), updated_at = NOW()
			WHERE conversation_id = $1 AND agent_id = $2 AND lifecycle_status = 'active'`, conversationID, agentID)
		if err != nil {
			return nil, fmt.Errorf("close active agent session: %w", err)
		}
	} else {
		_ = tx.QueryRowxContext(ctx, `SELECT COALESCE(MAX(generation), 0), COALESCE(MAX(compaction_count), 0)
			FROM agent_sessions WHERE conversation_id = $1 AND agent_id = $2`, conversationID, agentID).
			Scan(&generation, &compactionCount)
	}

	var session model.AgentSession
	err = tx.QueryRowxContext(ctx, `INSERT INTO agent_sessions
		(id, conversation_id, agent_id, cli_tool, generation, active_context_tokens,
		 context_window_tokens, total_input_tokens, usage_ratio, budget_status, usage_source,
		 compaction_count, checkpoint_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $8, $9, $10, $11, NULLIF($12, '')::uuid)
		RETURNING id, conversation_id, agent_id, '' AS agent_name, cli_session_id, cli_tool,
			generation, lifecycle_status, active_context_tokens, context_window_tokens,
			total_input_tokens, total_output_tokens, usage_ratio, budget_status,
			usage_source, compaction_count, COALESCE(checkpoint_id::text, '') AS checkpoint_id,
			created_at, updated_at, closed_at`, uuid.NewString(), conversationID, agentID, cliTool,
		generation+1, initialTokens, capacity, ratio, status, source, compactionCount+1, checkpointID).
		StructScan(&session)
	if err != nil {
		return nil, fmt.Errorf("create rolled over agent session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit agent session rollover: %w", err)
	}
	return &session, nil
}

func (r *AgentSessionRepo) SetCLISessionID(ctx context.Context, conversationID, agentID, cliSessionID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_sessions SET cli_session_id = $3, updated_at = NOW()
		WHERE conversation_id = $1 AND agent_id = $2 AND lifecycle_status = 'active'`,
		conversationID, agentID, cliSessionID)
	if err != nil {
		return fmt.Errorf("set CLI session id: %w", err)
	}
	return nil
}
