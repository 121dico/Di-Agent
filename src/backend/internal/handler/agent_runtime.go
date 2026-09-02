package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/agent-hub/backend/internal/middleware"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type AgentRuntimeHandler struct {
	svc *service.AgentRuntimeService
}

func NewAgentRuntimeHandler(svc *service.AgentRuntimeService) *AgentRuntimeHandler {
	return &AgentRuntimeHandler{svc: svc}
}

// Overview 返回当前用户可访问 Agent 的真实运行概览。
func (h *AgentRuntimeHandler) Overview(c *gin.Context) {
	days := 7
	if raw := c.Query("days"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			middleware.ErrorResponse(c, http.StatusBadRequest, 40061, "days 必须是 1 到 90 的整数")
			return
		}
		days = parsed
	}
	overview, err := h.svc.GetOverview(
		c.Request.Context(),
		middleware.GetUserID(c),
		c.Param("id"),
		days,
		time.Now().UTC(),
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAgentInvalidInput):
			middleware.ErrorResponse(c, http.StatusBadRequest, 40061, err.Error())
		case errors.Is(err, service.ErrAgentNotFound):
			middleware.ErrorResponse(c, http.StatusNotFound, 40435, err.Error())
		default:
			middleware.ErrorResponse(c, http.StatusInternalServerError, 50040, "查询 Agent 运行概览失败")
		}
		return
	}
	middleware.SuccessResponse(c, overview)
}
