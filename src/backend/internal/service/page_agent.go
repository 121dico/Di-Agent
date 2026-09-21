package service

import (
	"context"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// 页面会话使用独立身份，切换执行 Agent 不改变会话与历史。
type pageAgentRepository interface {
	ResolvePageAgentChat(context.Context, string, string, string, string, bool) (*model.Conversation, error)
}

func (s *ConversationService) GetOrCreatePageAgentChat(ctx context.Context, userID, agentID, workspace string, selectAgent bool) (*model.Conversation, error) {
	title := ""
	switch workspace {
	case "report":
		title = "报表agent"
	case "delivery":
		title = "投放agent"
	default:
		return nil, ErrConvInvalidTitle
	}
	repo, ok := s.repo.(pageAgentRepository)
	if !ok {
		return nil, fmt.Errorf("page agent repository unavailable")
	}
	conversation, err := repo.ResolvePageAgentChat(ctx, userID, agentID, workspace, title, selectAgent)
	if err != nil {
		return nil, fmt.Errorf("resolve page agent: %w", err)
	}
	if conversation == nil {
		return nil, ErrConvNotFound
	}
	return conversation, nil
}
