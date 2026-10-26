package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerSPARoutes(router *gin.Engine, distDir string) {
	if distDir == "" {
		return
	}
	indexPath := filepath.Join(distDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}

	router.NoRoute(spaFallbackHandler(distDir, indexPath))
}

func spaFallbackHandler(distDir, indexPath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if shouldSkipSPAFallback(requestPath) {
			c.Status(http.StatusNotFound)
			return
		}
		cleaned := strings.TrimPrefix(path.Clean(strings.ReplaceAll(requestPath, "\\", "/")), "/")
		if cleaned != "." {
			assetPath := filepath.Join(distDir, cleaned)
			if isRegularFile(assetPath) {
				if filepath.Clean(assetPath) == filepath.Clean(indexPath) || strings.HasPrefix(requestPath, "/avatars/") {
					c.Header("Cache-Control", "no-cache")
				} else if strings.HasPrefix(requestPath, "/assets/") {
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
				}
				c.Header("X-Content-Type-Options", "nosniff")
				c.File(assetPath)
				return
			}
		}
		// 构建资源和头像不是页面路由；缺失时返回 404，避免用 HTML 200 掩盖发布漏文件。
		if strings.HasPrefix(requestPath, "/assets/") || strings.HasPrefix(requestPath, "/avatars/") {
			c.Header("Cache-Control", "no-store")
			c.Status(http.StatusNotFound)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.File(indexPath)
	}
}

func shouldSkipSPAFallback(path string) bool {
	for _, prefix := range []string{"/api/", "/ws", "/daemon/", "/mcp/"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return path == "/api" || path == "/daemon" || path == "/mcp"
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
