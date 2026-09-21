package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// ResolvePageAgentChat 保留页面会话 ID，仅替换当前执行者；普通 Agent 私聊不受影响。
func (r *ConversationRepo) ResolvePageAgentChat(ctx context.Context, userID, agentID, workspace, title string, selectAgent bool) (*model.Conversation, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin page conversation: %w", err)
	}
	defer tx.Rollback()
	marker := "page-agent:" + workspace
	// 跨标签页初始化和切换串行，避免一个页面生成多个专属会话。
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userID+":"+marker); err != nil {
		return nil, fmt.Errorf("lock page conversation: %w", err)
	}
	var accessible bool
	if err = tx.GetContext(ctx, &accessible, `SELECT EXISTS(SELECT 1 FROM agents WHERE id=$1 AND (user_id=$2 OR user_id IS NULL) AND machine_id IS NOT NULL)`, agentID, userID); err != nil {
		return nil, fmt.Errorf("check page agent: %w", err)
	}
	if !accessible {
		return nil, nil
	}
	var id string
	err = tx.GetContext(ctx, &id, `SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.type='agent' AND c.archived_at IS NULL
 AND (c.tags=$2 OR (COALESCE(c.tags,'')='' AND c.title=$3 AND EXISTS(SELECT 1 FROM conversation_agents ca WHERE ca.conversation_id=c.id AND ca.agent_id=$4)))
 ORDER BY (c.tags=$2) DESC NULLS LAST, c.updated_at DESC LIMIT 1 FOR UPDATE`, userID, marker, title, agentID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("find page conversation: %w", err)
	}
	created := errors.Is(err, sql.ErrNoRows)
	if created {
		if err = tx.GetContext(ctx, &id, `INSERT INTO conversations(user_id,type,title,tags) VALUES($1,'agent',$2,$3) RETURNING id`, userID, title, marker); err != nil {
			return nil, fmt.Errorf("create page conversation: %w", err)
		}
	}
	var hasAgent bool
	if !created {
		if err = tx.GetContext(ctx, &hasAgent, `SELECT EXISTS(SELECT 1 FROM conversation_agents ca JOIN agents a ON a.id=ca.agent_id WHERE ca.conversation_id=$1 AND (a.user_id=$2 OR a.user_id IS NULL) AND a.machine_id IS NOT NULL)`, id, userID); err != nil {
			return nil, fmt.Errorf("check current page agent: %w", err)
		}
	}
	// 已选 Agent 被删除后，沿用历史并恢复一个可用执行者。
	if created || selectAgent || !hasAgent {
		if _, err = tx.ExecContext(ctx, `DELETE FROM conversation_agents WHERE conversation_id=$1`, id); err != nil {
			return nil, fmt.Errorf("replace page agent: %w", err)
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_agents(conversation_id,agent_id,added_by) VALUES($1,$2,$3)`, id, agentID, userID); err != nil {
			return nil, fmt.Errorf("bind page agent: %w", err)
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE conversations SET tags=$2 WHERE id=$1`, id, marker); err != nil {
		return nil, fmt.Errorf("mark page conversation: %w", err)
	}
	var conversation model.Conversation
	err = tx.GetContext(ctx, &conversation, `SELECT c.id,c.user_id,c.type,c.title,c.pinned,c.created_at,c.updated_at,a.id::text AS peer_id,a.name AS peer_name
 FROM conversations c JOIN conversation_agents ca ON ca.conversation_id=c.id JOIN agents a ON a.id=ca.agent_id WHERE c.id=$1`, id)
	if err != nil {
		return nil, fmt.Errorf("read page conversation: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit page conversation: %w", err)
	}
	return &conversation, nil
}
