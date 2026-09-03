package handler

import (
	"errors"
	"net/http"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type OpenSkillLocationRequest struct {
	SourcePath string `json:"source_path" binding:"required"`
}

type InstallGitHubSkillRequest struct {
	SourceURL string `json:"source_url" binding:"required"`
	Ref       string `json:"ref"`
	Subpath   string `json:"subpath"`
}

// OpenSkillLocation 打开 daemon 电脑上的真实 SKILL.md 位置。
func (h *AgentHandler) OpenSkillLocation(c *gin.Context) {
	var req OpenSkillLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40040, "参数错误: "+err.Error())
		return
	}
	userID := middleware.GetUserID(c)
	err := h.svc.OpenDaemonSkillLocation(c.Request.Context(), userID, c.Param("id"), req.SourcePath)
	if err != nil {
		if errors.Is(err, service.ErrAgentInvalidInput) {
			middleware.ErrorResponse(c, http.StatusBadRequest, 40041, err.Error())
			return
		}
		if errors.Is(err, service.ErrAgentNotFound) {
			middleware.ErrorResponse(c, http.StatusNotFound, 40434, err.Error())
			return
		}
		middleware.ErrorResponse(c, http.StatusInternalServerError, 50039, "打开 skill 位置失败")
		return
	}
	middleware.SuccessResponse(c, nil)
}

// InstallGitHubSkill installs a public GitHub Skill after the user explicitly
// confirms the action in the UI.
func (h *AgentHandler) InstallGitHubSkill(c *gin.Context) {
	var req InstallGitHubSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40042, "参数错误: "+err.Error())
		return
	}
	installed, err := h.svc.InstallGitHubSkill(c.Request.Context(), middleware.GetUserID(c), c.Param("id"), service.GitHubSkillInstallRequest{
		SourceURL: req.SourceURL,
		Ref:       req.Ref,
		Subpath:   req.Subpath,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAgentInvalidInput):
			middleware.ErrorResponse(c, http.StatusBadRequest, 40043, "只支持公开的 GitHub HTTPS Skill 仓库")
		case errors.Is(err, service.ErrAgentNotFound):
			middleware.ErrorResponse(c, http.StatusNotFound, 40436, "Agent 或所属电脑不存在")
		case errors.Is(err, service.ErrAgentOffline):
			middleware.ErrorResponse(c, http.StatusServiceUnavailable, 50311, "Agent 所属电脑未连接")
		default:
			middleware.ErrorResponse(c, http.StatusInternalServerError, 50041, err.Error())
		}
		return
	}
	middleware.SuccessResponse(c, installed)
}
