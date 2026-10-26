# Cooper 按需接入发布与验收 — 2026-10-19

## 已上线

- 服务器：`http://10.190.43.41:8080`
- 发布：`managed-mcp-20261019T101750Z`；父发布 `managed-mcp-20261019T095454Z`。
- daemon：0.4.10；本人电脑已升级并保留旧包，启动脚本指纹不变。
- 后端 SHA256：`8c5472ed874a5829f78c2d3e7e23ff2309bfde5ba39853de074e9d7727ce6b08`。
- 连接包 SHA256：`86da893abcdf062989741ee38c844ca727cc373f619591490b14e4739ddc0ac0`。
- 前端入口 SHA256 不变：`106f9f667170f9ea374655eec6a88afd288faa87b70d688c289ceddc7f9eaba9`。
- 未提交、未推送 Git。完整源码保存在 `.scratch/managed-mcp-20261019T095454Z/candidate/` 与服务器对应路径；根工作区并非完整线上版本，不作全量覆盖来源。

## 能力与权限

服务器发布无凭据目录，Agent 按关键词发现；具有 `set_managed_mcp_enabled` 显式权限的 Agent 可握手验证后启用或撤销。Cooper 首期仅提供 `readContent` 和 `getKnowledgeDirectory`。本机官方代理执行请求，个人令牌不发送到平台服务器，不运行下载的安装脚本。

本次仅为本人当前电脑上的 Codex、Codex_cli 和 ClaudeCode 追加接入开关权限，原工具集合、管理开关、头像和提示词等保持不变。修改前工具配置保存在服务器本次 release 的 `agent-tools-before.json`。其他用户与其他电脑未自动授权。

Cooper 令牌指纹先在可信本机配置流程中绑定当前平台/机器/用户，Agent 不能自行认领 OS 上已有令牌。启用状态在该作用域内共享，因此本人同一电脑上的 Claude/Codex 都可使用。不对同 OS 账号的恶意 shell 操作者宣称强隔离；旧数梦继续使用原凭据兼容规则。

## 实际验收

- 本机安装目录运行 stdio 初始化，确认版本 0.4.10。
- 以 Codex 与 Claude Agent 身份分别列出接入开关、真实 Cooper 两项允许工具，并成功读取已指定官方文档《司内 MCP 接入》，每次返回约 6.9 KB。仅保存结果摘要，不存正文或令牌。
- Claude 撤销后，Codex 下一次 `get_managed_mcp_tools` 被拒绝；再由 Codex 重新接入成功。最终 Cooper 保持已连接。
- 随机非所属用户访问真实机器目录被拒绝。隔离测试另覆盖其他合法作用域主动启用不能继承凭据。
- 数梦真实 `get_managed_mcp_tools` 成功，保留 7 个工具；没有重复执行业务 SQL。
- 公司文档写入、创建、分享和权限变更：0 次。
- 摘要：`.scratch/managed-mcp-20261019T101750Z/live-acceptance.json`。这是实际 Agent 身份下的协议验收，不声称两个模型本轮都自行生成了安装决策。

## 测试与审查

- daemon 全量 294 项通过；新 onboarding 5 项涵盖发现、接入、调用、跨作用域拒绝、真实 stdio 权限、错误脱敏及并发/崩溃撤销。
- 后端 owner 目录测试、工具 spec 与真实启动注册入口测试通过。
- 后端全量有两项原基线失败，已在未改动线上冻结源码复现：候选归档缺失 docker-compose fixture；站点路径穿越测试预期 403、实际 404。未宣称后端全绿，未顺带修改这些问题。
- Standards/Spec 独立审查发现的默认授权、凭据绑定和遗留锁问题已修复并复查通过。
- 后端权限注册的最后构建曾指向错误本地输出目录；运行指纹检查发现产物未变化，已重建正确路径并补发。最终 `/proc/<pid>/exe` 哈希与本记录一致，运行时已登记权限工具；未拿源码更新代替运行版本验证。

## 保留与回滚

两段发布均先冻结应用、配置与数据库，保存并校验 `pg_dump -Fc`，验证文件哈希和任务空闲后才切换。健康检查 DB/Redis 正常；Boss provider 配置不变、资源计数不变，45 个头像 HTTP 内容哈希匹配。前端及 Delivery 未改动。

- 服务器完整快照：`/root/energy_tag_agent/.release-backups/managed-mcp-20261019T095454Z`、`/root/energy_tag_agent/.release-backups/managed-mcp-20261019T101750Z`。
- 发布清单、替换前文件和验收摘要：`/root/energy_tag_agent/.releases/<对应发布ID>/`。第二段另有 `runtime-completion-backup/` 保存最终构建补发前状态。
- 本机旧包：`/Users/didi/.di-agent/.release-backups/managed-mcp-20261019T095454Z/previous-package`。
- 如需回滚先等待任务空闲，再按清单还原本次文件和工具授权增量；不要恢复数据库快照覆盖新业务数据。

## 使用

新开一轮对话，可以说“接入 Cooper，然后读取这个文档：〈链接〉”或“断开 Cooper”。缺少权限时应提示授权，不默认放行。当前绑定已为本人完成；其他用户要使用自己的公司令牌、安全助手和账号绑定。

完整说明：候选中的 `docs/managed-mcp-cooper.md`。更多 MCP 的通用目录适配、公司业务写操作及 Windows 安全持久化仍在本轮范围之外。
