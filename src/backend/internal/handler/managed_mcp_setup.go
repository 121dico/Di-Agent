package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/port"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// ManagedMCPSetupExecutor 是处理器消费的最小本机配置能力。
type ManagedMCPSetupExecutor interface {
	Execute(ctx context.Context, userID, machineID, action string, envelope ...*service.ManagedMCPEnvelope) (*service.ManagedMCPSetupStatus, error)
}

type ManagedMCPSetupHandler struct {
	svc ManagedMCPSetupExecutor
}

func NewManagedMCPSetupHandler(svc ManagedMCPSetupExecutor) *ManagedMCPSetupHandler {
	return &ManagedMCPSetupHandler{svc: svc}
}

func (h *ManagedMCPSetupHandler) Inspect(c *gin.Context)      { h.execute(c, "inspect") }
func (h *ManagedMCPSetupHandler) Configure(c *gin.Context)    { h.execute(c, "configure") }
func (h *ManagedMCPSetupHandler) SetupSession(c *gin.Context) { h.execute(c, "setup_session") }
func (h *ManagedMCPSetupHandler) Save(c *gin.Context)         { h.execute(c, "save") }

func (h *ManagedMCPSetupHandler) execute(c *gin.Context, action string) {
	c.Header("Cache-Control", "no-store")
	if action == "save" {
		decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 18*1024))
		decoder.DisallowUnknownFields()
		var request service.ManagedMCPEnvelope
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || !request.Valid() {
			middleware.ErrorResponse(c, 400, 40000, "invalid_envelope")
			return
		}
		result, err := h.svc.Execute(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), action, &request)
		h.respond(c, result, err)
		return
	}
	if action == "setup_session" {
		decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 256))
		var request map[string]json.RawMessage
		if decoder.Decode(&request) != nil || request == nil || len(request) != 0 || decoder.Decode(new(any)) != io.EOF {
			middleware.ErrorResponse(c, 400, 40000, "empty_body_required")
			return
		}
		result, err := h.svc.Execute(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), action)
		h.respond(c, result, err)
		return
	}
	// 此接口只接受空对象，明确拒绝误把个人 Key 发送到平台。
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 256))
	decoder.DisallowUnknownFields()
	var request struct{}
	err := decoder.Decode(&request)
	if err != nil && err != io.EOF {
		middleware.ErrorResponse(c, 400, 40000, "empty_body_required")
		return
	}
	if err == nil && decoder.Decode(new(any)) != io.EOF {
		middleware.ErrorResponse(c, 400, 40000, "empty_body_required")
		return
	}
	result, err := h.svc.Execute(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), action)
	h.respond(c, result, err)
}

func (h *ManagedMCPSetupHandler) respond(c *gin.Context, result *service.ManagedMCPSetupStatus, err error) {
	switch {
	case err == nil:
		middleware.SuccessResponse(c, result)
	case errors.Is(err, service.ErrManagedMCPNotFound):
		middleware.ErrorResponse(c, 404, 40400, "machine_not_found")
	case errors.Is(err, port.ErrManagedMCPOffline):
		middleware.ErrorResponse(c, 409, 40901, "machine_offline")
	case errors.Is(err, port.ErrManagedMCPUpgrade):
		middleware.ErrorResponse(c, 409, 40902, "upgrade_required")
	case errors.Is(err, port.ErrManagedMCPBusy):
		middleware.ErrorResponse(c, 409, 40903, "busy")
	case errors.Is(err, context.DeadlineExceeded):
		middleware.ErrorResponse(c, 504, 50400, "timeout")
	case errors.Is(err, service.ErrManagedMCPInvalidResult):
		middleware.ErrorResponse(c, 502, 50200, "invalid_result")
	case errors.Is(err, service.ErrManagedMCPInvalidEnvelope):
		middleware.ErrorResponse(c, 400, 40000, "invalid_envelope")
	default:
		middleware.ErrorResponse(c, 503, 50300, "setup_unavailable")
	}
}
