# Agent Runtime Overview and GitHub Skill Installation

## 1. Scope / Trigger

Use this contract when Agent Profile needs persisted execution metrics or when a user deploys a public GitHub Skill to the computer that owns an Agent. Runtime data must never fall back to demo values. Remote Skill content is a local supply-chain boundary and always requires an explicit UI confirmation.

## 2. Signatures

- `GET /api/agents/:id/runtime-overview?days=<1..90>`
- `POST /api/agents/:id/skills/install`
- Daemon RPC tool: `__di-agent_install_skill__`
- Service: `InstallGitHubSkill(ctx, userID, agentID, GitHubSkillInstallRequest)`
- Daemon adapter hook: `installSkillRoot(home) -> string`

## 3. Contracts

Runtime response:

```json
{
  "period_days": 7,
  "conversation_count": 2,
  "execution_count": 16,
  "tool_call_count": 14,
  "total_tokens": 67890,
  "recent_runs": [
    {"id":"...","conversation_id":"...","prompt":"...","requester_name":"...","status":"complete","created_at":"..."}
  ]
}
```

Install request and response:

```json
{"source_url":"https://github.com/owner/repository","ref":"main","subpath":"skills/example"}
{"name":"example","installed_path":"/absolute/cli/skills/example"}
```

Runtime aggregation is scoped to conversations owned by or shared with the authenticated user. The daemon selects the destination through the Agent CLI spec (`~/.codex/skills`, `~/.claude/skills`, and equivalent roots).

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `days` outside `1..90` | HTTP 400 |
| Agent not visible to user | HTTP 404 |
| Source is not `https://github.com/<owner>/<repo>` | HTTP 400 |
| Agent machine is not owned by user | HTTP 404 |
| Agent machine daemon is offline | HTTP 503 |
| Missing/invalid `SKILL.md` frontmatter | Install fails; no target directory |
| Symlink, traversal, more than 500 files, or more than 20 MiB | Install fails; staging is removed |
| Target Skill name already exists | Install fails; existing Skill is unchanged |

## 5. Good / Base / Bad Cases

- Good: user confirms a public GitHub monorepo URL plus a normalized subpath; daemon validates and atomically renames staging into the CLI root.
- Base: an Agent has no executions; return four numeric zeroes and `recent_runs: []`.
- Bad: trust `sender_id` alone for Agent attribution (it identifies users), count another user's conversation, execute a bundled script, or copy directly into the final target.

## 6. Tests Required

- Service test asserts the exact user/Agent/date scope and non-null empty arrays.
- Presentation test asserts metrics are built from API fields and persisted statuses are normalized.
- Selection test asserts select-all, indeterminate state, and required-tool retention.
- Daemon test asserts URL restrictions, manifest validation, atomic deployment, and no overwrite.
- Browser check asserts actual persisted numbers and recent prompts appear in Agent Profile, and the install confirmation modal is reachable.

## 7. Wrong vs Correct

### Wrong

```ts
const metrics = [{ label: '对话次数', value: '128' }];
```

```js
fs.cpSync(checkout, finalTarget, { recursive: true });
execFileSync(path.join(finalTarget, 'scripts', 'setup.sh'));
```

### Correct

```ts
const metrics = buildRuntimeMetrics(await getAgentRuntimeOverview(agent.id, 7));
```

```js
validateSkillTree(sourceDir);
fs.cpSync(sourceDir, staging, { recursive: true });
fs.renameSync(staging, finalTarget); // never run bundled scripts
```

## Scenario: Desktop-bundled Agent runtime fallback

### 1. Scope / Trigger

Use this contract when the machine scanner or persistent dispatcher supports an
Agent product that may be installed only as a desktop application. Detecting a
GUI shell is insufficient: Di Agent must resolve and execute the bundled
headless runtime, preserve multi-turn context, and expose the same normalized
events as a standalone CLI.

### 2. Signatures

- Runtime resolution:
  `resolveRuntimeCandidates({ override, cliCommand, desktopPaths, existingFile, commandVersion }) -> Array<{ command, variant, version }>`
- Process normalization:
  `normalizeProcessSpec(command, args) -> { command, args }`
- CLI adapter variant hook: `variantForCommand(command) -> "cli" | "desktop"`
- Persistent adapter:
  `spawnPersistent(context, daemonCtx) -> { child, sessionId, sendPrompt, close?, events }`
- ZCode protocol calls: `session/create`, `session/subscribe`, `session/send`,
  and `session/close` over newline-delimited JSON on stdio.

### 3. Contracts

- Resolution order is explicit override/runnable standalone CLI, then runnable
  desktop-bundled runtime. Return at most one candidate per runtime variant and
  remove aliases that resolve to the same physical executable.
- A daemon registration is a complete machine-scoped candidate snapshot. After
  every reported runtime has been upserted successfully, candidate rows absent
  from that snapshot are pruned for that machine only. User-created Agents are
  retained.
- Persist the selected `runtime_variant` (`cli` or `desktop`) on the Agent and
  copy it into every start, restart, and task-dispatch payload. An explicit
  unavailable variant is an error and must never fall back to another runtime.
- `.js`, `.cjs`, and `.mjs` runtime entries launch through the daemon's current
  Node executable; Windows command wrappers continue through `cmd.exe`.
- Codex Desktop uses its bundled `codex app-server` and the user's normal
  `~/.codex` authentication/state.
- ZCode Desktop creates one protocol session per live persistent slot, subscribes
  with `deliveryKind: "desktop-continuous"`, and serializes turns through that
  session.
- ZCode receives the Di Agent MCP server in `mcpServers` with
  `isolation: "session"`. API key/daemon token values are carried in the MCP
  protocol `env` array, never in MCP `args` or daemon logs.
- If native `~/.zcode/cli/config.json` is absent, the adapter may derive the
  selected provider/model from `~/.zcode/v2/config.json` and `setting.json`.
  Provider secrets remain in memory and travel only in the app-server stdin
  payload; they are never copied to disk, process arguments, or logs.
- Unknown ZCode notifications are ignored. Text, reasoning, tool, completion,
  and failure notifications map to normalized Agent events.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Standalone CLI and Desktop runtime both run | Report both options; the UI groups them on one product card and defaults to CLI |
| CLI absent; bundled runtime runs | Select bundle and report `variant=desktop` |
| Desktop app exists but bundled runtime is absent/unrunnable | Do not report a candidate |
| Codex login is absent | Do not report Codex as runnable |
| ZCode native and legacy model config are both absent | Return an actionable login/model configuration error |
| ZCode legacy provider has no model/API key | Return an actionable provider error without exposing secrets |
| Protocol request exceeds timeout | Resolve the turn with a compatibility timeout error |
| Child emits `error` or exits during boot/turn | Resolve pending RPC/turn, emit session end, and release slot state |
| Completion omits repeated final text | Use accumulated streamed text as the turn result |

### 5. Good / Base / Bad Cases

- Good: `codex` is missing from `PATH`, ChatGPT Desktop embeds a runnable Codex
  binary, and the scanner reports one Desktop candidate that supports two turns.
- Base: a standalone CLI is present alongside Desktop; report both variants and
  make CLI the UI default without collapsing the Desktop candidate.
- Bad: report an installed `.app` as runnable without executing its runtime,
  scrape the GUI, put credentials in argv, or let a child exit leave a Promise
  pending forever.

### 6. Tests Required

- Resolution tests assert separate CLI/Desktop candidates, CLI default,
  Desktop fallback, dynamic variant, duplicate-path removal, case-insensitive
  Windows comparison, and macOS/Windows bundle paths.
- Process tests assert script entries use the current Node executable.
- Codex adapter tests assert process normalization, protocol timeout, pending RPC
  settlement, turn settlement, and child error/exit behavior.
- ZCode adapter tests assert create/subscribe/two sends/close, normalized
  thinking/text/tool/turn events, streamed-text fallback, and actionable errors.
- Security tests assert provider and platform credentials are absent from argv
  and logs; platform credentials are present only in the MCP protocol `env`.
- Packaging checks assert every adapter helper is included in the daemon bundle.
- Real macOS smoke tests run both bundled runtimes with standalone CLIs removed
  from `PATH`; Windows remains covered by automated path/process tests until a
  Windows smoke host is available.

### 7. Wrong vs Correct

#### Wrong

```js
if (fs.existsSync('/Applications/ZCode.app')) {
  return { command: 'zcode', variant: 'desktop' }; // GUI shell is not executable
}
```

```js
mcp.args.push('--daemon-token', daemonToken); // secret becomes process metadata
```

#### Correct

```js
const runtime = resolveRuntimeCandidate({
  cliCommand: 'zcode',
  desktopPaths: zcodeDesktopRuntimePaths(),
  existingFile,
  commandVersion,
});
```

```js
mcp.env.push({ name: 'DI_AGENT_DAEMON_TOKEN', value: daemonToken });
// The MCP config itself is sent to the desktop app-server over stdin.
```

## Scenario: Per-turn Codex execution controls and human approval

### 1. Scope / Trigger

Use this contract when the chat composer selects a Codex model, reasoning effort,
or approval mode for a single Agent turn.

### 2. Signatures

- Message request: `runtime_config: { version: 2, model, reasoning_effort, approval_mode, service_tier }`
- Allowed models: default (`""`), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`
- Allowed efforts: `low`, `medium`, `high`
- Allowed approval modes: `request`, `auto`, `full`
- Allowed service tiers: `default`, `priority`; v1 requests migrate to v2 with
  `default`. `gpt-5.4-mini` and `gpt-5.3-codex-spark` do not advertise
  `priority` in the current Codex model catalog and must not send it.
- Daemon events: `task.approval_required`, `task.approval_decision`
- Browser events: `agent.approval_required`, `agent.approval_resolved`
- Daemon capability: `agent_runtime_controls_v2` (the daemon may also advertise
  v1 for backward server compatibility, but a v2 server requires v2).

### 3. Contracts

- The backend normalizes omitted values to default model, medium effort, and
  `auto`; it rejects unknown strings before creating a daemon task.
- Only an omitted v0 config or a service-tier-free v1 config may migrate to v2;
  a legacy/versionless payload that already contains `service_tier` is malformed
  and must be rejected instead of silently changing its meaning.
- Runtime controls are snapshotted on the in-memory task and forwarded in every
  dispatch path. Arbitrary CLI flags are never accepted from the browser.
- The persistent Codex adapter passes model, effort, service tier, approval
  reviewer, and sandbox policy through `turn/start`.
- After a terminal turn notification and before reporting the turn result, the
  Codex adapter calls `thread/resume` with `excludeTurns: true`; its response is
  the source of truth for the model, reasoning effort, and service tier applied
  to that turn. Log requested/applied allowlisted values with a matched,
  mismatch, or unverified status; never log prompts, credentials, or MCP
  environment values. Applied values outside the model/effort/service-tier
  allowlists are recorded only as `unknown` and can never produce `matched`.
  Missing or failed resume evidence remains unverified, and repeated terminal
  notifications must not repeat verification or turn completion.
- `request` routes approval to the authenticated user; `auto` uses Codex automatic
  review inside workspace-write sandbox; `full` is the only mode that requests
  danger-full-access.
- Every approval ID is bound to the originating machine, task, user, and
  conversation, expires within five minutes, and can be consumed only once.
- A browser decision is accepted only from an authenticated member who is also
  the task owner. Timeout and transport failure decline safely.

### 4. Tests Required

- Frontend tests cover normalization/persistence, composer actions, and approval
  event visibility. API serialization tests assert the exact v2
  `runtime_config` request body including `service_tier`.
- Service tests cover safe defaults, supported values, and raw-flag rejection.
- Backend dispatch tests marshal the outgoing `task.dispatch` WebSocket frame
  and assert the normalized v2 runtime config survives both immediate message
  dispatch and queued daemon dispatch.
- Daemon adapter tests cover `turn/start` controls, authoritative
  `thread/resume` applied-setting evidence, mismatch/unverified fallback,
  duplicate terminal notifications, and approval response mapping.
- WebSocket tests cover owner binding and one-time consumption.

## Scenario: Local Skill catalog and reply execution trace

### 1. Scope / Trigger

Use this contract when changing Skill discovery, registration, task context,
local loading, tool events, or the reply's execution-trace drawer. A scanned
catalog entry is not evidence that the current turn loaded or used that Skill.

### 2. Signatures

- Registration: `DiscoveredAgent.capabilities: DiscoveredSkill[]`, persisted in
  `capabilities_json`; both system-Agent and machine-candidate registrations
  apply the same catalog allowlist.
- Index fields: `name`, `description?`, `usage?`, `trigger?`, `category?`,
  `source_path`, `auto?`. Automatic registration never includes `detail`.
- Context: `BuildLocalSkillContext(capabilitiesJSON)` is independent of
  `BuildAgentSkillContext(customSkills)`.
- Local MCP loader: `get_agent_skill({name: string})`. Pass only the indexed
  name; caller-supplied filesystem paths are not loader arguments.
- Transport: existing `tool_use` / `tool_result` events gain optional
  `tool_kind: "mcp" | "skill" | "tool"`, `skill_name`, `server_name`, and
  `source_path`. `MessageBlock` retains these fields in `blocks_json`.
- Trace boundary: daemon `createToolTrace(skills)` and backend
  `SanitizeToolTraceEvents(events, previousBlocks)`.

### 3. Contracts

- A local entry requires a real discovered source path. Empty discovery stays
  empty; generic `coding`/`review` capabilities must not fill the catalog.
  Older daemon `detail` fields are stripped at both registration endpoints.
- The server receives purpose and loading instructions. The local loader finds
  the indexed name, reads the full local file, and falls back to assigned
  platform Skills only when the local catalog has no match. Existing platform
  library, assignment, and installation actions remain separate explicit actions.
- Runtime adapters preserve native invocation IDs. Both `toolUseID` and
  `tool_use_id` remain accepted at input boundaries. Partial inputs with IDs
  update the matching invocation; an unknown ID must not modify another call.
- Daemon tool-result `output` is a string; structured MCP output is JSON encoded.
  Backend accepts native structured outputs from older senders and normalizes
  them, rather than rejecting the entire event batch.
- The runtime receives local Skill content; the transmitted trace receives
  metadata and load success/failure only. Sanitize before both live broadcast
  and persistence. Compound commands that reference known local Skill paths
  may have output redacted without being classified as a proven Skill load.
- A final task result must not fall back to raw structured stdout containing
  tool bodies. Codex's missing-output-file fallback extracts final assistant
  messages, not protocol transcripts. This transport rule does not constitute
  a detector for arbitrary content the model repeats in its authored reply.
- The Skills page uses a compact top Agent selector and defaults to local
  Skills. Reply prose is unchanged: `查看执行链路` opens a separate drawer.
  The drawer derives ordered records from actual tool blocks, preserving
  inputs, result metadata, and errors across refresh.
- Successful discovery, a prompt recommendation, or model prose cannot mark a
  Skill as used. Only matched result evidence marks a call successful/failed;
  a call without a result is running during streaming and unconfirmed after
  completion. A tool failure does not terminate the whole reply stream.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Legacy capability has no source path | Excluded from local catalog/context |
| Legacy registration includes full `detail` | Body omitted from stored catalog |
| Local loader name absent locally and in assigned platform Skills | Tool failure, no fabricated successful load |
| Local Skill read fails | Failure metadata, no body upload |
| Native result output is an object | Normalize to JSON string; keep surrounding events |
| Partial input references unknown invocation ID | Ignore it; do not append to another tool |
| Call has no matching result when reply completes | Unconfirmed, not successful |
| Local count > 0, assigned platform count = 0 | Local list is still the primary visible content |

### 5. Good / Base / Bad Cases

- Good: a local Skill is indexed without its body, loaded in the local runtime,
  and shown as successful in the reply drawer after an actual result event.
- Base: an old reply has no tool blocks; do not infer calls from its prose.
- Bad: uploading `SKILL.md` through registration or a raw tool-result fallback;
  displaying a selected catalog entry as an executed Skill; attaching parallel
  input fragments to the latest tool merely because it was rendered last.

### 6. Tests Required

- Registration tests cover both endpoints and assert that body text and the
  `detail` key are absent while purpose/source remain.
- Context tests use local Skills with no platform assignment and assert local
  purpose, usage, and name-only loading instructions.
- Adapter tests cover actual native IDs, MCP structured outputs, failed loads,
  partial parallel inputs, conservative redaction, and final-result fallback.
- Backend tests cover object-output decoding, exact-ID input routing,
  cross-batch redaction, and metadata persistence without terminating on tool errors.
- Cross-language verification feeds actual daemon-generated camelCase events
  through the Go sanitizer/reducer, then compares frontend records from raw
  events, outgoing events, and persisted blocks: IDs/types/statuses must match
  and private local bodies must be absent.
- Browser acceptance checks local-first layout/search, compact selection,
  separate reply drawer, and reload replay. A fixture test is not evidence that
  a production Agent executed a real tool.

### 7. Wrong vs Correct

```js
// Wrong: the skill body becomes a server-side catalog entry.
return { name, source_path, detail: fs.readFileSync(source_path, 'utf8') };
// Correct for automatic discovery: describe how to load the local entry.
return { name, source_path, description, usage: 'Call get_agent_skill with name.' };
```

```go
// Wrong: assumes the last rendered call owns every partial input.
blocks[len(blocks)-1].Text += inputDelta
// Correct: correlate by native ID; an unknown ID cannot fall back to another call.
if blocks[i].ToolUseID == event.ToolUseIDOrAlt() {
    blocks[i].Text += inputDelta
}
```

### Observed timing for visual trajectories

`AgentEvent.ts` is an ISO timestamp observed at the daemon event boundary before
batching (preserve native timestamps when supplied). It is not a claim about the
runtime's unobserved internal start time. Reducers preserve optional RFC3339
`MessageBlock.started_at` / `ended_at` strings in live state and history JSON.
Text blocks span their first and last observed public delta; tool calls start at
their start event and end only at the result with the same invocation ID. Input
fragments must not reset start time. Terminal task events must not invent tool
completion. Missing legacy timestamps stay absent. The visual trajectory must
fall back to order-only bars and never derive duration from token/text length.
