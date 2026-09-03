# 系统架构概览

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 (SPA)                         │
│          React + TypeScript + Vite + Zustand                │
└──────────┬──────────────────────────────┬───────────────────┘
           │ HTTP REST                    │ WebSocket
           ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    后端 API Server (Go)                       │
│              Gin + pgx/sqlx + nhooyr/websocket               │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Handler    │ │ Service  │ │ Repository│ │  WS Hub      │  │
│  │  (路由/校验)│ │ (业务逻辑)│ │ (数据访问)│ │ (消息总线)   │  │
│  └────────────┘ └────┬─────┘ └─────┬────┘ └──────┬───────┘  │
│                       │             │              │          │
│                       │    ┌────────┴────────┐     │          │
│                       │    │ RedisMsgRepo     │     │          │
│                       │    │ (离线队列+热缓存) │     │          │
│                       │    └────────┬────────┘     │          │
└───────────────────────┼────────────┼──────────────┼──────────┘
                        │            │              │
                        ▼            ▼              │
┌──────────────────────────────────────────────┐    │
│            PostgreSQL 15                     │    │
│   users / conversations / messages           │    │
└──────────────────────────────────────────────┘    │
                                                    │
┌──────────────────────────────────────────────┐    │
│            Redis (缓存 + 离线消息)            │    │
│  offline:{uid}:{cid}  Sorted Set             │    │
│  msgs:{cid}           List (热缓存)           │    │
│  unread:{uid}:{cid}   String (计数器)         │    │
└──────────────────────────────────────────────┘    │
                                                    │
┌──────────────────────────────────────────────┐    │
│            Daemon 守护进程 (Go)               │◄───┘
│  ┌─────────┐ ┌─────────┐ ┌────────────────┐  │
│  │ Scanner │ │ Adapter │ │ ProcessManager │  │
│  │ (发现)  │ │ (适配)  │ │ (进程管理)     │  │
│  └─────────┘ └─────────┘ └────────────────┘  │
│         │                                     │
│         ▼                                     │
│  ┌─────────────────────────────────┐          │
│  │  Agent CLI (Claude/Codex/...)   │          │
│  └─────────────────────────────────┘          │
└──────────────────────────────────────────────┘
```

## 数据流

用户发送消息的统一管道：

```
1. 用户在浏览器输入消息
2. 前端 POST /api/conversations/:id/messages 或 WebSocket chat
3. Handler 校验 JWT → 调用 Service
4. Service 写入 PostgreSQL（事务内同时更新对话时间戳）
5. Service 异步执行 postPersist：
   a. Hub 消息总线推送给所有会话成员（BusPersistedMsg）
   b. Redis 热缓存追加消息（LPUSH + LTRIM）
   c. 离线成员消息入队（per-user Sorted Set）
   d. 递增未读计数
6. 所有已连接的客户端收到 WebSocket message.complete 推送
7. 用户上线时拉取离线消息 GET /api/conversations/:id/messages/unread
8. Backend 创建 daemon task 后通过 /daemon/ws 主动下发 task.execute
9. Daemon 执行对应 Agent CLI，通过 task.done/task.error 回传结果
10. Backend 持久化 assistant 消息并通过 WebSocket 推送给前端
```

## 组件说明

### Frontend SPA
单页应用，负责对话列表、聊天窗口、消息渲染。通过 REST API 操作数据，通过 WebSocket 接收实时推送。

### Backend API Server
Go 实现的 HTTP 服务，采用分层架构（Handler → Service → Repository）。JWT 鉴权，Gin 路由，pgx 驱动 PostgreSQL。

### WebSocket Hub
内嵌于后端的 WebSocket 消息中心。基于 Go channel 消息总线模式（BusMessage），支持 8 种消息类型（注册/注销/广播/房间消息/私聊/加入房间/离开房间/持久化推送）。管理连接池，按用户 ID 索引多设备连接，按 conversation ID 分组房间成员。支持流式推送（Agent 逐 token 输出）。

### PostgreSQL
主数据存储，保存用户、对话、消息、会话成员等核心数据。消息创建与对话时间戳更新在同一事务中保证原子性。

### Redis
消息缓存与离线消息层。三种数据结构：离线消息队列（Sorted Set，score=timestamp）、热消息缓存（List，最近 50 条）、未读计数器。使用 Lua 脚本保证离线消息原子出队。Redis 不可用时自动降级，不影响消息持久化。

### Daemon
本地守护进程，负责发现已安装的 Agent CLI 工具、管理 Agent 子进程生命周期、适配不同 Agent 的输出格式，并通过 WebSocket 与后端通信。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端框架 | React 18 + TypeScript | SPA |
| 前端构建 | Vite | 快速 HMR |
| 状态管理 | Zustand | 轻量级 |
| 前端路由 | React Router v6 | |
| 前端样式 | CSS Modules | 作用域隔离 |
| 后端框架 | Go + Gin | HTTP 路由 |
| 数据库驱动 | pgx / sqlx | PostgreSQL |
| WebSocket | nhooyr/websocket | Go 标准 |
| 缓存 | Redis (go-redis/v9) | 离线消息 + 热缓存 + 未读计数 |
| 配置管理 | koanf | |
| 日志 | slog | Go 标准库 |
| 数据库 | PostgreSQL 15 | |
| 容器化 | Docker Compose | 本地开发 |
| 守护进程 | Go | Agent 管理 |

## Conversation Checkpoint 与 Session 上下文

- PostgreSQL 中的 `messages` 仍是原始会话事实来源；`conversation_checkpoints` 只保存稳定消息范围、结构化摘要和 Markdown 表示。
- `agent_sessions` 按 `conversation_id + agent_id + generation` 保存 CLI Session、估算 Token、容量、阈值状态和压缩次数。
- Context Meter 的首版数据源是 `estimated`：中文字符按保守估算、ASCII 约四字符一个 Token。未来 Adapter 回传真实 usage 后可切换为 `actual`。
- 创建检查点时先持久化规则摘要，再由所选 Agent 异步精炼；失败不会丢失检查点。
- 续接时保持原 `conversation_id` 和原始消息不变，rollover 当前 Agent Session，通过 daemon 的 `force_fresh_session` 创建新 CLI Session，并一次性注入 Checkpoint Markdown。
- 跨对话引入时分别校验来源对话与目标对话权限，在目标 `conversation_id` 下创建独立 Session；检查点正文作为平台授权的初始化历史写入 CLI Session，后续恢复仍能继续使用。
- daemon 的 persistent slot 以 `agent_id + conversation_id` 隔离，避免同一 Agent 在不同会话间串用 CLI 上下文。

### 上下文与持久化边界

PostgreSQL 可以保存完整历史，但每轮模型调用不会把数据库全量内容重新塞入模型 Context。模型实际看到的是当前 CLI Session 内部历史，加上本轮 prompt、显式 ContextChain 内容，以及续接首轮的 Checkpoint。两者分别解决“可追溯保存”和“有限窗口推理”，不是同一层。

## 目录结构

详细目录说明见 `doc/conventions/project-structure.md`。简要概览：

```
di-agent/
├── src/
│   ├── frontend/          # React SPA
│   ├── backend/           # Go API Server
│   └── daemon/            # Agent 守护进程
├── doc/                   # 文档
│   ├── architecture/      # 架构设计
│   ├── conventions/       # 编码规范
│   ├── design/            # 详细设计
│   ├── reference/         # API 参考
│   └── task/              # 任务详情
├── scripts/               # 开发脚本
├── bin/                   # 构建产物
└── docker-compose.yml     # 本地开发环境
```
