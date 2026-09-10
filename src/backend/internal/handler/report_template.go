package handler

import (
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/gin-gonic/gin"
)

func (h *ReportHandler) ListTemplates(c *gin.Context) {
	rows, err := h.svc.ListTemplates(c.Request.Context(), middleware.GetUserID(c))
	h.respond(c, rows, err)
}

func (h *ReportHandler) ApplyTemplate(c *gin.Context) {
	var input struct {
		TemplateID string `json:"template_id"`
		SourceID   string `json:"source_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40065, "模板参数错误")
		return
	}
	row, err := h.svc.ApplyTemplate(c.Request.Context(), middleware.GetUserID(c), input.TemplateID, input.SourceID)
	h.respond(c, row, err)
}
