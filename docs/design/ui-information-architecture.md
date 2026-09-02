# Di Agent Gate 3 — information architecture and low-fidelity structure

> Presented: 2026-08-27  
> Status: Gate 3 approved on 2026-08-27  
> Boundary: structure only; no polished visual styling, prototype, dependency, or production edit

## 1. Product hierarchy

The Web application uses three stable structural levels:

1. **Global level** — product identity, route navigation, create/search entry, account and system status.
2. **Workspace level** — route-specific navigation, views, filters, lists, and page actions.
3. **Context level** — current conversation, Task, Agent, report row, artifact, or configuration detail.

Do not introduce another permanent navigation level. Secondary navigation becomes frameless tabs, an inspector, a popover, or a dedicated route.

## 2. Route map

```text
Di Agent
├── Messages                     /
│   ├── Favorites
│   ├── In-progress Tasks
│   ├── Project/Task groups
│   ├── Recent conversations
│   └── Current conversation
├── Contacts                     /contacts
│   ├── People
│   └── Groups
├── Agents                       /agents
│   ├── Agent roster
│   ├── Runtime overview
│   ├── Agent detail
│   └── Create/configure Agent
├── Skills                       /skills
│   ├── Installed
│   ├── Available/downloadable
│   └── Skill detail
├── Knowledge                    /knowledge
│   ├── Sources/files
│   ├── Search/RAG
│   └── Preview/detail
├── Tasks                        /tasks
│   ├── Active
│   ├── Completed/history
│   ├── List/board projection
│   └── Task inspector
├── Reports                      /reports
│   ├── Shared dashboard
│   ├── Exact DUID search
│   ├── Admin detail/history
│   └── Admin report/source setup
└── Settings                     /settings
    ├── Account
    ├── Appearance/accessibility
    ├── Connections
    └── About/system
```

Routes remain unchanged. The hierarchy above controls navigation labels and in-page organization only.

## 3. Global application shell

### Persistent elements

- compact global icon rail;
- active route marker;
- global create/search entry;
- connection/offline state;
- account/settings entry;
- active work surface;
- compact Task-status capsule when a Task is active or needs attention.

### Overlay-expanded rail

- Pointer approach or keyboard focus expands the icon rail over the active page.
- Expansion reveals `Di Agent` wordmark, route labels, unread counts, connection detail, and account label.
- The main page never changes width or position.
- Moving focus/pointer into the active page collapses it after a short safe delay; open menus prevent accidental collapse.
- On 1024–1199 px the same overlay behavior remains; it does not become a permanently wide sidebar.

### Global action model

- `New`/create and global search/command remain globally reachable.
- Route-specific primary actions stay in the page header action cluster.
- Do not duplicate a route action in the rail, page header, and content body unless one instance is a deliberate empty-state recovery.

## 4. Pilot: Messages/chat workspace

### Wide structural grid (1440 px and above)

```text
outer warm canvas / inset app frame
┌──────┬──────────────────┬─────────────────────────────────────────┐
│ rail │ conversation     │ active conversation                     │
│ 56px │ list             │                                         │
│      │ 272–304px        │ header / participants / actions         │
│      │                  ├─────────────────────────────────────────┤
│      │ favorites        │ transcript/document flow                │
│      │ running tasks    │                                         │
│      │ project groups   │ user bubble                             │
│      │ recent chats     │ agent document response                 │
│      │                  │ collapsed tool/activity blocks          │
│      │                  │                                         │
│      │                  │             floating composer           │
└──────┴──────────────────┴─────────────────────────────────────────┘
                                          ┌────────────────────────┐
                                          │ optional 400px         │
                                          │ Task/Agent inspector   │
                                          └────────────────────────┘
                              [Task capsule / progress utility]
```

### Above-the-fold priority

1. Current conversation identity and Agent running/attention state.
2. Latest relevant messages and current streaming output.
3. Composer and its send/stop state.
4. Running Task capsule/progress.
5. Conversation switching and search.
6. Secondary participants, files, artifacts, and activity detail.

The composer and current running state may never be obscured by decorative or persistent floating content.

### Conversation-list structure

```text
Conversation panel
├── Search / filters / new conversation
├── Favorites
├── In progress
│   └── Task-linked conversations with live status
├── Projects / Task groups
│   └── Collapsible conversation groups
└── Recent
    ├── Today
    ├── Yesterday
    └── Earlier
```

Rules:

- Hide an empty section rather than showing multiple empty placeholders.
- A conversation appears once in the visual list even if it qualifies for several categories; priority order is Favorite → In progress → Project/Task group → Recent.
- Search results flatten grouping and show a short source/path label.
- Whole rows open the conversation.
- Pin/favorite, unread, task state, overflow, and destructive actions have independent controls.
- Row summary is limited to identity/title, one compact preview/status line, unread/time, and optional live Task state.
- Long titles truncate in the list but remain available in a tooltip/accessible name and full header.

### Conversation header

- Left: avatar/type, title, participant or Agent identity, compact running/offline/attention state.
- Right: frameless/floating controls for search, participants, files/artifacts, Task/Agent inspector, and overflow.
- No full-width bordered header card.
- Secondary properties move into the right inspector rather than adding another header row.

### Message flow

```text
date/context boundary
user prompt bubble
agent response document
├── response body
├── collapsed thinking/tool/activity summary
├── artifacts/files/diff as inline summary cards
└── response actions on hover/focus
```

Rules:

- User prompt uses a compact bubble aligned within the transcript measure; it does not occupy the full row by default.
- Agent response is a continuous borderless document surface.
- Tool calls and full information flow display a one-line summary with status, duration, and disclosure control.
- Opening a disclosure expands in place and preserves transcript position.
- Large artifacts can open an inspector/workspace without replacing the conversation.
- Streaming, canceled, partial, error, and retry states remain attached to the relevant response.
- Do not use avatars on every paragraph or repeated message-group ornament.

### Composer

```text
┌───────────────────────────────────────────────────┐
│ context / attachment chips (only when present)    │
│ expanding text editor                             │
│ attach  tools/context         model     send/stop │
└───────────────────────────────────────────────────┘
```

- Lightly floats above the transcript bottom with a readable opaque fallback.
- Grows upward until a capped height, then scrolls internally.
- Draft stays scoped to its conversation and survives conversation switching where supported.
- Context, Skills/MCP, attachments, and model choices stay in the utility row or contextual popovers.
- Send is the sole high-emphasis control; while generating, it changes to an explicit stop state.
- Composer spacing accounts for the Task capsule/window collision zone.

### No-conversation and empty states

- No active conversation: centered, concise start state with recent Agents and one primary `新建对话` action; no decorative marketing hero.
- Empty conversation: focus the composer and provide short, real prompts/actions relevant to the selected Agent.
- No search result: retain query and offer `清除筛选` or `新建对话` as appropriate.
- Permission/offline/error states remain local to the affected action where possible.

## 5. Chat-to-Task projection

### Creation boundary

- A conversation is not itself a Task.
- The first real planning/tool/execution event establishes a Task projection linked to that conversation and Agent session.
- Subsequent related events update that Task until completion/cancel/failure.
- A new distinct execution request in the same conversation may create a new Task; it must not silently overwrite completed history.

### Stable phase structure

```text
Task
├── 理解
├── 规划
├── 执行
│   ├── Agent-generated step
│   ├── tool event / output
│   └── Agent-generated step
├── 验证
└── 完成
```

- Only phases/steps supported by actual events become completed.
- Unknown progress is shown as current phase/indeterminate activity, not a fabricated percentage.
- Error and cancellation stop the relevant step and provide recovery/context.
- Detail links back to the source conversation and relevant message/event.

## 6. Global Task utility

### Compact state

- Appears only for running, attention-needed, recently completed, or user-pinned Task state.
- Shows active count, strongest state, and short current phase.
- Click expands; keyboard Enter/Space has the same behavior.
- It must not look like a permanent navigation tab.

### Expanded state

```text
Task progress window
├── drag/title region                 collapse/close
├── active Task
│   ├── identity + state + elapsed time
│   ├── stable phases/checklist
│   └── current real substep
└── recently completed (maximum 3)
    └── whole row opens detail
                                     resize handle
```

- Default remains smaller than the current large panel.
- Free drag, user resize, position/size persistence, viewport clamping, and subtle edge snapping.
- Window does not expand automatically over user work; completion may update the compact capsule without stealing focus.
- Blocking modal/drawer temporarily suppresses or lowers the utility.
- At 1024 px, collapse is preferred if the window cannot avoid composer/critical actions.

## 7. Task and Agent inspector

### Wide mode

- Docked to the right of the active work surface.
- Default 400 px; resizable 360–560 px; width persists.
- Opening may reduce only the active content region, not the global rail/conversation panel.
- The user can close it without losing Task/transcript state.

### Compact mode

- Overlay drawer with scrim.
- Focus moves to the drawer, remains trapped while modal, and returns to the trigger on close.
- Escape and a named close control dismiss it.

### Task detail hierarchy

```text
Task identity / status / source conversation
frameless tabs: 概览 | 进程 | 产物 | 活动

概览: outcome, Agent, timing, latest summary, recovery/next action
进程: phase + true step timeline and expandable step details
产物: files, artifacts, diffs, deployments and their states
活动: collapsed groups of full event/history information
```

- Running Task defaults to `进程`.
- Completed Task defaults to `概览`.
- Failed Task exposes the failed phase and recovery action without hiding completed work.

### Agent detail hierarchy

- identity and real connection/runtime state;
- current and recent work;
- configuration/permissions appropriate to the role;
- Skills/MCP/knowledge associations;
- diagnostics/history only when authorized.

## 8. Other route structural contracts

These contracts guide later route migration; they are not part of the first production pass.

### Tasks

- Frameless view switch between active/history and list/board projection.
- Entire Task block opens the same inspector model used in chat.
- Filters/display/saved-view controls remain separate concepts.
- Bulk actions appear only after selection.

### Reports

```text
page title + admin-only action cluster
global filter row: report / cities / time range / applied state
summary metrics: 4–5 essential metrics only
trend chart: price-sensitive users / orders / GMV / ordering users
distribution and supporting charts
exact DUID search
admin-only full detail / run history / configuration
```

- Normal users never receive the admin detail table shell.
- The latest usable report remains visible during background refresh with a stale/refreshing indicator.
- Chart legends toggle series; axes and tooltips use business units and event time.

### Agents

- One real status summary, not decorative statistics.
- Search/filter and create action remain visible.
- List/roster is the primary work surface; detail/configuration opens in a dedicated inspector or modal according to complexity.
- Skill/MCP select-all is explicit and reversible.

### Skills, Knowledge, Contacts, Settings

- Use continuous list/table surfaces for collections.
- Use inspectors for quick detail; full editors/routes for complex content.
- Avoid nesting multiple card grids.
- Settings uses a category rail only within the page and never duplicates the global route rail.

## 9. Responsive structure

### 1440 px and wider

- 12–16 px outer inset and lightly rounded app frame.
- Compact global rail.
- 272–304 px conversation list.
- Chat occupies remaining space.
- Inspector can dock if open.
- Task utility can float subject to collision rules.

### 1200–1439 px

- Outer inset reduces progressively.
- Conversation list stays visible but may narrow toward 256–280 px.
- Inspector docks only if the chat retains a usable reading/composer width; otherwise overlays.
- Secondary header controls collapse into overflow.

### 1024–1199 px

- Full-bleed application frame.
- Compact overlay-expanding global rail.
- Conversation list narrows or becomes a user-toggleable panel when the inspector opens.
- Inspector is an overlay drawer.
- Tables preserve horizontal scroll.
- Expanded Task window reclamps or collapses to its status capsule.

### Below 1024 px

- Not a full supported workflow in this phase.
- Maintain sign-in, basic navigation, reading, and critical close/recovery access where practical.
- No promise of phone-equivalent data table/board editing.

## 10. Overlay and focus stack

From lowest to highest:

1. base work surface;
2. overlay-expanded navigation rail;
3. docked inspector;
4. Task capsule/expanded utility;
5. contextual popover/menu/tooltip;
6. nonblocking drawer;
7. blocking modal and scrim;
8. critical system/permission confirmation.

Rules:

- A child popover follows its owning surface but cannot render above an unrelated blocking modal.
- Escape closes only the highest dismissible layer.
- Closing restores focus to the opener.
- Background scroll/focus is blocked only for modal layers.
- Toasts do not cover the composer, primary action, or dialog controls.

## 11. Structural states

### Loading

- Shell stays mounted.
- Preserve the last usable conversation/report where safe.
- Skeletons preserve known list/table geometry.
- Agent work uses streaming/current-phase feedback rather than a page spinner.

### Empty

- Distinguish no data, no selection, and zero filter result.
- Explain why and offer one relevant next action.

### Error and partial

- Attach error to the failed response, Task step, row, chart, or panel.
- Preserve successful/partial content.
- Offer retry, reconnect, return, or permission guidance as appropriate.

### Permission denied

- Hide unrelated admin navigation/actions.
- Direct access to a restricted route/panel yields a clear permission response and safe return path.

### Offline/reconnecting

- Keep existing local content available.
- Show one persistent but compact connection state.
- Avoid repeated duplicate toasts while reconnection continues.

## 12. Structural acceptance criteria

- One permanent global navigation system.
- No layout shift when the rail expands.
- Conversation, composer, and Task status remain reachable at every supported width.
- The right inspector never becomes a second independent application shell.
- Full activity/details remain accessible without dominating the default view.
- Whole-row activation and nested actions have unambiguous hit targets.
- Task progress reflects real execution events.
- Overlay order and Escape/focus behavior are deterministic.
- No route, permission, API, or data contract changes are implied by the structure.
- Gate 4 can define tokens without changing page hierarchy.

## 13. Gate effect

Gate 3 was approved on 2026-08-27, locking the page hierarchy, pilot layout, information order, panel roles, responsive structural behavior, overlay order, and Task/chat projection described here. It authorizes preparation of exact visual tokens and component-language proposals for Gate 4 only. It does not authorize polished prototype or production implementation.
