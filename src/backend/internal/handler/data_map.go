package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type DataMapHandler struct{ svc *service.DataMapService }

func NewDataMapHandler(svc *service.DataMapService) *DataMapHandler { return &DataMapHandler{svc: svc} }

func internalSourceMachineRequester(c *gin.Context, machine *model.DaemonMachine) (string, bool) {
	requesters := c.Request.URL.Query()["user_id"]
	if machine == nil || machine.UserID == "" || len(requesters) != 1 || requesters[0] == "" || requesters[0] != machine.UserID {
		middleware.ErrorResponse(c, http.StatusForbidden, 40372, "当前请求者与已认证电脑所属账号不一致")
		return "", false
	}
	return machine.UserID, true
}

func (h *DataMapHandler) Status(c *gin.Context, machine *model.DaemonMachine) {
	userID, ok := internalSourceMachineRequester(c, machine)
	if !ok {
		return
	}
	middleware.SuccessResponse(c, h.svc.Status(userID))
}

func (h *DataMapHandler) SearchHiveTables(c *gin.Context, machine *model.DaemonMachine) {
	userID, ok := internalSourceMachineRequester(c, machine)
	if !ok {
		return
	}
	pageNo, pageSize := 0, 0
	var err error
	if raw := c.Query("page_no"); raw != "" {
		pageNo, err = strconv.Atoi(raw)
	}
	if err == nil {
		if raw := c.Query("page_size"); raw != "" {
			pageSize, err = strconv.Atoi(raw)
		}
	}
	if err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40072, "数据地图分页参数无效")
		return
	}
	result, err := h.svc.SearchHiveTables(c.Request.Context(), userID, service.DataMapHiveSearch{
		DBName: c.Query("db_name"), Prefix: c.Query("prefix"), PageNo: pageNo, PageSize: pageSize,
	})
	if err == nil {
		middleware.SuccessResponse(c, result)
		return
	}
	switch {
	case errors.Is(err, service.ErrDataMapInvalid):
		middleware.ErrorResponse(c, http.StatusBadRequest, 40072, "数据地图检索参数无效")
	case errors.Is(err, service.ErrDataMapForbidden):
		middleware.ErrorResponse(c, http.StatusForbidden, 40372, "当前账号没有数据地图试点权限")
	case errors.Is(err, service.ErrDataMapNotConfigured):
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50372, "数据地图凭据尚未配置")
	case errors.Is(err, service.ErrDataMapUnavailable):
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50373, "数据地图暂时不可用，不能判定资产不存在")
	default:
		middleware.ErrorResponse(c, http.StatusBadGateway, 50272, "数据地图返回格式未核验，不能判定资产不存在")
	}
}
