package handler

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type ReportHandler struct{ svc *service.ReportService }

func NewReportHandler(svc *service.ReportService) *ReportHandler { return &ReportHandler{svc: svc} }

func (h *ReportHandler) ListSources(c *gin.Context) {
	rows, err := h.svc.ListSources(c.Request.Context(), middleware.GetUserID(c))
	h.respond(c, rows, err)
}
func (h *ReportHandler) ListDefinitions(c *gin.Context) {
	rows, err := h.svc.ListDefinitions(c.Request.Context())
	h.respond(c, rows, err)
}
func (h *ReportHandler) ListAgentContracts(c *gin.Context) {
	rows, err := h.svc.ListAgentContracts(c.Request.Context())
	h.respond(c, rows, err)
}
func (h *ReportHandler) QueryAgentData(c *gin.Context) {
	var input model.ReportAgentQueryRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40064, "Agent 报表查询参数错误")
		return
	}
	result, err := h.svc.QueryAgentData(c.Request.Context(), input)
	h.respond(c, result, err)
}
func (h *ReportHandler) ListRuns(c *gin.Context) {
	rows, err := h.svc.ListRuns(c.Request.Context(), c.Param("id"), middleware.GetUserID(c))
	h.respond(c, rows, err)
}

func (h *ReportHandler) CreateSource(c *gin.Context) {
	var input model.ReportDataSource
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40060, "数据源参数错误")
		return
	}
	row, err := h.svc.CreateSource(c.Request.Context(), middleware.GetUserID(c), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.CreatedResponse(c, row)
}

func (h *ReportHandler) GetSourceContract(c *gin.Context) {
	row, err := h.svc.GetSourceContract(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	h.respond(c, row, err)
}

func (h *ReportHandler) SaveSourceContract(c *gin.Context) {
	var input model.ReportDataSourceContract
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40063, "数据源契约参数错误")
		return
	}
	row, err := h.svc.SaveSourceContract(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, row)
}

func (h *ReportHandler) CreateDefinition(c *gin.Context) {
	var input model.ReportDefinition
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40061, "报表参数错误")
		return
	}
	row, err := h.svc.CreateDefinition(c.Request.Context(), middleware.GetUserID(c), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.CreatedResponse(c, row)
}

func (h *ReportHandler) UpdateDefinition(c *gin.Context) {
	var input model.ReportDefinition
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, 400, 40061, "报表参数错误")
		return
	}
	row, err := h.svc.UpdateDefinition(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), input)
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, row)
}

func (h *ReportHandler) Run(c *gin.Context) {
	run, err := h.svc.Run(c.Request.Context(), c.Param("id"), middleware.GetUserID(c), service.ReportRunOptions{Range: c.Query("range"), Cities: c.QueryArray("city")})
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, run)
}

func (h *ReportHandler) QueryPage(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := h.svc.QueryPage(c.Request.Context(), c.Param("id"), page, pageSize, middleware.GetUserID(c))
	h.respond(c, result, err)
}

func (h *ReportHandler) QuerySearch(c *gin.Context) {
	result, err := h.svc.QuerySearch(c.Request.Context(), c.Param("id"), c.Query("duid"))
	h.respond(c, result, err)
}

func (h *ReportHandler) QueryAnalytics(c *gin.Context) {
	result, err := h.svc.QueryAnalytics(c.Request.Context(), c.Param("id"), c.DefaultQuery("range", "31d"), c.Query("end_date"), c.QueryArray("city"))
	h.respond(c, result, err)
}

func (h *ReportHandler) DownloadCSV(c *gin.Context) {
	run, err := h.svc.GetRun(c.Request.Context(), c.Param("runId"), middleware.GetUserID(c))
	if err != nil || run == nil {
		middleware.ErrorResponse(c, 404, 40460, "报表运行记录不存在")
		return
	}
	var rows []map[string]any
	if err := json.Unmarshal(run.SnapshotJSON, &rows); err != nil {
		middleware.ErrorResponse(c, 500, 50060, "报表快照损坏")
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="report-%s.csv"`, run.ID))
	_, _ = c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(c.Writer)
	if len(rows) == 0 {
		_ = w.Write([]string{"暂无数据"})
		w.Flush()
		return
	}
	keys := make([]string, 0, len(rows[0]))
	for key := range rows[0] {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	_ = w.Write(keys)
	for _, row := range rows {
		values := make([]string, len(keys))
		for i, key := range keys {
			values[i] = fmt.Sprint(row[key])
		}
		_ = w.Write(values)
	}
	w.Flush()
}

func (h *ReportHandler) respond(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	middleware.SuccessResponse(c, data)
}
func (h *ReportHandler) writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrReportAggregateCapacity):
		middleware.ErrorResponse(c, http.StatusUnprocessableEntity, 42260, service.ErrReportAggregateCapacity.Error())
	case errors.Is(err, service.ErrReportForbidden):
		middleware.ErrorResponse(c, http.StatusForbidden, 40360, service.ErrReportForbidden.Error())
	case errors.Is(err, service.ErrReportCredentialsMissing):
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50360, "报表数据源认证尚未配置，请联系管理员")
	case errors.Is(err, service.ErrReportInvalid):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40062, err.Error())
	case errors.Is(err, service.ErrReportNotFound):
		middleware.ErrorResponse(c, http.StatusNotFound, 40461, err.Error())
	case errors.Is(err, service.ErrReportSourceMissing):
		middleware.ErrorResponse(c, http.StatusNotFound, 40462, err.Error())
	default:
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50061, "报表操作失败")
	}
}
