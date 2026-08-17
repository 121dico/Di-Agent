package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/agent-hub/backend/internal/middleware"
	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type CheckpointServiceForHandler interface {
	Create(ctx context.Context, input model.CreateCheckpointInput) (*model.ConversationCheckpoint, error)
	List(ctx context.Context, conversationID, userID string, limit int) ([]model.ConversationCheckpoint, error)
	Get(ctx context.Context, conversationID, checkpointID, userID string) (*model.ConversationCheckpoint, error)
	Delete(ctx context.Context, conversationID, checkpointID, userID string) error
}

// ConversationCheckpointHandler 暴露会话检查点的查询和生命周期接口。
type ConversationCheckpointHandler struct {
	svc CheckpointServiceForHandler
}

func NewConversationCheckpointHandler(svc CheckpointServiceForHandler) *ConversationCheckpointHandler {
	return &ConversationCheckpointHandler{svc: svc}
}

type CreateConversationCheckpointRequest struct {
	AgentID           string `json:"agent_id" binding:"required"`
	Scope             string `json:"scope"`
	SourceSessionID   string `json:"source_session_id"`
	TaskID            string `json:"task_id"`
	SourceToMessageID string `json:"source_to_message_id"`
	Generation        int    `json:"generation"`
	TokensBefore      int64  `json:"tokens_before"`
}

func (h *ConversationCheckpointHandler) Create(c *gin.Context) {
	conversationID := c.Param("id")
	var request CreateConversationCheckpointRequest
	if conversationID == "" || c.ShouldBindJSON(&request) != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40080, "检查点参数不合法")
		return
	}
	checkpoint, err := h.svc.Create(c.Request.Context(), model.CreateCheckpointInput{
		ConversationID: conversationID, SourceAgentID: request.AgentID,
		SourceSessionID: request.SourceSessionID, TaskID: request.TaskID,
		SourceToMessageID: request.SourceToMessageID, Generation: request.Generation,
		TokensBefore: request.TokensBefore, Scope: request.Scope,
		CreatedBy: middleware.GetUserID(c),
	})
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.CreatedResponse(c, checkpoint)
}

func (h *ConversationCheckpointHandler) List(c *gin.Context) {
	conversationID := c.Param("id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	checkpoints, err := h.svc.List(c.Request.Context(), conversationID, middleware.GetUserID(c), limit)
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, checkpoints)
}

func (h *ConversationCheckpointHandler) Get(c *gin.Context) {
	checkpoint, err := h.svc.Get(c.Request.Context(), c.Param("id"), c.Param("checkpointId"), middleware.GetUserID(c))
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, checkpoint)
}

func (h *ConversationCheckpointHandler) Delete(c *gin.Context) {
	err := h.svc.Delete(c.Request.Context(), c.Param("id"), c.Param("checkpointId"), middleware.GetUserID(c))
	if err != nil {
		h.handleError(c, err)
		return
	}
	middleware.SuccessResponse(c, gin.H{"deleted": true})
}

func (h *ConversationCheckpointHandler) handleError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrCheckpointInvalid), errors.Is(err, service.ErrCheckpointNoMessages):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40080, err.Error())
	case errors.Is(err, service.ErrCheckpointNoPerm), errors.Is(err, service.ErrCheckpointScope):
		middleware.ErrorResponse(c, http.StatusForbidden, 40380, err.Error())
	case errors.Is(err, service.ErrCheckpointNotFound):
		middleware.ErrorResponse(c, http.StatusNotFound, 40480, err.Error())
	case errors.Is(err, service.ErrCheckpointAgentBound):
		middleware.ErrorResponse(c, http.StatusConflict, 40980, err.Error())
	default:
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50080, "检查点操作失败")
	}
}
