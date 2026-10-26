package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

// VerifyBrowserIdentity 仅经现有用户登录中间件开放，不接受机器凭据登录。
func (h *AgentHandler) VerifyBrowserIdentity(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID := middleware.GetUserID(c)
	if userID == "" {
		middleware.ErrorResponse(c, http.StatusUnauthorized, 40100, "需要登录")
		return
	}
	if c.ContentType() != "application/json" {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40000, "invalid_proof")
		return
	}
	var proof service.BrowserIdentityProof
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 512))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&proof); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40000, "invalid_proof")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || !proof.Valid() {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40000, "invalid_proof")
		return
	}
	id, err := h.svc.VerifyBrowserIdentity(c.Request.Context(), userID, proof)
	if err != nil {
		middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50300, "identity_unavailable")
		return
	}
	if id == "" {
		middleware.ErrorResponse(c, http.StatusNotFound, 40400, "no_match")
		return
	}
	middleware.SuccessResponse(c, gin.H{"machine_id": id})
}
