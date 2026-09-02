package handler

import (
	"errors"
	"net/http"

	"github.com/agent-hub/backend/internal/middleware"
	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type PersonalReportHandler struct {
	svc *service.PersonalReportService
}

func NewPersonalReportHandler(svc *service.PersonalReportService) *PersonalReportHandler {
	return &PersonalReportHandler{svc: svc}
}

func (h *PersonalReportHandler) List(c *gin.Context) {
	rows, err := h.svc.List(c.Request.Context(), middleware.GetUserID(c))
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, rows)
}

func (h *PersonalReportHandler) Get(c *gin.Context) {
	row, err := h.svc.Get(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, row)
}

func (h *PersonalReportHandler) Create(c *gin.Context) {
	var input model.PersonalReport
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40071, "个人报表参数错误")
		return
	}
	row, err := h.svc.Create(c.Request.Context(), middleware.GetUserID(c), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.CreatedResponse(c, row)
}

func (h *PersonalReportHandler) Update(c *gin.Context) {
	var input model.PersonalReport
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40071, "个人报表参数错误")
		return
	}
	row, err := h.svc.Update(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, row)
}

func (h *PersonalReportHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), middleware.GetUserID(c), c.Param("id")); err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, gin.H{"deleted": true})
}

func (h *PersonalReportHandler) writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrPersonalReportForbidden):
		middleware.ErrorResponse(c, http.StatusForbidden, 40371, service.ErrPersonalReportForbidden.Error())
	case errors.Is(err, service.ErrPersonalReportInvalid):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40072, service.ErrPersonalReportInvalid.Error())
	case errors.Is(err, service.ErrPersonalReportNotFound):
		middleware.ErrorResponse(c, http.StatusNotFound, 40471, service.ErrPersonalReportNotFound.Error())
	default:
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50071, "个人报表操作失败")
	}
}
