package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/agent-hub/backend/internal/model"
	"github.com/jmoiron/sqlx"
)

// AgentRuntimeRepo 从持久化消息和 Session 账本聚合真实 Agent 运行统计。
type AgentRuntimeRepo struct {
	db *sqlx.DB
}

func NewAgentRuntimeRepo(db *sqlx.DB) *AgentRuntimeRepo {
	return &AgentRuntimeRepo{db: db}
}

func (r *AgentRuntimeRepo) GetRuntimeOverview(
	ctx context.Context,
	userID, agentID string,
	since time.Time,
	recentLimit int,
) (*model.AgentRuntimeOverview, error) {
	var accessible bool
	if err := r.db.GetContext(ctx, &accessible,
		`SELECT EXISTS (
			SELECT 1 FROM agents
			WHERE id = $2 AND (user_id IS NULL OR user_id = $1)
		)`,
		userID, agentID,
	); err != nil {
		return nil, fmt.Errorf("check agent runtime access: %w", err)
	}
	if !accessible {
		return nil, nil
	}

	overview := &model.AgentRuntimeOverview{}
	if err := r.db.GetContext(ctx, overview,
		`WITH agent_messages AS (
			SELECT m.conversation_id, m.blocks_json
			FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			WHERE m.role = 'assistant'
			  AND m.deleted_at IS NULL
			  AND m.created_at >= $2
			  AND (
				c.user_id::text = $3
				OR EXISTS (
					SELECT 1 FROM conversation_members cm
					WHERE cm.conversation_id = c.id AND cm.user_id::text = $3
				)
			  )
			  AND (
				m.sender_id::text = $1
				OR COALESCE(NULLIF(m.artifacts_json, ''), '{}')::jsonb ->> 'agent_id' = $1
			  )
		)
		SELECT
			COUNT(DISTINCT conversation_id) AS conversation_count,
			COUNT(*) AS execution_count,
			COALESCE(SUM(regexp_count(COALESCE(blocks_json, ''), '"kind"[[:space:]]*:[[:space:]]*"tool_use"')), 0) AS tool_call_count,
			COALESCE((
				SELECT SUM(total_input_tokens + total_output_tokens)
				FROM agent_sessions sessions
				JOIN conversations session_conversation ON session_conversation.id = sessions.conversation_id
				WHERE sessions.agent_id::text = $1 AND sessions.updated_at >= $2
				  AND (
					session_conversation.user_id::text = $3
					OR EXISTS (
						SELECT 1 FROM conversation_members cm
						WHERE cm.conversation_id = session_conversation.id AND cm.user_id::text = $3
					)
				  )
			), 0) AS total_tokens
		FROM agent_messages`,
		agentID, since, userID,
	); err != nil {
		return nil, fmt.Errorf("aggregate agent runtime overview: %w", err)
	}

	overview.RecentRuns = make([]model.AgentRuntimeRecentRun, 0)
	if err := r.db.SelectContext(ctx, &overview.RecentRuns,
		`SELECT
			m.id,
			m.conversation_id,
			COALESCE(NULLIF(previous.content, ''), NULLIF(m.content, ''), '无文本内容') AS prompt,
			COALESCE(NULLIF(requester.username, ''), '用户') AS requester_name,
			COALESCE(NULLIF(m.status, ''), 'complete') AS status,
			m.created_at
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		LEFT JOIN LATERAL (
			SELECT p.content, p.sender_id
			FROM messages p
			WHERE p.conversation_id = m.conversation_id
			  AND p.role = 'user'
			  AND p.deleted_at IS NULL
			  AND p.created_at <= m.created_at
			ORDER BY p.created_at DESC
			LIMIT 1
		) previous ON true
		LEFT JOIN users requester ON requester.id = previous.sender_id
		WHERE m.role = 'assistant'
		  AND m.deleted_at IS NULL
		  AND m.created_at >= $2
		  AND (
			c.user_id::text = $3
			OR EXISTS (
				SELECT 1 FROM conversation_members cm
				WHERE cm.conversation_id = c.id AND cm.user_id::text = $3
			)
		  )
		  AND (
			m.sender_id::text = $1
			OR COALESCE(NULLIF(m.artifacts_json, ''), '{}')::jsonb ->> 'agent_id' = $1
		  )
		ORDER BY m.created_at DESC
		LIMIT $4`,
		agentID, since, userID, recentLimit,
	); err != nil {
		return nil, fmt.Errorf("list recent agent runs: %w", err)
	}
	return overview, nil
}
