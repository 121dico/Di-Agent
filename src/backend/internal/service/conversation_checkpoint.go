package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agent-hub/backend/internal/model"
)

var (
	ErrCheckpointInvalid    = errors.New("检查点参数不合法")
	ErrCheckpointNotFound   = errors.New("检查点不存在")
	ErrCheckpointNoPerm     = errors.New("无权访问此检查点")
	ErrCheckpointNoMessages = errors.New("当前范围内没有可用于检查点的消息")
	ErrCheckpointAgentBound = errors.New("Agent 未绑定到当前会话")
	ErrCheckpointScope      = errors.New("检查点作用域不允许此操作")
)

type ConversationCheckpointStore interface {
	ListSourceMessages(ctx context.Context, conversationID, toMessageID string) ([]model.Message, error)
	Create(ctx context.Context, checkpoint *model.ConversationCheckpoint) error
	UpdateSummary(ctx context.Context, id string, summary model.CheckpointSummary, markdown, status, errorMessage string, tokensAfter int64) (*model.ConversationCheckpoint, error)
	GetByID(ctx context.Context, id string) (*model.ConversationCheckpoint, error)
	ListByConversation(ctx context.Context, conversationID, userID string, limit int) ([]model.ConversationCheckpoint, error)
	Delete(ctx context.Context, id string) error
}

type CheckpointConversationStore interface {
	GetByID(ctx context.Context, id string) (*model.Conversation, error)
	GetMember(ctx context.Context, conversationID, userID string) (*model.ConversationMember, error)
}

type CheckpointAgentStore interface {
	IsAgentInConversation(ctx context.Context, conversationID, agentID, userID string) (bool, error)
}

// CheckpointSummaryRequest 由选中的 Agent 消费，生成器可自行分批处理长消息范围。
type CheckpointSummaryRequest struct {
	ConversationID string
	UserID         string
	AgentID        string
	Messages       []model.Message
	Fallback       model.CheckpointSummary
}

type CheckpointSummaryGenerator interface {
	GenerateCheckpointSummary(ctx context.Context, request CheckpointSummaryRequest) (model.CheckpointSummary, error)
}

type CheckpointSessionSource interface {
	GetActiveUsage(ctx context.Context, conversationID, agentID string) (*model.AgentSession, error)
}

type CheckpointNotifier interface {
	CheckpointChanged(ctx context.Context, checkpoint model.ConversationCheckpoint) error
}

// ConversationCheckpointService 先持久化可用兜底，再异步使用 Agent 精炼摘要。
type ConversationCheckpointService struct {
	repo      ConversationCheckpointStore
	convRepo  CheckpointConversationStore
	agentRepo CheckpointAgentStore
	generator CheckpointSummaryGenerator
	notifier  CheckpointNotifier
	sessions  CheckpointSessionSource
}

func NewConversationCheckpointService(repo ConversationCheckpointStore, convRepo CheckpointConversationStore, agentRepo CheckpointAgentStore, generator CheckpointSummaryGenerator) *ConversationCheckpointService {
	return &ConversationCheckpointService{repo: repo, convRepo: convRepo, agentRepo: agentRepo, generator: generator}
}

func (s *ConversationCheckpointService) SetNotifier(notifier CheckpointNotifier) {
	s.notifier = notifier
}

func (s *ConversationCheckpointService) SetSessionSource(sessions CheckpointSessionSource) {
	s.sessions = sessions
}

func (s *ConversationCheckpointService) Create(ctx context.Context, input model.CreateCheckpointInput) (*model.ConversationCheckpoint, error) {
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.SourceAgentID = strings.TrimSpace(input.SourceAgentID)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	if input.ConversationID == "" || input.SourceAgentID == "" || input.CreatedBy == "" || input.TokensBefore < 0 {
		return nil, ErrCheckpointInvalid
	}
	if input.Scope == "" {
		input.Scope = model.CheckpointScopeConversationShared
	}
	if !validCheckpointScope(input.Scope) {
		return nil, ErrCheckpointInvalid
	}
	if input.Generation <= 0 {
		input.Generation = 1
	}
	if _, err := s.requireMember(ctx, input.ConversationID, input.CreatedBy); err != nil {
		return nil, err
	}
	bound, err := s.agentRepo.IsAgentInConversation(ctx, input.ConversationID, input.SourceAgentID, input.CreatedBy)
	if err != nil {
		return nil, fmt.Errorf("check checkpoint agent binding: %w", err)
	}
	if !bound {
		return nil, ErrCheckpointAgentBound
	}
	hasSourceSession := false
	if s.sessions != nil {
		session, err := s.sessions.GetActiveUsage(ctx, input.ConversationID, input.SourceAgentID)
		if err != nil {
			return nil, fmt.Errorf("load checkpoint source session: %w", err)
		}
		if session != nil {
			hasSourceSession = true
			if input.SourceSessionID == "" {
				input.SourceSessionID = session.CLISessionID
			}
			if input.Generation <= 1 {
				input.Generation = session.Generation
			}
			if input.TokensBefore == 0 {
				input.TokensBefore = session.ActiveContextTokens
			}
		}
	}

	messages, err := s.repo.ListSourceMessages(ctx, input.ConversationID, input.SourceToMessageID)
	if err != nil {
		return nil, fmt.Errorf("load checkpoint messages: %w", err)
	}
	if len(messages) == 0 {
		return nil, ErrCheckpointNoMessages
	}
	fallback := buildFallbackCheckpointSummary(messages)
	markdown := renderCheckpointMarkdown(fallback)
	raw, err := json.Marshal(fallback)
	if err != nil {
		return nil, fmt.Errorf("marshal fallback checkpoint: %w", err)
	}
	if input.TokensBefore == 0 && !hasSourceSession {
		input.TokensBefore = estimateMessagesTokens(messages)
	}
	checkpoint := &model.ConversationCheckpoint{
		ConversationID: input.ConversationID, SourceAgentID: input.SourceAgentID,
		SourceSessionID: stringPointer(input.SourceSessionID), TaskID: stringPointer(input.TaskID),
		Generation: input.Generation, SourceFromMessageID: messages[0].ID,
		SourceToMessageID: messages[len(messages)-1].ID, SourceMessageCount: len(messages),
		SummaryJSON: raw, Summary: fallback, Markdown: markdown,
		TokensBefore: input.TokensBefore, TokensAfter: estimateCheckpointTokens(markdown),
		Scope: input.Scope, Status: model.CheckpointStatusGenerating, CreatedBy: input.CreatedBy,
	}
	if err := s.repo.Create(ctx, checkpoint); err != nil {
		return nil, fmt.Errorf("create conversation checkpoint: %w", err)
	}
	go s.notify(*checkpoint)
	snapshot := append([]model.Message(nil), messages...)
	go s.refine(checkpoint.ID, input.ConversationID, input.CreatedBy, input.SourceAgentID, snapshot, fallback)
	return checkpoint, nil
}

func (s *ConversationCheckpointService) refine(id, conversationID, userID, agentID string, messages []model.Message, fallback model.CheckpointSummary) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	status := model.CheckpointStatusReady
	summary := fallback
	errorMessage := ""
	if s.generator == nil {
		status = model.CheckpointStatusFailedFallback
		errorMessage = "Agent 摘要生成器未配置，已保留规则摘要"
	} else {
		generated, err := s.generator.GenerateCheckpointSummary(ctx, CheckpointSummaryRequest{
			ConversationID: conversationID, UserID: userID, AgentID: agentID, Messages: messages, Fallback: fallback,
		})
		if err != nil || !checkpointSummaryUsable(generated) {
			status = model.CheckpointStatusFailedFallback
			if err != nil {
				errorMessage = truncateCheckpointText(err.Error(), 500)
			} else {
				errorMessage = "Agent 返回的摘要不可用，已保留规则摘要"
			}
		} else {
			summary = generated
		}
	}
	markdown := renderCheckpointMarkdown(summary)
	updated, err := s.repo.UpdateSummary(ctx, id, summary, markdown, status, errorMessage, estimateCheckpointTokens(markdown))
	if err != nil {
		slog.Warn("checkpoint refine persist failed", "checkpoint_id", id, "error", err)
		return
	}
	s.notify(*updated)
}

func (s *ConversationCheckpointService) notify(checkpoint model.ConversationCheckpoint) {
	if s.notifier == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := s.notifier.CheckpointChanged(ctx, checkpoint); err != nil {
		slog.Warn("checkpoint notification failed", "checkpoint_id", checkpoint.ID, "error", err)
	}
}
