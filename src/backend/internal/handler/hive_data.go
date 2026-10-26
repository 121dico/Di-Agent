package handler

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type HiveDataHandler struct {
	svc     *service.HiveDataService
	reports *service.ReportService
}

// APISources 只展示被管理员登记的认证状态和脱敏 AppKey，不发起业务查询。
func (h *HiveDataHandler) APISources(c *gin.Context) {
	sources, err := h.reports.ListSources(c.Request.Context(), middleware.GetUserID(c))
	if err != nil {
		h.respond(c, nil, err)
		return
	}
	rows := make([]model.APIConnectionStatus, 0, len(sources))
	for _, source := range sources {
		key := os.Getenv(source.AppKeyEnv)
		signature := os.Getenv(source.SignatureEnv)
		secret := os.Getenv(source.AppSecretEnv)
		row := model.APIConnectionStatus{ID: source.ID, Name: source.Name,
			Account: "未配置 AppKey", Status: "待配置", Detail: "缺少服务端认证变量"}
		if key != "" {
			row.Account = "AppKey 已配置"
			if len(key) > 8 {
				row.Account = "AppKey ···" + key[len(key)-4:]
			}
		}
		if source.Enabled && key != "" && (signature != "" || secret != "") {
			row.Status, row.Detail = "凭据已配置", "接口连通性在查询时验证"
		} else if !source.Enabled {
			row.Status, row.Detail = "已停用", "管理员已停用此数据源"
		}
		rows = append(rows, row)
	}
	middleware.SuccessResponse(c, rows)
}

func NewHiveDataHandler(svc *service.HiveDataService, reports *service.ReportService) *HiveDataHandler {
	return &HiveDataHandler{svc: svc, reports: reports}
}

func (h *HiveDataHandler) Session(c *gin.Context) {
	account := ""
	provider := "Di Agent 本地账号"
	if c.GetString("auth_provider") == "boss" {
		provider, account = "Boss 企业账号", c.GetString("auth_subject")
	} else {
		account = c.GetString("username")
	}
	middleware.SuccessResponse(c, model.DataSessionIdentity{
		Provider: provider, Account: account, UserID: middleware.GetUserID(c),
	})
}

func (h *HiveDataHandler) Connections(c *gin.Context) {
	userID := middleware.GetUserID(c)
	sources, err := h.reports.ListSources(c.Request.Context(), userID)
	apiCount := len(sources)
	if errors.Is(err, service.ErrReportForbidden) {
		apiCount = -1
	} else if err != nil {
		h.respond(c, nil, err)
		return
	}
	rows, err := h.svc.Status(c.Request.Context(), userID, apiCount)
	h.respond(c, rows, err)
}

func (h *HiveDataHandler) Login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input model.HiveLoginRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40072, "请输入 Hadoop 账号和密码")
		return
	}
	err := h.svc.Login(c.Request.Context(), middleware.GetUserID(c), input.Username, input.Password)
	h.respond(c, nil, err)
}

func (h *HiveDataHandler) Tables(c *gin.Context) {
	rows, err := h.svc.Tables(c.Request.Context(), middleware.GetUserID(c))
	h.respond(c, rows, err)
}

func (h *HiveDataHandler) AddTable(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input model.HiveAddTableRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40073, "请输入完整的库名.表名")
		return
	}
	row, err := h.svc.AddTable(c.Request.Context(), middleware.GetUserID(c), input.TableName)
	h.respond(c, row, err)
}

func (h *HiveDataHandler) Fields(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	row, err := h.svc.Fields(c.Request.Context(), middleware.GetUserID(c), c.Query("table"), c.Query("refresh") == "1")
	h.respond(c, row, err)
}

func (h *HiveDataHandler) Catalog(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 100 {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40071, "搜索词过长")
		return
	}
	recent := strings.Split(c.Query("recent"), ",")
	if len(recent) > 20 {
		recent = recent[:20]
	}
	rows, err := h.svc.Catalog(c.Request.Context(), middleware.GetUserID(c), search, recent)
	h.respond(c, rows, err)
}

func (h *HiveDataHandler) ProbeCatalogTable(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	row, err := h.svc.ProbeCatalogTable(c.Request.Context(), middleware.GetUserID(c), c.Query("table"))
	h.respond(c, row, err)
}

func (h *HiveDataHandler) Query(c *gin.Context) {
	var input model.HiveQueryRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40070, "查询参数错误")
		return
	}
	row, err := h.svc.Query(c.Request.Context(), middleware.GetUserID(c), input)
	h.respond(c, row, err)
}

func (h *HiveDataHandler) List(c *gin.Context) {
	rows, err := h.svc.List(c.Request.Context(), middleware.GetUserID(c))
	h.respond(c, rows, err)
}

func (h *HiveDataHandler) Get(c *gin.Context) {
	row, err := h.svc.Get(c.Request.Context(), middleware.GetUserID(c), c.Param("id"))
	if err == nil && row == nil {
		middleware.ErrorResponse(c, http.StatusNotFound, 40470, "查询记录不存在")
		return
	}
	h.respond(c, row, err)
}

func (h *HiveDataHandler) MachineStatus(c *gin.Context, machine *model.DaemonMachine) {
	userID, ok := hiveMachineRequester(c, machine)
	if !ok {
		return
	}
	connections, err := h.svc.Status(c.Request.Context(), userID, -1)
	if err != nil {
		h.respond(c, nil, err)
		return
	}
	status := "temporarily_unavailable"
	for _, connection := range connections {
		if connection.Kind != "hive" {
			continue
		}
		switch connection.Status {
		case "已连接":
			status = "connected"
		case "未配置":
			status = "not_configured"
		case "未登录":
			status = "login_required"
		}
		break
	}
	middleware.SuccessResponse(c, gin.H{"status": status, "capability": "approved_hive_dt_probe_only"})
}

func (h *HiveDataHandler) MachineProbe(c *gin.Context, machine *model.DaemonMachine) {
	userID, ok := hiveMachineRequester(c, machine)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input model.HiveProbeRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40070, "探测参数错误")
		return
	}
	result, err := h.svc.Probe(c.Request.Context(), userID, input)
	h.respond(c, result, err)
}

func (h *HiveDataHandler) respond(c *gin.Context, data any, err error) {
	if err == nil {
		middleware.SuccessResponse(c, data)
		return
	}
	switch {
	case errors.Is(err, service.ErrReportForbidden):
		middleware.ErrorResponse(c, http.StatusForbidden, 40370, "当前账号无权使用此数据连接")
	case errors.Is(err, service.ErrHiveInvalid):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40071, err.Error())
	case errors.Is(err, service.ErrHiveSelectForbidden):
		middleware.ErrorResponse(c, http.StatusForbidden, 40371, err.Error())
	case errors.Is(err, service.ErrHiveLoginFailed):
		middleware.ErrorResponse(c, http.StatusUnprocessableEntity, 42271, err.Error())
	case errors.Is(err, service.ErrHiveNotReadable):
		middleware.ErrorResponse(c, http.StatusUnprocessableEntity, 42272, err.Error())
	case errors.Is(err, service.ErrHiveTableLimit):
		middleware.ErrorResponse(c, http.StatusConflict, 40972, err.Error())
	case errors.Is(err, service.ErrHiveTableNotAdded):
		middleware.ErrorResponse(c, http.StatusForbidden, 40372, err.Error())
	case errors.Is(err, service.ErrHiveResultTooLarge):
		middleware.ErrorResponse(c, http.StatusUnprocessableEntity, 42270, err.Error())
	case errors.Is(err, service.ErrHiveUnavailable):
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50370, err.Error())
	default:
		middleware.ErrorResponse(c, http.StatusBadGateway, 50270, "Hive 查询失败；请检查连接状态、表权限和分区条件")
	}
}
