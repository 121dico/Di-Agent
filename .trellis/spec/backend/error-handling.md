# Error Handling

> How errors are handled in this project.

---

## Overview

- Errors are sentinel `var Err... = errors.New(...)` values defined in
  the `service` package next to the consuming service.
- Repo layer wraps low-level errors with `fmt.Errorf("... : %w", err)`
  to preserve the original `*pgconn.PgError` for inspection.
- Service layer inspects errors via `errors.Is` (for sentinels) and
  `errors.As` (for typed PG errors) and returns its own sentinel.
- Handler layer maps service sentinels to HTTP status + numeric code.

---

## Error Sentinels

Defined in `service/`, named `Err<Subject><Problem>`:

```go
var ErrConvInvalidRole   = errors.New("invalid conversation agent role")
var ErrConvNotFound      = errors.New("conversation not found")
var ErrConvNoPerm        = errors.New("no permission to manage conversation agents")
var ErrConvOrchConflict  = errors.New("并发设置 Orchestrator 冲突，请重试")
```

A sentinel lives next to the service that produces it
(`ErrConvOrchConflict` is in `conversation.go` next to `RoleService`'s
callers). Do not centralize all sentinels in one `errors.go` — keep
them local.

---

## Error Handling Patterns

### Pattern: DB unique violation → domain conflict

```go
// service/role_service.go
if err := s.convRepo.UpdateAgentRole(ctx, convID, agentID, string(role)); err != nil {
    if role == domain.RoleOrchestrator && isUniqueViolation(err) {
        return ErrConvOrchConflict
    }
    return fmt.Errorf("update agent role: %w", err)
}
```

The `isUniqueViolation` helper is shared across services
(`service/pgerr.go`):

```go
func isUniqueViolation(err error) bool {
    var pgErr *pgconn.PgError
    return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
```

Always scope the check tightly (e.g. `role == RoleOrchestrator`) so
genuine DB errors on other paths are not swallowed as conflicts.

### Pattern: best-effort side effects after commit

When a side effect (WS broadcast, audit log) follows a successful
commit, wrap it so failures do not invalidate the committed state:

```go
if err := s.events.BroadcastRoleChanged(ctx, memberIDs, event); err != nil {
    slog.Warn("role changed: broadcast failed",
        "conv_id", convID, "actor_id", userID, "error", err)
}
return nil  // HTTP success — role is already persisted
```

---

## API Error Responses

Every error response uses `middleware.ErrorResponse(c, status, code, msg)`:

```go
middleware.ErrorResponse(c, http.StatusBadRequest, 40030, "参数错误: "+err.Error())
```

### HTTP Code Convention

| HTTP | When | Code range |
|------|------|------------|
| 400 | Bad request (param parsing, invalid value) | 400xx |
| 401 | Unauthenticated | 401xx |
| 403 | Forbidden (permission denied) | 403xx |
| 404 | Resource not found | 404xx |
| 409 | Conflict (concurrent write, unique violation) | 409xx |
| 500 | Internal error | 500xx |

Codes are numeric, 5-digit, grouped by HTTP status family. The trailing
two digits identify the specific error within the family.

### Concrete Conversation Role Codes

| Code | HTTP | Sentinel | Trigger |
|------|------|----------|---------|
| 40015 | 400 | `ErrConvInvalidRole` | role not in `{orchestrator, worker}` |
| 40016 | 400 | (sub-codes of 40015) | (legacy / kept for compat) |
| 40315 | 403 | `ErrConvNoPerm` | non-owner / non-admin attempts role change |
| 40415 | 404 | `ErrConvNotFound` | conversation does not exist |
| 40915 | 409 | `ErrConvOrchConflict` | concurrent Orchestrator assignment, DB unique violation |

When introducing a new error path, pick the next free code within the
relevant HTTP family and document it here.

---

## Boss gateway boundary codes

| Code | HTTP | Trigger |
|------|------|---------|
| 40170 | 401 | Missing/untrusted gateway identity or invalid/mismatched Boss session |
| 50371 | 503 | Boss login is not configured; route is deployed but provider disabled |
| 50099 | 500 | Boss session signing failed |
| 50370 | 503 | External identity storage unavailable; no database details returned |

These codes are owned by `internal/bossauth`. Gateway secrets must never be
logged or copied into downstream proxy headers, including in disabled mode.

## Common Mistakes

- Wrapping errors with `%v` instead of `%w` — breaks `errors.As` /
  `errors.Is` chains; downstream code cannot detect the underlying PG
  error code.
- Catching unique violation without scoping the check (e.g. omitting
  `role == RoleOrchestrator`) — swallows real DB errors on other paths.
- Returning HTTP 500 for a 409-class conflict — the operator cannot
  distinguish "transient server error" from "another tab beat me to it".
- Centralizing all error sentinels in a single `errors.go` — encourages
  cross-service coupling; prefer colocated sentinels near the producer.

## Agent failure visibility contract (2026-10-19)

### 1. Scope / Trigger
单聊和群聊的流式 Agent 失败必须在原回复显示原因，不得只保存空正文和 `status=error`。

### 2. Signatures
`FinalizeStreamingPipelineOptions.ErrorReason` 接收原始诊断；`FinalizeStreamingPipeline` 返回已保存消息；`BroadcastStreamingTerminal(..., saved ...*model.Message)` 优先广播该快照。`SanitizeToolTraceEvents` 在实时 WS 和缓冲区之前清洗 `AgentEventError`。

### 3. Contracts
沿用 `message.complete` 和消息的 `blocks_json`，追加 `{kind:"error",text:<安全诊断>}`，不改数据库结构。正文、已有 blocks、回复关联保留；实时与历史展示一致。诊断先脱敏再限制为 2000 字符，前端纯文本渲染；不推测账号/权限原因。

### 4. Validation & Error Matrix
- 原等待 context 超时：使用独立且有界的 context 保存终态。
- 成功提交后关联重读失败：使用已保存字段及原关联回退，不能阻止终态通知。
- canceled：保持取消，不追加失败标签。
- 旧 error 消息没有原因：显示“未保存具体失败原因”，不编造或回填原因。

### 5. Good/Base/Bad Cases
Good：部分正文 + 安全错误，刷新后相同。Base：无正文的失败也明确可见。Bad：先向 WS 发送含凭据错误，再在最终保存时脱敏；或额外读取失败后不再发送终态。

### 6. Tests Required
`agent_failure_display_test.go` 覆盖真实派发/单聊入口、WS 终态、历史读取、部分正文、取消、context 超时和提交后读失败；`daemon_error_display_test.go` 通过真实 task.progress → 用户 WS → replay 检查凭据不泄露；`MessageBubble.errors.test.tsx` 覆盖 live/history、旧消息、纯文本与终态优先。

### 7. Wrong vs Correct
Wrong：`FinalizeStreaming(..., "error", "", "", "")` 后留下空白。
Correct：统一清洗诊断，合并已输出内容，保存错误块，再用已保存快照广播；终态优先于残留 streaming 标志。
