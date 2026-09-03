# Di Agent Daemon

Di Agent Daemon 通过 HTTP + WebSocket 连接 Di Agent 后端，在本机启动 Agent CLI（Claude Code / Codex / OpenCode / OpenClaw），把本机 Agent 能力接入 Di Agent 工作台。

典型场景：你在 A 机器上运行 Di Agent 后端与数据库，希望在 B / C 机器上调用 `claude` / `codex` CLI，并复用统一的会话历史、任务卡片和审批流。每台执行机器运行一个 Daemon 并连接 A 即可。

Daemon 由 Di Agent 服务器以离线包分发，用户不需要从 npm 安装。

## 前置条件

- **Node.js ≥ 18**（用 `node -v` 验证）
- **至少装一个目标 agent CLI**，并完成登录：
  - Claude Code: `npm install -g @anthropic-ai/claude-code` 然后 `claude` 跑一次登录
  - Codex: 参考 OpenAI 官方指引
  - OpenCode / OpenClaw: 视你需要的能力按需安装
- **后端可达**：这台机器能够访问 Di Agent Server（同 LAN / Tailscale / 反向代理均可）

## 快速上手（LAN 部署示例）

假设 A 机器（运行 Di Agent 后端）的 LAN IP 是 `10.11.211.178`，后端端口为 `8080`。在 B 机器打开 Di Agent 的「连接电脑」弹窗，复制当次生成的安装命令。macOS 命令形如：

```bash
curl -fsSL http://10.11.211.178:8080/downloads/install.sh | bash -s -- \
  --server-url http://10.11.211.178:8080 \
  --api-key <弹窗生成的 machine key>
```

安装器会从同一台服务器下载 `di-agent-daemon-bundle.tar.gz`，安装到 `~/.di-agent`，并在 daemon 报告健康后完成开机自启切换。Windows 请使用弹窗提供的安装器。

## 获取 API key

API key 由后端签发。在 A 机器（后端所在机器）：

- 如果你是 admin，进后端的管理界面或 DB 直接生成一个 daemon 专用 key
- 或者用现有的用户 API key（取决于后端的鉴权策略）

`--api-key` 决定了这个 daemon 以哪个用户身份注册任务、上报结果。多台 daemon 用同一个 key = 共享同一身份；用不同 key = 各自独立身份。

## 命令行参数 & 环境变量

环境变量使用 `DI_AGENT_*` 前缀。

| 参数 | 环境变量 | 必填 | 说明 |
|------|---------|------|------|
| `--server-url <url>` | — | ✅ | 后端 HTTP 根地址（如 `http://10.11.211.178:8080`） |
| `--api-key <key>` | — | ✅ | 后端 API key |
| `--daemon-token <tok>` | `DI_AGENT_DAEMON_TOKEN` | ❌ | 调 MCP 内部接口（emitCard / task-cards 队列）用的 token；不传则不能发卡片到任务面板 |
| `--conversation-id <id>` | `DI_AGENT_CONVERSATION_ID` | ❌ | MCP 模式下绑死到某会话 |
| `--user-id <id>` | `DI_AGENT_USER_ID` | ❌ | MCP 模式下绑死到某用户 |
| `--agent-id <id>` | `DI_AGENT_AGENT_ID` | ❌ | MCP 模式下绑死到某 agent |
| `--task-id <id>` | `DI_AGENT_TASK_ID` | ❌ | MCP 模式下绑死到某 task（emitCard 依赖） |
| `--mcp` | — | ❌ | 以 MCP server 模式跑（stdin/stdout 协议），不连 WS |

本地开发时可以直接运行：`DI_AGENT_DAEMON_TOKEN=xxx node bin/di-agent-daemon.js --server-url http://...:8080 --api-key yyy`。

## 故障排查

- **离线包缺少入口文件** —— 在服务器仓库运行 `bash scripts/package-daemon.sh`，并确认发布了新的 `downloads/di-agent-daemon-bundle.tar.gz`。
- **连不上后端** —— 先 `curl http://<server-url>/healthz` 验证可达；再检查防火墙是否放行 `:8080`。
- **daemon 起来了但拿不到任务** —— 后端按 agent_id 派活，确认 daemon 用了正确的 `--api-key`（对应身份有权限接到目标 agent 的任务）。
- **spawn claude 失败** —— 在 daemon 这台机器上跑 `claude -p "hi"`，确认能交互。CLI 没装或没登录是最常见原因。
- **卡片不显示** —— 缺 `--daemon-token` 或 `DI_AGENT_DAEMON_TOKEN`，emitCard 调用会被后端拒绝（daemon 日志会打 `card.emit_failed`）。

## 作为常驻进程跑

B 机器上的服务生命周期由安装器管理（macOS 为 `com.diagent.daemon`）。仅本地开发调试时，可从本目录直接运行：

```bash
nohup node bin/di-agent-daemon.js \
  --server-url http://10.11.211.178:8080 \
  --api-key <key> \
  > ~/di-agent-daemon.log 2>&1 &
```

## 版本

当前版本见 `package.json`。破坏性变更会 bump minor/major，修 bug 走 patch。
