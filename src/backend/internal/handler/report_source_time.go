package handler

import (
	"errors"
	"net/http"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *ReportHandler) SourceTimeCoverage(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	value, err := h.svc.SourceTimeCoverage(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), c.Request.Method == http.MethodPost)
	if errors.Is(err, service.ErrReportSourceTimeBusy) {
		middleware.ErrorResponse(c, http.StatusConflict, 40966, err.Error())
		return
	}
	h.respond(c, value, err)
}
