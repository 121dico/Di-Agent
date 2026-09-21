package handler

import (
	"errors"
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

func (h *AgentHandler) ListModels(c *gin.Context) {
	catalog, err := h.svc.ListAgentModels(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAgentNotFound):
			middleware.ErrorResponse(c, http.StatusNotFound, 40434, "Agent 不存在")
		case errors.Is(err, service.ErrAgentOffline):
			middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50301, "Agent 所在电脑未连接")
		case errors.Is(err, service.ErrMsgAgentTimeout):
			middleware.ErrorResponse(c, http.StatusGatewayTimeout, 50401, "扫描模型超时，请重新扫描")
		case errors.Is(err, service.ErrMsgInvalidRuntime):
			middleware.ErrorResponse(c, http.StatusBadRequest, 40041, err.Error())
		default:
			middleware.ErrorResponse(c, http.StatusInternalServerError, 50040, "扫描模型失败，请重试")
		}
		return
	}
	middleware.SuccessResponse(c, catalog)
}
