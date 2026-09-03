package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

var ErrConversationForkNotFound = errors.New("conversation fork not found")

type ConversationForkRepo struct{ db *sqlx.DB }

func NewConversationForkRepo(db *sqlx.DB) *ConversationForkRepo { return &ConversationForkRepo{db: db} }

// Create 在同一事务中创建子 Conversation、复制成员/Agent 角色、写入 lineage 和 generation 1 Session。
func (r *ConversationForkRepo) Create(ctx context.Context, in model.CreateConversationForkInput) (*model.ConversationForkResult, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin conversation fork: %w", err)
	}
	defer tx.Rollback()

	var parentTitle string
	err = tx.QueryRowxContext(ctx, `SELECT COALESCE(title, '') FROM conversations WHERE id = $1 FOR SHARE`, in.ParentConversationID).Scan(&parentTitle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrConversationForkNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read fork parent: %w", err)
	}
	title := in.Title
	if title == "" {
		title = parentTitle + " · Fork"
	}

	var conversation model.Conversation
	err = tx.QueryRowxContext(ctx, `INSERT INTO conversations
		(user_id, type, title, avatar, description, announcement, tags)
		SELECT $2, type, $3, avatar, description, announcement, tags
		FROM conversations WHERE id = $1
		RETURNING id, user_id, type, COALESCE(title, '') AS title, COALESCE(avatar, '') AS avatar,
			COALESCE(description, '') AS description, COALESCE(announcement, '') AS announcement,
			COALESCE(tags, '') AS tags, pinned, archived_at, created_at, updated_at,
			''::text AS peer_id, ''::text AS peer_name, ''::text AS last_message, 0 AS member_count`,
		in.ParentConversationID, in.CreatedBy, title).StructScan(&conversation)
	if err != nil {
		return nil, fmt.Errorf("create fork conversation: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_members
		(conversation_id, user_id, role, joined_at, last_read_at)
		SELECT $2, user_id, role, NOW(), NULL FROM conversation_members
		WHERE conversation_id = $1 AND archived_at IS NULL
		ON CONFLICT (conversation_id, user_id) DO NOTHING`, in.ParentConversationID, conversation.ID); err != nil {
		return nil, fmt.Errorf("copy fork members: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1, $2, 'owner') ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = 'owner'`, conversation.ID, in.CreatedBy); err != nil {
		return nil, fmt.Errorf("add fork creator: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_agents
		(conversation_id, agent_id, added_by, role, joined_at)
		SELECT $2, agent_id, added_by, role, NOW() FROM conversation_agents WHERE conversation_id = $1`,
		in.ParentConversationID, conversation.ID); err != nil {
		return nil, fmt.Errorf("copy fork agents: %w", err)
	}

	var fork model.ConversationFork
	err = tx.QueryRowxContext(ctx, `INSERT INTO conversation_forks
		(child_conversation_id, parent_conversation_id, checkpoint_id, forked_from_message_id,
		 source_agent_id, target_agent_id, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING child_conversation_id, parent_conversation_id, checkpoint_id, forked_from_message_id,
			source_agent_id, target_agent_id, created_by, created_at, $8::text AS parent_title`,
		conversation.ID, in.ParentConversationID, in.CheckpointID, in.ForkedFromMessageID,
		in.SourceAgentID, in.TargetAgentID, in.CreatedBy, parentTitle).StructScan(&fork)
	if err != nil {
		return nil, fmt.Errorf("insert conversation fork: %w", err)
	}

	initial := in.InitialContextTokens
	ratio := float64(initial) / float64(in.ContextWindowTokens)
	status := model.ContextBudgetNormal
	if ratio >= 0.85 {
		status = model.ContextBudgetCritical
	} else if ratio >= 0.70 {
		status = model.ContextBudgetWarning
	}
	var session model.AgentSession
	err = tx.QueryRowxContext(ctx, `INSERT INTO agent_sessions
		(id, conversation_id, agent_id, cli_tool, generation, active_context_tokens,
		 context_window_tokens, total_input_tokens, usage_ratio, budget_status, usage_source, checkpoint_id)
		VALUES ($1,$2,$3,$4,1,$5,$6,$5,$7,$8,'estimated',$9)
		RETURNING id, conversation_id, agent_id, '' AS agent_name, cli_session_id, cli_tool, generation,
			lifecycle_status, active_context_tokens, context_window_tokens, total_input_tokens,
			total_output_tokens, usage_ratio, budget_status, usage_source, compaction_count,
			COALESCE(checkpoint_id::text, '') AS checkpoint_id, created_at, updated_at, closed_at`,
		uuid.NewString(), conversation.ID, in.TargetAgentID, in.TargetCLITool, initial,
		in.ContextWindowTokens, ratio, status, in.CheckpointID).StructScan(&session)
	if err != nil {
		return nil, fmt.Errorf("create fork agent session: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit conversation fork: %w", err)
	}
	return &model.ConversationForkResult{Conversation: conversation, Fork: fork, Session: session}, nil
}

func (r *ConversationForkRepo) GetByChild(ctx context.Context, childID, userID string) (*model.ConversationFork, error) {
	var fork model.ConversationFork
	err := r.db.QueryRowxContext(ctx, `SELECT f.child_conversation_id, f.parent_conversation_id,
		f.checkpoint_id, f.forked_from_message_id, f.source_agent_id, f.target_agent_id,
		f.created_by, f.created_at, COALESCE(parent.title, '') AS parent_title
		FROM conversation_forks f
		JOIN conversations child ON child.id = f.child_conversation_id
		JOIN conversations parent ON parent.id = f.parent_conversation_id
		WHERE f.child_conversation_id = $1 AND (child.user_id = $2 OR EXISTS (
			SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = child.id AND cm.user_id = $2))`, childID, userID).StructScan(&fork)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation fork: %w", err)
	}
	return &fork, nil
}
