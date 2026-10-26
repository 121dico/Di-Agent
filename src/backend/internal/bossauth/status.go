package bossauth

import (
	"bytes"
	"html/template"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Status 只展示接口状态；浏览器导航不能创建身份或签发登录会话。
func (b *Boundary) Status(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	page, err := template.New("boss-status").Parse(statusPage)
	if err != nil {
		c.String(http.StatusInternalServerError, "状态页暂时不可用")
		return
	}
	var body bytes.Buffer
	if err := page.Execute(&body, b.config.Enabled); err != nil {
		c.String(http.StatusInternalServerError, "状态页暂时不可用")
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", body.Bytes())
}

const statusPage = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boss 登录接口 · Di Agent</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f7f7f5; color: #202123; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 640px; margin: 64px auto; padding: 0 24px; }
header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; font-size: 20px; font-weight: 650; }
.brand { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; background: #202123; color: white; font-size: 24px; }
section { padding: 24px; border: 1px solid #dededb; border-radius: 12px; background: white; }
h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.4; }
p { margin: 0 0 16px; }
.muted { color: #60646b; }
.status { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #dededb; }
code { font-size: 14px; overflow-wrap: anywhere; }
a { display: inline-flex; align-items: center; min-height: 44px; color: #1769e0; text-underline-offset: 4px; }
a:focus-visible { outline: 2px solid #1769e0; outline-offset: 4px; border-radius: 4px; }
@media (max-width: 480px) { main { margin: 32px auto; padding: 0 16px; } section { padding: 24px 16px; } }
</style>
</head>
<body>
<main>
<header><span class="brand" aria-hidden="true">D</span><span>Di Agent</span></header>
<section aria-labelledby="title">
<h1 id="title">Boss 登录接口</h1>
<p class="status"><strong>服务可访问</strong><br><code>GET /api/auth/boss/session</code></p>
{{if .}}<p><strong>Boss 登录配置已启用</strong></p>
<p class="muted">当前仅展示服务端配置状态，尚不能据此确认 Boss 转发或身份认证成功。</p>
{{else}}<p><strong>Boss 登录尚未启用</strong></p>
<p class="muted">接口页面已就绪；公司登录仍需完成可信身份接入配置。</p>{{end}}
<p class="muted">页面可打开不代表公司登录已打通。本页仅用于查看状态，不会创建账号或登录会话；登录请求仍由 POST 接口独立校验。</p>
<a href="/login">返回 Di Agent 登录页</a>
</section>
</main>
</body>
</html>`
