# Di Agent Web UI redesign brief

> Gate 1 approved — 2026-08-27  
> Status: requirements approved; production UI implementation is not authorized

## 1. Design read

Di Agent is a multi-Agent operational workspace for internal employees and external enterprise users; the redesign must make agent collaboration, task supervision, data reporting, and administration feel fast and trustworthy through a bright, color-neutral Codex-style workbench with Apple-like material precision and motion.

## 2. Outcome and scope

### Confirmed outcome

- Remove the current unfinished, template-like, card-heavy feeling.
- Improve brand credibility without reducing operational density.
- Make chat-to-task execution understandable at a glance and inspectable in detail.
- Make high-volume data and reports readable, interactive, and permission-aware.
- Establish one reusable UI system for later page-by-page migration.

### Full redesign scope, delivered in phases

Existing Web routes remain in product scope:

- `/` — messages, private Agent chat, group chat, task-linked execution;
- `/contacts` — contacts and groups;
- `/agents` — Agent roster, status, creation, configuration, Skills/MCP;
- `/skills` — Skill discovery and management;
- `/knowledge` — knowledge files and RAG surfaces;
- `/tasks` — Task list/board/history/detail;
- `/reports` — shared analytics, DUID search, admin detail and configuration;
- `/settings` — account, appearance, platform settings;
- `/login`, `/register`, and not-found/auth states.

### First production pilot

- Global Web application shell.
- Messages/private Agent chat workspace.
- Conversation list and hierarchy.
- Chat composer and message rendering.
- Global task-progress capsule/window.
- Right-side Task/Agent inspector.

The pilot defines the reusable visual system; remaining routes migrate only after the pilot is visually and behaviorally accepted.

### Must preserve

- Current routes, URLs, APIs, WebSocket contracts, permissions, data, analytics hooks, and business behavior unless a separately approved functional change is named.
- Authentication and `is_admin` authorization model.
- Existing Agent, conversation, group, attachment, artifact, knowledge, Task, and reporting workflows.
- Existing keyboard operations such as new conversation/search where they remain valid; the final shortcut map may reorganize presentation but not silently remove capabilities.
- Real data must remain real. Do not fabricate metrics, curves, customer logos, task progress, or Agent state.
- User work, drafts, partial output, completed task detail, and recoverable errors must not disappear during navigation or refresh.

### Permitted structural changes

- Reorder navigation and page content.
- Collapse secondary information and expose it through inspectors, drawers, popovers, or full-detail routes.
- Replace large framed tab groups with frameless labels and compact active markers.
- Convert current fixed panels into collapsible, resizable, or overlay forms at the approved breakpoints.
- Replace visual wrappers and iconography while preserving component contracts.

### Out of scope for the current phase

- Native mobile, tablet-specific, iOS, or Android application design.
- A fully open-ended dashboard/report builder.
- Replacing Hive/data-service APIs or changing company data definitions.
- Rewriting permissions, account provisioning, or admin policy.
- Copying Apple, OpenAI, Linear, Attio, or Collective OS brand assets, logos, proprietary icons, copy, or fake metrics.
- Dark theme redesign; the active direction is light.
- Broad production edits before Gate 7.

## 3. Users and permissions

### Internal/admin user

Primary jobs:

- supervise Agents and tasks;
- inspect full execution detail and activity history;
- configure Agents, Skills, MCP, knowledge, and reports;
- view shared dashboards, run history, full report detail, and report/data-source configuration;
- search exact DUID records.

Visible/editable information:

- all standard shared product information;
- admin-only report detail, run history, configuration, and management controls;
- Agent/resource administration appropriate to the current backend policy.

### Standard/external enterprise user

Primary jobs:

- use permitted Agents and conversations;
- monitor their running work and Tasks;
- view shared report summaries and interactive charts;
- perform permitted exact DUID search.

Restricted information:

- no full report-detail browsing;
- no report run history or report/data-source configuration;
- no admin-only controls or hidden placeholders that imply access.

When access is restricted, the UI shows only permitted summary/search functions. It does not render disabled admin shells full of locks.

### Accessibility users

- Keyboard-only users must be able to navigate, expand, select, drag alternatives, resize alternatives, and close overlays.
- Reduced-motion users receive the same state information without travel, spring, or continuous animation.
- Screen-reader users receive announced Agent/task state and semantic control names.

## 4. Primary journeys

### 4.1 Enter and switch conversations

1. User enters the product through the global shell.
2. The compact icon rail can expand as an overlay without moving content.
3. The conversation list shows favorites and running tasks first, then project/task groups, then uncategorized recent conversations.
4. Search and filters operate across all groups.
5. Selecting a conversation loads it without rebuilding the shell or losing drafts.

### 4.2 Chat with an Agent

1. User composes in a lightly elevated bottom composer.
2. Attachments, model, Skills/MCP, and context controls remain secondary to writing.
3. User messages render as compact bubbles.
4. Agent responses render as a borderless document flow.
5. Tool calls, reasoning, execution events, and the complete information stream are preserved but collapsed by default.
6. Cancel/failure preserves partial output and offers retry or recovery where supported.

### 4.3 Chat becomes a Task

1. Ordinary question-and-answer chat remains chat-only.
2. When the Agent enters planning, tool use, or actual execution, the system creates a Task automatically.
3. Later events in that private conversation update the same Task.
4. The global status capsule shows the running/attention/completed state.
5. Expanding the capsule opens the draggable/resizable Task window.
6. The window shows stable high-level phases with true Agent-generated substeps and execution detail.
7. Actual execution state controls checkmarks; no invented progress curve or percentage.

### 4.4 Inspect Task detail

1. The whole Task row/card opens detail; nested action controls do not double-trigger it.
2. A right inspector opens at about 400 px and can resize from 360–560 px.
3. Frameless tabs organize `概览 / 进程 / 产物 / 活动`.
4. Running tasks open `进程`; completed tasks open `概览`.
5. Activity remains collapsed by default and can be expanded without losing scroll/context.
6. At compact width the inspector becomes an overlay drawer with focus trapping and return focus.

### 4.5 Use Task progress peripherally

1. Default state is a compact global status capsule, not a large window.
2. Expanded window is freely draggable and resizable, remembers geometry, and uses subtle magnetic edge snapping.
3. It may not cover the global primary action, chat composer, blocking modal, or browser safety margins after viewport changes.
4. It lists the current task plus three recent completed Tasks.
5. Full history remains on `/tasks`.

### 4.6 Reporting, later migration phase

- All permitted users can view shared report summaries and charts.
- Standard users can perform exact DUID search but cannot browse full detail or run/configuration history.
- Admins can browse complete detail, history, report configuration, and data sources.
- Page-level filters include one or more cities and a time range.
- Summary metrics include total users, total orders, users with a price-sensitivity result and its proportion, and high/medium/low sensitivity distribution.
- Trend dimensions include price-sensitive users, orders, GMV, and ordering users, with one-week, one-month, and one-year ranges.
- Trend x-axis represents business order/event time supplied by the API (for example `toc_charge_s_time`), not a partition/run date such as `dt`.
- If historical business-time data is unavailable, show an explicit unavailable/pending state instead of a decorative fake curve.
- Charts provide hover detail, click-to-toggle series, legible legends, and clear axis units.
- Scheduled initialization remains daily at 10:00; any manual test/run action is an admin control.

### 4.7 Agent administration, later migration phase

- The Agent overview must represent real backend state, not staged statistics.
- Agent creation supports select-all for Skills and MCP interfaces.
- Local Skill installation/downloading remains a controlled admin workflow with explicit progress, source, failure, and permission states.

## 5. Reference matrix

| Reference | Role | Extract | Reject / do not copy |
| --- | --- | --- | --- |
| Codex | Primary workbench character | Color-neutral shell, operational calm, continuous task/chat surfaces, compact controls, agent activity as a normal state | OpenAI marks, exact assets, brand copy, or a direct clone |
| Apple HIG | Material, typography, feedback | Light materials, platform-native type, precise contrast, restrained spring/easing, clear focus and hierarchy | Consumer-scale whitespace everywhere, glass on every surface, Apple logos/SF assets copied into Web |
| Linear | Navigation and task operations | Quiet collapsible chrome, compact hierarchy, selection/keyboard model, docked inspector, task/list discipline | Dark palette, unreadably dim chrome, tiny text, issue-tracker vocabulary |
| Attio | Data and control behavior | Continuous tables, inline operations, filters/saved views, overlay hierarchy, contextual command/search clarity | CRM ontology, colored pills everywhere, enormous composer on unrelated pages |
| Collective OS demo | Mood reference only | Bright commercial framing, selected floating modules, warm outer canvas, light depth | Production behavior assumptions, fake dashboard data, pervasive large radii, demo-only responsiveness, copied assets |

Full evidence: [ui-reference-deep-dive.md](ui-reference-deep-dive.md).

## 6. Information hierarchy

### Global shell

1. Compact global icon rail.
2. Overlay expansion on pointer approach or keyboard focus; no main-content reflow.
3. Frameless page title/location aligned to the content grid.
4. Small floating action cluster to the right rather than a framed full-width header.
5. Main route work surface.
6. Optional right inspector or transient overlay.
7. Global Task status capsule above the normal surface stack.

### Chat pilot at wide width

```text
┌──────────────────────────────────────────────────────────────────┐
│ compact/overlay rail │ conversation list │ active conversation   │
│                      │                   │                ┌─────┐│
│                      │                   │                │opt. ││
│                      │                   │                │insp.││
│                      │                   │                └─────┘│
│                      │                   │ floating composer     │
└──────────────────────────────────────────────────────────────────┘
```

- Primary: active conversation and composer.
- Secondary: conversation navigation and compact task status.
- Collapsible: tool events, reasoning, full activity stream, secondary metadata.
- Inspector: Task/Agent overview, progress, artifacts, activity.
- Separate route: complete Task history and large administration surfaces.

## 7. Visual direction and provisional tokens

Exact accessible values are a Gate 4 decision. Gate 1 confirms roles and relationships only.

### Color roles

- Outer canvas: very light warm gray.
- Work canvas and persistent surfaces: neutral white.
- Primary text/actions: graphite black.
- Secondary and tertiary text: neutral grays that remain readable at the confirmed sizes.
- Links/focus/explicit selection: system-like blue, not a decorative brand wash.
- Single-series charts: graphite plus blue.
- Multi-series/semantic expansion: muted green, orange, and red only when required by meaning.
- No blue-purple gradients, decorative glow fields, or section-by-section background colors.

### Typography

- Platform-native Web stack: SF on Apple platforms, Segoe UI on Windows, compatible system fallbacks elsewhere.
- Chinese text uses the platform's native Chinese UI family.
- Tabular numeric features for metrics, durations, dates, table values, and charts.
- Operational floor: 12 px metadata; primary row/body generally 13–15 px; page title generally 20–24 px; display sizes reserved for true overview moments.

### Density and geometry

- Balanced Codex-like density.
- 4 px base spacing with an 8 px major rhythm.
- Control radius around 8 px.
- Persistent panel radius 10–12 px.
- Floating/transient layer radius around 16 px.
- Pills limited to tags, status, avatars, and compact segmented controls.
- Tabs are frameless with a short underline or compact marker.

### Iconography and brand

- Lucide-like neutral line icons, normalized viewport, approximately 1.75 px stroke.
- Product name is `Di Agent` everywhere user-facing.
- Brand signature is a minimal geometric mark plus wordmark; mark can stand alone in the collapsed rail/favicon/status contexts.
- Do not use a robot emoji/mascot as the primary product mark.

## 8. Material and floating-layer rules

### Flat persistent surfaces

- navigation rail;
- conversation list;
- tables and report bodies;
- reading/document surfaces;
- docked inspectors.

These use background contrast and hairline separators, not continuous blurry shadows.

### Lightly translucent/elevated surfaces

- top action cluster;
- command palette and contextual popovers;
- chat composer;
- transient menus/dialogs;
- Task status capsule and expanded progress window.

Rules:

- translucency must retain text contrast over real content;
- no more than one large floating utility plus transient menu/popover at once;
- blocking dialogs always outrank utilities;
- floating utilities avoid critical controls and reclamp after resize;
- at compact width, inspectors become drawers and nonessential floating modules collapse to their compact trigger;
- only the Task utility is user-draggable in the initial pilot.

## 9. Component and state contract

Every interactive family defines:

- default;
- hover without layout movement;
- pressed/active;
- keyboard highlight;
- visible `focus-visible`;
- selected distinct from current/active;
- disabled with a discoverable reason when needed;
- loading that preserves geometry;
- empty with a reason and one next action;
- error attached to the failed item with recovery;
- quiet success that does not block the workflow.

Specific rules:

- Whole Task blocks and eligible conversation rows are clickable; nested controls retain independent hit targets.
- Hover-only actions must also be keyboard reachable.
- Destructive actions require a scoped confirmation and preserve context after cancellation.
- Agent running/attention/completed/failed state is expressed through text/icon plus color, never color alone.
- Long-running operations use real phase/substep state and elapsed time; no fake percentage.
- Filter-empty, true-empty, permission-denied, stale, partial, and failed states are distinct.
- On cancel/error, keep drafts and available partial Agent output.

## 10. Motion language

- Overall intensity: restrained, approximately 3/10.
- Row hover/selection: immediate or no more than about 100–140 ms.
- Controls: about 120–160 ms.
- Menus/popovers: about 160–200 ms, opacity plus no more than 4 px travel.
- Inspector/drawer: about 200–260 ms ease-out.
- Drag/resize: direct 1:1 pointer tracking; subtle spring only after release/snap.
- Charts: smooth change between valid data states, no decorative autoplay.
- Running Agent indicator: low-amplitude and active only while work is running.
- Reduced motion: remove travel, continuous pulse, and spring while retaining text, icon, and progress state.

## 11. Responsive and accessibility behavior

### Web widths

- `≥1440`: 12–16 px warm outer inset, lightly rounded inner app frame, full conversation list, optional docked inspector.
- `1200–1439`: reduce gaps; inspector remains docked only when content width stays usable.
- `1024–1199`: full-bleed app, compact icon rail, secondary actions move to overflow, inspector becomes overlay, tables scroll horizontally.
- `<1024`: basic accessibility only in this phase; full mobile workflow is out of scope.

### Required behavior

- No fixed 1440 px canvas.
- Do not convert data tables into unrelated cards merely to fit width.
- Preserve title, primary action, filter state, running-task state, and composer at every supported width.
- Validate keyboard-only use, 200% zoom, Chinese/English mixed content, long titles, and null/partial data.
- Minimum interactive target follows accessible Web practice; compact visual controls can use a larger invisible hit area.
- Contrast target: WCAG AA for normal text and essential state indicators.

## 12. Technical plan and protected contracts

### Existing stack

- React 18, TypeScript, Vite, React Router, Zustand.
- Ant Design 6 and Ant Design icons.
- CSS Modules plus existing global styles.

### Confirmed migration boundary

- Build custom global shell, chat, Task utility, inspector, and high-frequency primitives.
- Retain Ant Design behavior temporarily for complex tables, dates, forms, modals, and selects behind a new semantic token/component wrapper.
- Replace Ant Design icons progressively with the approved Lucide-like system inside the redesign scope.
- No component/icon/motion dependency is installed until Gate 4 names and approves it.
- Do not combine visible default Ant Design styling with the custom system on one accepted surface.

### Protected behavior

- React Router paths and guarded-route behavior.
- Zustand state contracts and WebSocket-driven conversation/Agent updates.
- `is_admin` access policy.
- API payloads and field semantics.
- Existing E2E selectors/contracts where still meaningful; update tests deliberately rather than silently removing coverage.

## 13. Validation plan

### Pilot evidence

- 1440×900: full shell, conversation list, chat, expanded inspector, Task capsule/window.
- 1280×800: reduced spacing, panel collision checks.
- 1024×768: full-bleed, overlay navigation/inspector, composer and Task utility collision checks.
- 200% zoom.
- Keyboard-only and reduced-motion passes.

### Required states

- no conversation selected;
- long conversation and long Agent response;
- generating, canceled, partial, failed, retrying, and completed Agent output;
- no Task, running Task, multiple Tasks, three recent completions, failed Task;
- inspector open/closed/resized;
- side rail collapsed/hover expanded/keyboard expanded;
- loading, empty, permission-denied, offline/reconnecting, and error;
- long Chinese/English titles, code, attachments, artifacts, and tool logs.

### Acceptance criteria

- Hierarchy remains clear without card-per-section wrappers.
- Alignment follows one grid and spacing scale.
- No unsupported content overlap at confirmed widths.
- No layout shift when the navigation rail expands.
- No fake task/report data.
- Essential operations are mouse- and keyboard-accessible.
- Visual comparison is performed from rendered screenshots, not code alone.
- Each production pass identifies and fixes the five highest-impact visual/interaction issues before advancing.

## 14. Decision classification

### Confirmed

- Full-product redesign, phased; Web only.
- Pilot shell + chat + Task utility/inspector.
- Preserve business/API/permission contracts.
- Bright neutral palette, graphite primary action, blue focus/link/selection.
- Codex workbench + Apple material/motion.
- Linear navigation/task behavior + Attio data/control behavior.
- Collective OS demo as limited mood reference only.
- System-native typography with tabular figures.
- Balanced density and approved radius/material roles.
- Hybrid chat messages, floating composer, collapsed activity.
- Automatic task creation only when execution starts.
- Stable phases plus real dynamic substeps.
- Compact Task capsule, expandable draggable/resizable edge-snapping window.
- Overlay-expanding icon rail.
- Resizable right inspector.
- Layered Ant Design migration.
- `Di Agent` user-facing brand and geometric mark direction.
- Responsive inset/full-bleed behavior.

### Assumed, low risk

- Exact durations/radii may be adjusted slightly after rendered testing while preserving the approved hierarchy.
- Standard users see shared report analytics plus exact DUID search, while full browsing/configuration remains admin-only, matching current access policy and prior requirements.
- Existing product language remains Simplified Chinese first, with mixed English technical terminology supported.

### Open, intentionally deferred to later gates

- Exact neutral, focus, semantic, and chart color values: Gate 4.
- Exact z-index, shadow, blur, duration, and easing tokens: Gates 4–5.
- Exact geometric brand-mark option: Gate 4/visual prototype.
- Whether a new icon or motion dependency is necessary: Gate 4.
- Rendered visual acceptance: Gate 6.

None of these deferred items changes the approved product requirements or information hierarchy.

### Out of scope

- Native mobile/full phone parity.
- Dark theme redesign.
- Backend/API/data-model redesign.
- Open dashboard builder.
- Production rollout before all applicable gates.

## 15. Approval ledger

| Gate | Status | Scope | Conditions |
| --- | --- | --- | --- |
| 0 — Context audit | approved | Existing code, routes, screenshots, references, dependencies | Read-only audit and research only |
| 1 — Requirements/UI Brief | approved | This document | User replied “开始” to the sole Gate 1 approval question on 2026-08-27 |
| 2 — Reference/design direction | open | Consolidated reference matrix and visual language | Presented after Gate 1 |
| 3 — Information architecture | open | Shell/chat/inspector responsive structure | Presented after Gate 2 |
| 4 — Tokens/component language | open | Exact colors, type, spacing, materials, icons | No dependency install before approval |
| 5 — Interaction/state/motion | open | Complete behavior matrix | Prototype remains isolated |
| 6 — Prototype/visual acceptance | open | Rendered interactive pilot | Separate visual and interaction approvals |
| 7 — Production authorization | open | Named routes/components/files | No production redesign edits before approval |
| 8 — Per-pass implementation | open | Structure, visual, states, polish | Separate review after each pass |
| 9 — Release/rollout | open | Final pilot and later route rollout | Final evidence required |

## Gate 1 summary

Gate 1 approves the product requirements, permissions, preserved behavior, pilot boundary, journeys, and confirmed design constraints in this brief. It does **not** authorize a polished design, dependency installation, prototype, or production UI implementation; those require later, separate approvals. Gate 1 was approved on 2026-08-27.
