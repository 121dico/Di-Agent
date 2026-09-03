# Di Agent 面试复盘手册

本手册基于当前工作区代码整理，回答原始 400 题。每题包含面试版结论和实现依据；规划能力会明确标注“当前未实现”，不会把设计设想描述成已交付功能。

## 分卷

- [第一卷：定位、架构、前端、接入与 Agent 抽象（1-100）](./01-定位与架构.md)
- [第二卷：调度、Daemon、数据库、Redis 与消息状态（101-200）](./02-运行时与数据.md)
- [第三卷：RAG、MCP、安全、性能与可靠性（201-300）](./03-扩展与可靠性.md)
- [第四卷：难点、Agent 追问、挑战题与标准输出（301-400）](./04-面试表达.md)

## 可信度标记

- **已实现**：当前活跃代码路径存在，并有数据模型、调用点或测试支撑。
- **部分实现**：核心链路存在，但安全、扩展性或产品闭环尚未完整。
- **当前未实现**：仓库中没有可验证的活跃实现，后面附合理方案。

## 最先关注的 10 个问题

| 问题 | 建议先看 |
|------|----------|
| 前端页面和组件 | 第一卷 31-60 |
| 后端框架与分层 | 第一卷 61-75 |
| PostgreSQL 表与数据模型 | 第二卷 136-150、181-190 |
| Redis 的实际用途 | 第二卷 151-165 |
| WebSocket 消息格式 | 第二卷 166-180 |
| Daemon 与后端通信 | 第二卷 116-135 |
| Agent Adapter | 第一卷 76-100、第二卷 101-107 |
| 任务状态 | 第二卷 181-200 |
| Agent 执行失败 | 第三卷 281-300 |
| 多 Agent 并发输出 | 第二卷 108-115、193-200 |

## 高频代码索引

- 前端路由：`src/frontend/src/router/index.tsx`
- 前端消息状态：`src/frontend/src/store/messageStore.ts`、`src/frontend/src/hooks/useWebSocket.ts`
- 后端装配：`src/backend/cmd/server/main.go`
- 消息分流：`src/backend/internal/service/message.go`
- Orchestrator：`src/backend/internal/service/orchestrator.go`、`orchestrator_async.go`
- 统一派发：`src/backend/internal/service/dispatcher.go`
- 用户 WebSocket：`src/backend/pkg/ws/hub.go`
- Daemon WebSocket：`src/backend/pkg/ws/daemon_hub.go`、`src/backend/internal/handler/daemon.go`
- Daemon 运行时：`src/daemon-npm/bin/di-agent-daemon.js`
- CLI Adapter：`src/daemon-npm/cli/`
- 数据库迁移：`src/backend/migrations/`
- Redis：`src/backend/internal/repository/redis_msg.go`
- RAG：`src/backend/internal/rag/`、`src/backend/internal/service/knowledge_rag.go`
- MCP：`src/daemon/mcp/`、`src/backend/internal/router/router.go`
