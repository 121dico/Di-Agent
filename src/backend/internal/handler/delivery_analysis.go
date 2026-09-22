package handler

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const deliveryAnalysisAPIPrefix = "/api/delivery-analysis/"

// DeliveryAnalysisHandler 把投放分析工作台（Node BFF + 零构建前端）接入
// Di Agent：静态资源走同源代理，前端内的 /api/ 请求改写为
// /api/delivery-analysis/，从而复用 Agent 的域名和登录态。
type DeliveryAnalysisHandler struct {
	baseURL *url.URL
	client  *http.Client
}

// NewDeliveryAnalysisHandler 创建投放分析代理。baseURL 指向 delivery_insight_ai
// 的 HTTP 服务，默认本机 4173 端口。
func NewDeliveryAnalysisHandler(baseURL string) (*DeliveryAnalysisHandler, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "http://127.0.0.1:4173"
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse delivery analysis base url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("delivery analysis base url must use http or https: %s", baseURL)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("delivery analysis base url is missing host: %s", baseURL)
	}
	return &DeliveryAnalysisHandler{
		baseURL: u,
		client:  &http.Client{Timeout: 3 * time.Minute},
	}, nil
}

// Static 代理投放分析前端静态资源。app.js 内的 /api/ 请求需要改写为
// /api/delivery-analysis/，这样浏览器仍访问同源 Agent。
func (h *DeliveryAnalysisHandler) Static(c *gin.Context) {
	if h == nil {
		c.String(http.StatusServiceUnavailable, "delivery analysis is not configured")
		return
	}
	rel := c.Param("filepath")
	if rel == "" {
		rel = "/"
	}
	h.forward(c, rel, strings.HasSuffix(strings.ToLower(rel), ".js"))
}

// API 代理 /api/delivery-analysis/* 到投放分析 BFF 的 /api/*。
func (h *DeliveryAnalysisHandler) API(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": 50300, "message": "投放分析服务未配置", "data": nil})
		return
	}
	rel := c.Param("path")
	if rel == "" {
		rel = "/"
	}
	h.forward(c, "/api"+rel, false)
}

func (h *DeliveryAnalysisHandler) forward(c *gin.Context, targetPath string, rewriteAPIPrefix bool) {
	target := *h.baseURL
	target.Path = joinURLPath(h.baseURL.Path, targetPath)
	target.RawQuery = c.Request.URL.RawQuery

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target.String(), c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": 50200, "message": "投放分析请求构造失败", "data": nil})
		return
	}
	copyProxyHeaders(req.Header, c.Request.Header)
	req.Host = h.baseURL.Host

	resp, err := h.client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": 50201, "message": "投放分析服务不可用: " + err.Error(), "data": nil})
		return
	}
	defer resp.Body.Close()

	if rewriteAPIPrefix {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		if readErr != nil {
			c.JSON(http.StatusBadGateway, gin.H{"code": 50202, "message": "投放分析前端读取失败", "data": nil})
			return
		}
		body = bytes.ReplaceAll(body, []byte("/api/"), []byte(deliveryAnalysisAPIPrefix))
		c.Data(resp.StatusCode, "application/javascript; charset=utf-8", body)
		return
	}

	copyProxyHeaders(c.Writer.Header(), resp.Header)
	c.Status(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
}

func joinURLPath(basePath, targetPath string) string {
	if basePath == "" || basePath == "/" {
		if targetPath == "" {
			return "/"
		}
		if strings.HasPrefix(targetPath, "/") {
			return targetPath
		}
		return "/" + targetPath
	}
	if targetPath == "" {
		return basePath
	}
	return strings.TrimRight(basePath, "/") + "/" + strings.TrimLeft(targetPath, "/")
}

func copyProxyHeaders(dst, src http.Header) {
	for key, values := range src {
		if strings.EqualFold(key, "Connection") || strings.EqualFold(key, "Keep-Alive") || strings.EqualFold(key, "Transfer-Encoding") || strings.EqualFold(key, "Upgrade") {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}
