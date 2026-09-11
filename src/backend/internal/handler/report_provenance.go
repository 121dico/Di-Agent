package handler

import (
	"encoding/json"
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/gin-gonic/gin"
)

func (h *ReportHandler) GetProvenance(c *gin.Context) {
	result, err := h.svc.GetProvenance(c.Request.Context(), c.Param("id"), middleware.GetUserID(c), c.QueryArray("execution_id")...)
	h.respond(c, result, err)
}

func (h *ReportHandler) ReplayProvenance(c *gin.Context) {
	var input struct {
		ExecutionID string `json:"execution_id"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40062, "重跑参数错误")
		return
	}
	result, err := h.svc.ReplayProvenance(c.Request.Context(), c.Param("id"), middleware.GetUserID(c), input.ExecutionID)
	h.respond(c, result, err)
}
