# 数梦页内配置发布 — 2026-10-16

Release: `datadream-inline-20261016T034458Z` · 状态：`active_verified` · Daemon：`0.4.8`

线上入口：http://10.190.43.41:8080/knowledge

## 变更

- 在「数据 → 数梦 → 配置引导」直接填写个人 API Key 和项目 Code，不再打开本地配置窗口。
- 空 Key 保留原有凭据；已保存 Key 不回显。关闭、更换目标及成功后清理草稿。
- 一次性短期会话绑定用户、电脑和 WebSocket，客户端加密转发到本人连接程序，本地保存凭据。
- 保存与验证分开：保存成功之后真实调用 MCP 握手和工具列表，不将配置成功误报为项目权限成功。
- 电脑连接程序安装与更新入口仅保留在「智能体 → 连接电脑」。数据页只显示状态和必要的导航提示。

## 实测

Chrome 正常登录用户 121，线上实际验证：旧客户端禁用配置；更新 0.4.8 后输入框启用；数字项目 ID 被阻止；保留现有 Key，保存 `epower_platform` 后显示「已保存，MCP 已验证」；刷新后状态和项目保持，未保存草稿关闭后清除；智能体页安装/更新入口正确。1440×844、1024×844、390×844 弹窗视觉检查通过。

本轮没有执行业务 SQL，因此不宣称项目或所有表权限通过。真实 Key 未替换；非空 Key 加密保存由隔离测试覆盖。Windows 未进行实体客户端 UI 测试。HTTP 风险提示已展示，加密转发不能替代 HTTPS 或防止页面篡改。

## 检查

- Daemon 全量 286/286；相关测试 24/24。
- 前端相关 23/23；全量 506 通过，2 个已在冻结基线重现的失败（SkillsView Router、reportV12Presentation NaN）。冻结包内 AppleDouble 伪测试已排除，不发布。
- 后端相关 race、service、WebSocket、router 通过；handler 已有 traversal 404/403 基线失败。
- TypeScript、前端生产构建、Linux amd64 后端构建通过。
- 独立规范/需求评审完成，组件约定问题修复并重测。
- 发布后数据库/Redis ready，132 个源码与产物指纹一致；用户/智能体/会话/电脑数量不变，45 个头像校验一致。

## 发布与回滚

服务器：`10.190.43.41`，应用：`/root/energy_tag_agent`，Supervisor：`di-agent`。

- 服务器备份：`/root/energy_tag_agent/.release-backups/datadream-inline-20261016T034458Z`（含数据库备份、源码和运行产物）。
- 服务器证据：`/root/energy_tag_agent/.releases/datadream-inline-20261016T034458Z`（manifest、verification、acceptance）。
- 本机连接程序备份：`/Users/didi/.di-agent/backups/datadream-inline-20261016T034458Z/di-agent-daemon`。
- 后端 SHA256：`ba378aa4ca183504b6b579566ce639cad6e01ed174a3607f536fd19610b54c17`。
- 前端 index SHA256：`842ba8e5b84d2b0da2f633db4c907e6658b8e58549f6577685b2122c3aa0b454`。
- Daemon 包 SHA256：`b92ef3463d6525a1dbf861957ea7e15ad9a4419677e00c0662189a7fd823ca33`。

本次基于冻结线上版本，在 `.scratch/datadream-inline-20261016T034458Z/candidate` 实现和构建；没有覆盖根工作区原有未提交修改，也未推送 Git。属于已记录指纹的工作树快照发布；Git 整理尚未完成，不能声称仓库与线上已全部同步。
