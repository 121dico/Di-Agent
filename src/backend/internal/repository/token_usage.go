package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// SaveNativeUsage 的 task 主键使断线补发幂等。过期快照不能覆盖新的统计。
func (r *AgentSessionRepo) SaveNativeUsage(ctx context.Context, session *model.AgentSession, taskID string, usage *model.TokenUsage) error {
	data, err := json.Marshal(usage)
	if err != nil {
		return fmt.Errorf("marshal native usage: %w", err)
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO agent_token_usage (task_id,session_id,conversation_id,agent_id,usage,observed_at)
 VALUES ($1,$2,$3,$4,$5,$6)
 ON CONFLICT (task_id) DO UPDATE SET usage=EXCLUDED.usage, observed_at=EXCLUDED.observed_at
 WHERE agent_token_usage.observed_at < EXCLUDED.observed_at
 AND NOT (agent_token_usage.usage->>'source'='actual' AND EXCLUDED.usage->>'source'='unknown')`, taskID, session.ID, session.ConversationID, session.AgentID, string(data), usage.ObservedAt)
	if err != nil {
		return fmt.Errorf("save native usage: %w", err)
	}
	return nil
}

func (r *AgentSessionRepo) ReadNativeUsage(ctx context.Context, session *model.AgentSession) error {
	var data string
	err := r.db.QueryRowxContext(ctx, `SELECT usage::text FROM agent_token_usage WHERE session_id=$1 ORDER BY observed_at DESC,created_at DESC,task_id DESC LIMIT 1`, session.ID).Scan(&data)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read native context: %w", err)
	}
	if err == nil {
		var usage model.TokenUsage
		if err := json.Unmarshal([]byte(data), &usage); err != nil {
			return fmt.Errorf("decode native context: %w", err)
		}
		if usage.Valid() {
			session.NativeUsage = &usage
		}
	}
	// 可选细分项有任意缺失就保留未知；主输入/输出展示已记录小计并带完整性标记。
	var totals model.TokenUsage
	var input, output, read, write, reasoning sql.NullInt64
	var complete sql.NullBool
	err = r.db.QueryRowxContext(ctx, `SELECT count(*) FILTER (WHERE usage->>'source'='actual'), sum((usage->>'input_tokens')::bigint),sum((usage->>'output_tokens')::bigint),
 CASE WHEN count(usage->>'cache_read_tokens')=count(*) THEN sum((usage->>'cache_read_tokens')::bigint) END,
 CASE WHEN count(usage->>'cache_write_tokens')=count(*) THEN sum((usage->>'cache_write_tokens')::bigint) END,
 CASE WHEN count(usage->>'reasoning_tokens')=count(*) THEN sum((usage->>'reasoning_tokens')::bigint) END,
 bool_and(COALESCE((usage->>'complete')::boolean,false))
 FROM agent_token_usage WHERE conversation_id=$1 AND agent_id=$2`, session.ConversationID, session.AgentID).
		Scan(&session.MeasuredTurns, &input, &output, &read, &write, &reasoning, &complete)
	if err != nil {
		return fmt.Errorf("sum native usage: %w", err)
	}
	if session.MeasuredTurns > 0 {
		toPtr := func(n sql.NullInt64) *int64 {
			if !n.Valid {
				return nil
			}
			v := n.Int64
			return &v
		}
		totals.InputTokens = toPtr(input)
		totals.OutputTokens = toPtr(output)
		totals.CacheReadTokens = toPtr(read)
		totals.CacheWriteTokens = toPtr(write)
		totals.ReasoningTokens = toPtr(reasoning)
		totals.Source = "actual"
		totals.Complete = complete.Valid && complete.Bool
		session.NativeTotals = &totals
	}
	return nil
}
