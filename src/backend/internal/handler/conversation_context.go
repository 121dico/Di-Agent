package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/agent-hub/backend/internal/middleware"
	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ConversationContextServiceForHandler interface {
	ListUsage(ctx context.Context, userID, conversationID string) ([]model.AgentSession, error)
	Continue(ctx context.Context, userID, conversationID, checkpointID, targetAgentID string) (*service.ContinueConversationContextResult, error)
	Import(ctx context.Context, userID, targetConversationID, sourceConversationID, checkpointID, targetAgentID string) (*service.ContinueConversationContextResult, error)
	Fork(ctx context.Context, userID, sourceConversationID, checkpointID, targetAgentID, title string) (*model.ConversationForkResult, error)
	GetFork(ctx context.Context, userID, childConversationID string) (*model.ConversationFork, error)
}

type ForkConversationRequest struct {
	CheckpointID string `json:"checkpoint_id" binding:"required"`
	AgentID      string `json:"agent_id" binding:"required"`
	Title        string `json:"title"`
}

func (h *ConversationContextHandler) Fork(c *gin.Context) {
	var request ForkConversationRequest
	if err := c.ShouldBindJSON(&request); err != nil || !validContextUUIDs(c.Param("id"), request.CheckpointID, request.AgentID) {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40083, "Fork 参数不合法")
		return
	}
	result, err := h.svc.Fork(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), request.CheckpointID, request.AgentID, request.Title)
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, result)
}

func (h *ConversationContextHandler) GetFork(c *gin.Context) {
	if !validContextUUIDs(c.Param("id")) {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40083, "Fork 参数不合法")
		return
	}
	result, err := h.svc.GetFork(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, result)
}

type ConversationContextHandler struct {
	svc ConversationContextServiceForHandler
}

func NewConversationContextHandler(svc ConversationContextServiceForHandler) *ConversationContextHandler {
	return &ConversationContextHandler{svc: svc}
}

func (h *ConversationContextHandler) ListUsage(c *gin.Context) {
	result, err := h.svc.ListUsage(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, result)
}

type ContinueConversationCheckpointRequest struct {
	AgentID string `json:"agent_id"`
}

func (h *ConversationContextHandler) Continue(c *gin.Context) {
	var request ContinueConversationCheckpointRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40081, "续接参数不合法")
		return
	}
	result, err := h.svc.Continue(
		c.Request.Context(),
		middleware.GetUserID(c),
		c.Param("id"),
		c.Param("checkpointId"),
		request.AgentID,
	)
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, result)
}

type ImportConversationCheckpointRequest struct {
	SourceConversationID string `json:"source_conversation_id" binding:"required"`
	CheckpointID         string `json:"checkpoint_id" binding:"required"`
	AgentID              string `json:"agent_id" binding:"required"`
}

func (h *ConversationContextHandler) Import(c *gin.Context) {
	var request ImportConversationCheckpointRequest
	if err := c.ShouldBindJSON(&request); err != nil || !validContextUUIDs(request.SourceConversationID, request.CheckpointID, request.AgentID) {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40082, "引入检查点参数不合法")
		return
	}
	result, err := h.svc.Import(
		c.Request.Context(),
		middleware.GetUserID(c),
		c.Param("id"),
		request.SourceConversationID,
		request.CheckpointID,
		request.AgentID,
	)
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, result)
}

func validContextUUIDs(values ...string) bool {
	for _, value := range values {
		if _, err := uuid.Parse(value); err != nil {
			return false
		}
	}
	return true
}

func (h *ConversationContextHandler) handleError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrContextMeterInvalidInput), errors.Is(err, service.ErrCheckpointInvalid), errors.Is(err, service.ErrConversationForkTitle):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40081, err.Error())
	case errors.Is(err, service.ErrCheckpointNoPerm), errors.Is(err, service.ErrCheckpointScope), errors.Is(err, service.ErrConvNoPerm):
		middleware.ErrorResponse(c, http.StatusForbidden, 40381, err.Error())
	case errors.Is(err, service.ErrCheckpointNotFound), errors.Is(err, service.ErrConvNotFound):
		middleware.ErrorResponse(c, http.StatusNotFound, 40481, err.Error())
	case errors.Is(err, service.ErrCheckpointAgentBound), errors.Is(err, service.ErrCheckpointNotReady):
		middleware.ErrorResponse(c, http.StatusConflict, 40981, err.Error())
	case errors.Is(err, service.ErrDaemonNotConnected):
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50381, "Agent daemon 当前未连接")
	default:
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50081, "会话上下文操作失败")
	}
}
