<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Project

Di Agent — IM-chat-driven multi-agent collaboration platform. Users chat with multiple AI Agents (Claude Code, Codex, OpenCode) through a Feishu/WeChat-style interface. Supports 1-on-1 chat, group chat, task dispatch, and artifact preview.

## Repository and Release Target

- Primary repository: `https://git.xiaojukeji.com/lijiangli/energy_tag_agent.git`
- Required mirror repository: `https://github.com/121dico/Di-Agent.git`
- Default push remote: `energy-tag-agent`, configured with both repositories as push destinations.
- Default delivery branch: `price_sensitive`
- Unless the user explicitly requests another destination, publish project changes to the `price_sensitive` branch in both repositories, never directly to `main`.
- Every default push must update both repositories with identical content and must verify that both remote `price_sensitive` refs resolve to the same commit.

## Monorepo Layout

```
src/
  backend/        Go backend (module: github.com/121dico/Di-Agent/src/backend)
    cmd/server/main.go          — entrypoint, all DI wiring happens here
    internal/{handler,service,repository,model,middleware}/
    pkg/{ws,redis}/             — shared packages (WebSocket hub, Redis client)
    config/config.yaml          — gitignored; copy from config.example.yaml
    migrations/001..023_*.sql   — numbered SQL migrations, applied in order
  frontend/       React SPA (Vite + TypeScript)
    src/{api,components,hooks,store,views,types,layout}/
    e2e/                         — Playwright E2E tests
  daemon/         Go daemon for local agent scanning & process management (separate go.mod)
  daemon-npm/     npm wrapper di-agent-daemon for the Go daemon
scripts/
  dev.sh          starts postgres + runs migrations + backend + frontend
  build.sh        builds backend binary + frontend dist
```

## Dev Commands

```bash
# Start infra (PostgreSQL 15 + Redis 7)
docker compose up -d

# Backend
cd src/backend
cp config/config.example.yaml config/config.yaml   # edit JWT secret + DB password
go run ./cmd/server/                                 # starts on :8080
# Live-reload: air (config in .air.toml)

# Frontend
cd src/frontend
npm install
npm run dev        # starts on :5173, proxies /api→:8080 and /ws→ws://:8080

# Build both
bash scripts/build.sh   # outputs bin/server + src/frontend/dist/

# Go tests (no external deps needed for unit tests — they use fakes)
cd src/backend
go test ./internal/service/...    # run all service tests
go test ./internal/handler/...    # handler tests

# E2E (requires running backend + frontend)
cd src/frontend
npx playwright install            # first time only
npm run test:e2e:agent            # runs e2e/agent-connect.spec.ts
```

## Key Architecture Facts

### Persistent reporting preference (2026-09-15)

- 用户明确要求：初始化和每日快照生成可以较慢，日常打开报表与切换城市、订单笔数、价敏等级必须快。
- 报表统计计算前移到后台预计算，持久保存聚合结果、查询过程与图表对应关系；不为提速保存用户明细。
- 已发布快照的筛选不得临时扫描上游大表；版本完整校验后原子发布，失败保留上一版。不能只延长短期缓存来宣称已完成预计算。
- 多城市合并必须有可加性依据；不同日期的人群不能直接累加。响应速度用实测报告，不承诺未测得的毫秒级。

- **Backend DI**: All dependency wiring is in `cmd/server/main.go`. Handlers receive Service interfaces, Services receive Repository interfaces. No `init()` or global state.
- **WebSocket**: Two separate WS endpoints — `/ws?token=` for user chat and a daemon WS (token-authenticated via `config.yaml → daemon.token`). The WS hub is in `pkg/ws/`.
- **Migrations**: Sequential numbered SQL files in `src/backend/migrations/`. Applied by `dev.sh` via `psql` or manually. No migration tool binary in the build.
- **Frontend proxy**: Vite dev server proxies `/api` and `/ws` to the Go backend on `:8080`. In production, the Go server serves the frontend dist and handles routing.
- **Daemon ↔ Backend**: The daemon connects over WebSocket with a shared token from config. It scans local machines for agent processes and reports status.
- **Orchestrator**: `internal/service/orchestrator.go` — handles group-chat intent parsing, task splitting, and multi-agent dispatch.

## Conventions

- **Comments**: Chinese (explain "why"). **Names**: English.
- **Line endings**: LF only (not CRLF).
- **Go**: tabs, `log/slog` for structured logging, errors wrapped with `%w`, interfaces defined at consumer side.
- **Frontend**: 2-space indent, CSS Modules (`*.module.css`), path alias `@/` → `src/`, strict TypeScript (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`).
- **Commit format**: `type(scope): 中文描述` — e.g. `feat(chat): 实现WebSocket流式消息推送`. Scopes: `agent|api|auth|chat|daemon|db|orchestrator|preview|ui|conventions|doc`.
- **Branches**: `feature/<desc>`, `fix/<desc>`, `refactor/<desc>`, `docs/<desc>`. No direct push to `main`.

## Zustand Pitfalls

These have caused real bugs in this codebase:
- Never inline `?? []` or `?? {}` in selectors — use module-level constants to avoid infinite re-renders.
- Use precise selectors (`s.messages[convId]`), not the whole store slice.
- `useEffect` deps must be primitives (IDs), not object references.
- Never use `Set`/`Map` in Zustand stores — use `Record<string, boolean>`.

## Config

`src/backend/config/config.example.yaml` documents all fields. `config.yaml` is gitignored. Default DB credentials: `di_agent:di_agent@localhost:5432/di_agent`. Redis optional — degrades gracefully when absent.

## Docs

| Need | Location |
|------|----------|
| Product requirements | `doc/需求文档.md` |
| Architecture | `doc/architecture/overview.md` |
| Project structure | `doc/conventions/project-structure.md` |
| Frontend conventions | `doc/conventions/frontend-conventions.md` |
| Backend conventions | `doc/conventions/backend-conventions.md` |
| Git conventions | `doc/conventions/git-conventions.md` |
| API reference | `doc/reference/api.md` |
| Module tasks | `doc/task/M0-基础设施.md` ~ `doc/task/M10-Pin上下文.md` |
| Task progress | `doc/TASKLIST.md` |

## Di Agent 服务器与账号长期上下文

- 服务器、账号密码、Web 入口、常用路径见：/Users/didi/Documents/dpsk/AGENTS.md
- 本仓库不保存明文密码，避免被提交到 Git。

### 默认线上交付要求（用户于 2026-10-13 再次确认）

- 正式服务器为 `10.190.43.41`，Web 入口 `http://10.190.43.41:8080/`，部署目录 `/root/energy_tag_agent`；SSH 使用 `haopengchen_i` 或 `root`，凭据只从上述本机记录读取。
- 每次完成本地功能修改或修复，都必须在测试、构建通过后同步到正式服务器并验收；除非用户明确要求不上线，不需要再次提醒部署。不能把“本地通过”当作“线上完成”；阻塞或未上线的部分必须明确说明。
- 发布前核对源码与运行产物，防止落后服务器源码覆盖已上线功能。同步本次源码和产物，验证前后端依赖完整；不混入其他任务未验证的改动。
- 发布保留可回滚备份，并记录实际运行产物指纹、发布范围和验收结果。线上工作区可能含未提交发布，不能只凭 Git HEAD 宣称线上版本。
- 用户已确认整合顺序：先保留线上完整快照，再逐项合并本地功能；语义冲突保留线上行为，不明取舍先说明；复测后发布。禁止用本地目录或旧 Git HEAD 全量覆盖线上。
- 发布版本以 `/root/energy_tag_agent/RELEASE.json` 与 `.releases/<release_id>/manifest.json` 为准；必须同时核对当前进程二进制、前端入口和源码哈希。具体合同见 `.trellis/spec/backend/production-reconciliation.md`。

## Production reconciliation baseline (2026-10-13)

- Current deployed release: `reconcile-20261013-604fa5e6-601fe870`; inspect `RELEASE.json` and `.releases/reconcile-20261013-604fa5e6-601fe870/manifest.json`, not Git HEAD alone.
- Before any release: freeze actual production source/artifact/config hashes and backup application/database; incrementally merge local changes. Preserve production behavior on semantic conflict. Never blindly replace production with an old local tree.
- Protect runtime configuration, credentials, database, uploads, and `/root/delivery_insight_ai/runtime`. Live Delivery source must be inspected separately from repository copies.
- Keep a unique release manifest, previous runtime files and verification record. Recheck concurrent edits and active tasks before switching; preserve later edits during rollback.
- This batch was deployment-only at user request: no Git commit or push. Deferred local unlimited timeout, one-minute disconnect failure and V1.2 renderer replacement.
- Release results and recovery notes: `doc/operations/releases/reconcile-20261013-604fa5e6-601fe870.md`.
