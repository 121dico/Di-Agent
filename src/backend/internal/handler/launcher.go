package handler

import (
	"fmt"
	"net/http"

	"github.com/agent-hub/backend/internal/middleware"
	"github.com/gin-gonic/gin"
)

// GetMachineLauncher 生成 Windows 一键安装启动器（.bat，内嵌 server URL 与本机 API Key）。
// GET /api/daemon/machines/:id/launcher?os=win
//
// macOS 不走此接口：浏览器下载的未签名脚本会被 Gatekeeper 拦截（.command/.terminal/
// zip/dmg 全部实测被拦），因此 Mac 使用「复制 curl|bash 安装命令」方式，见
// GetMachineConnect 返回的 install_command 字段与 /downloads/install.sh。
//
// 每次下载都会重新生成 API Key（与连接命令一致，原始密钥只存哈希），
// 因此旧的 launcher 文件在再次下载后自然失效，无需吊销机制。
func (h *AgentHandler) GetMachineLauncher(c *gin.Context) {
	if c.Query("os") != "win" {
		middleware.ErrorResponse(c, http.StatusBadRequest, 40039, "此接口仅支持 os=win；Mac 请使用 install_command 复制安装命令")
		return
	}

	serverURL, apiKey, err := h.svc.GetMachineInstallInfo(c.Request.Context(), c.Param("id"), middleware.GetUserID(c))
	if err != nil {
		middleware.HandleServiceError(c, err, "生成启动器失败")
		return
	}

	c.Header("Content-Disposition", `attachment; filename="AgentHub-Setup.bat"`)
	c.Data(http.StatusOK, "application/bat", []byte(winLauncherScript(serverURL, apiKey)))
}

// winLauncherScript 生成 Windows 一键安装批处理。
// 自身只做引导：从服务器拉取 install.ps1 并以参数执行（安装逻辑集中在
// scripts/install.ps1，随 package-daemon.sh 分发到服务器 /downloads）。
// SmartScreen 拦截由用户点「更多信息 → 仍要运行」放行（微软官方流程）。
func winLauncherScript(serverURL, apiKey string) string {
	return fmt.Sprintf(`@echo off
chcp 65001 >nul
echo [AgentHub] 开始安装 daemon（需要联网下载 Node 的情况请耐心等待）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path $env:TEMP 'agenthub-install.ps1'; Invoke-WebRequest -Uri '%s/downloads/install.ps1' -OutFile $p -UseBasicParsing; & $p -ServerUrl '%s' -ApiKey '%s'"
if errorlevel 1 (
  echo.
  echo [AgentHub] 安装失败，请把上方红色错误信息截图反馈。
) else (
  echo.
  echo [AgentHub] 安装完成！已注册开机自启，回到浏览器刷新页面即可。
)
pause
`, serverURL, serverURL, apiKey)
}
