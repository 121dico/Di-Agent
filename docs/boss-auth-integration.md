# Di Agent 公司登录：最小接入与发布说明

## 当前范围（2026-10-09，取代此前全站网关方案）

只在登录时复用 Boss 已认证的访问者身份：Boss → 受保护登录入口 → 核验身份 → 独立公司账号映射 → Di Agent 自己的短期 JWT。后续业务 API、WebSocket、资源授权继续沿用 Di Agent 原有实现，不要求每个请求经过 Boss。

本地测试登录/注册及已有账号数据保留；机器、MCP 和 scoped 工具令牌的既有语义不变。不改 Dataseek，不重新收集公司密码，不把按用户名查员工资料当作当前访问者认证。

**框架默认关闭不等于真实 SSO 可用。** 必须先验证 Boss 的真实身份传递及来源保护契约；不得盲信任意内网/172网段或浏览器提供的用户名。

## 已实现的适配器契约

公司 session 接口必须同时满足：

1. 网络 socket 实际对端在明确的最小 CIDR 内；不使用 X-Forwarded-For 判断可信来源。
2. 网关注入独立 `X-Di-Agent-Boss-Secret`，服务端与环境变量 `DI_AGENT_BOSS_ORIGIN_SECRET` 常量时间比较。
3. 网关擦除客户端同名身份头后覆盖真实员工标识；必须单值且在试点白名单内。
4. 外部身份按 `(provider, subject)` 原子关联/创建独立用户，不认领同名本地账号，不自动授予管理员。

这个 secret 是 Di Agent 自己的适配契约，**尚不能宣称 Boss 已原生提供**。若平台没有注入能力，需有证据支持的等效受保护回调/正式员工会话校验方式；不能直接删除安全检查。网关及源站通道须有 TLS 或等效保护、网络 ACL。

认证中间件只在登录入口消费身份，且所有下游请求都清除 origin secret，不把秘密透传给业务 BFF。登录之后业务 JWT 由原有中间件验证，不新增 token 算法、provider 或 scope 的接受规则，也不依赖业务请求中的 Username。

## 配置与可诊断接口

```yaml
boss:
  enabled: false
  allow_local_login: true
  login_url: ""
  identity_header: Username
  trusted_proxy_cidrs: []
  allowed_usernames: []
  session_ttl_minutes: 60
```

实际试点用户名只写入受控部署配置，不放共享示例。密钥只通过环境/秘密管理注入，至少32字符；启用时应用 JWT secret 同样至少32字符。

| 接口 | 行为 |
|---|---|
| `GET /api/auth/providers` | 返回 mode、login_url、local_login_enabled、boss_enabled、boss_ready；无秘密或白名单 |
| `POST /api/auth/boss/session`（关闭） | HTTP503，code50371，`Boss login is not configured`，no-store；可明确区分框架已部署和路由不存在 |
| 同接口（启用但伪造/未验证身份） | HTTP401/code40170，不创建用户、不签发 JWT |
| 同接口（可信身份） | 返回原有封装 `{token,user}`，no-store |

mode 的 local/hybrid/boss 仅说明**新登录方式**。allow_local_login:false 可关闭新本地登录，但不撤销旧应用会话；本次保留true。boss_ready仅代表配置满足入口要求，不代表真实登录链路已经验收。

## 会话寿命与回滚

公司登录签发的 JWT 默认60分钟，允许1–480分钟。后续不实时访问 Boss：公司撤权不会自动结束已经建立的 Di Agent 会话或 WebSocket。关闭 Boss 只停止新的公司登录，已有应用 JWT 按其原有到期时间失效。若需即时撤权，必须另行实现应用会话撤销机制，不能声称本次已具备。

回滚先恢复发布备份和入口策略。保持本地账号及外部映射，不删除聊天数据；无需执行 migration088 的 DOWN。不要用 `psql -f` 运行包含 DOWN 的整个迁移文件。

## 当前最小回跳缺口

现有前端 `/login?company=1` 只对当前同源 POST session 接口，不能直接完成 Boss 域和源站域之间的安全会话交接。必须确认实际受保护回调入口、身份头覆盖、真实网关来源/来源认证、获批回跳地址及传输保护，或获得正式服务端员工会话校验契约。

不猜 OAuth/token/userinfo 地址，不把公司票据、身份或长期 JWT 放进 URL，不让浏览器持有 origin secret。本轮后端最小增量不发明跨域协议。

## 发布与验收

1. 从服务器当前源码建立隔离快照，只移入认证增量；不可用旧临时制品或本地业务全包覆盖生产。
2. 默认关闭发布 providers/session 与 additive identity migration，确认50371而非404。
3. 验证本地账号、API/WS、machine/scoped工具行为不变，保留可恢复备份。
4. 取得真实身份契约后才启用试点，并实际验证已登录、未登录、未授权、源站伪造、重复登录同账号和后续应用 API/WS。

合成可信网关测试只证明代码逻辑，不证明真实 Boss 登录。此前2026-10-08的逐请求Guard测试记录属于已被本范围替代的方案，不能当本次上线凭证。此前已在隔离PostgreSQL15验证身份并发/幂等；本次仓储未改动，实时执行结果应以当次报告为准。

## 本次本地实现验证（2026-10-09）

- TDD：公司会话直连API原先401，收窄Guard后通过；未就绪接口原先404，改为结构化50371后通过。
- bossauth、cmd/server、router、middleware集中测试通过；Boss测试竞态检测及相关包vet通过。
- 真实原WebSocketHandler与AuthService完成本地Upgrade101，不带网关身份头；不是只测试伪造的WS路由。
- 原JWT验证器仍拒绝错误签名/过期令牌；可信登录拒绝伪造来源、重复身份头和错误secret；scoped路由及machine认证语义保留。
- 全量Go测试仍有既有`TestServeSite_RejectsTraversalIntoAnotherDeployment`失败（404，预期403），其余包通过。本次未修改该业务逻辑。
- 这些是本地结果，不是服务器发布或真实Boss登录成功凭证。
