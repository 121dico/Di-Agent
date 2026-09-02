# Di Agent UI redesign decision ledger

> Updated: 2026-08-28

## Approval status

- Production UI implementation: **authorized for the approved four-pass local implementation**
- Discovery: **complete**
- Gate 1 consolidated UI brief: **approved on 2026-08-27**
- Gate 6 prototype visual approval: **Variant A approved on 2026-08-27**
- Gate 6 prototype interaction approval: **approved on 2026-08-27**
- Gate 6 intentional deviations: **accepted on 2026-08-27**
- Gate 6 prototype readiness: **approved for production planning on 2026-08-27**
- Gate 7 production authorization: **approved on 2026-08-27**
- Pass 1 structure and information architecture: **approved on 2026-08-27**
- Pass 2 visual system: **approved on 2026-08-27**
- Pass 3 interaction and state presentation: **approved on 2026-08-27**
- Pass 4 motion and responsive polish: **approved on 2026-08-28; local production complete**

## Confirmed decisions

- Scope: full-product redesign delivered in phases.
- Pilot: global application shell plus message/chat workspace.
- Business boundary: preserve existing routes, APIs, permissions, data, and business behavior; information architecture and layout may change.
- Platform: Web only in the current phase.
- Responsive target: design at 1440 px, fully usable down to 1024 px, adaptive between Web widths.
- Product character: premium commercial product for both internal employees and external enterprise users.
- Production shell: Linear-style collapsible global navigation, page hierarchy, and docked detail inspector.
- Data surfaces: Attio-style tables, filters, search, overlays, and information organization.
- Collective OS: visual inspiration only; limited to light tone, spatial depth, and sparing floating showcase layers.
- Theme direction: light only for the current redesign.
- Canvas temperature: neutral-white work surfaces inside a very light warm-gray outer canvas.
- Visual-system direction: Codex-style operational workspace structure and restraint, combined with Apple-style light materials, typographic precision, and motion.
- Global color strategy: color-neutral foundation; the previously proposed teal, cobalt, mineral indigo, olive, oxblood, and brass directions are rejected as dominant brand colors.
- Primary-action color: graphite-black filled controls; system blue is reserved for links, keyboard focus, and explicit selection feedback.
- Data-visualization color: graphite and system blue for the default/single-series case; introduce muted green, orange, and red only when multiple dimensions or semantic states require them.
- Material scope: layered translucency on the top toolbar, command surface, chat composer, transient overlays, and draggable task-progress utility; persistent navigation, tables, report bodies, and reading surfaces remain flat.
- Typography: platform-native Web font stack (SF on Apple platforms, Segoe UI on Windows, with compatible fallbacks); data uses tabular numeric features within the same family.
- Information density: balanced Codex-like density—compact navigation and operational lists, with more breathing room in chat, detail, and reporting surfaces.
- Geometry: 8 px controls, 10–12 px persistent work panels, and about 16 px transient/floating layers; full pills are limited to tags, statuses, and compact segmented controls.
- Motion: high-frequency hover/selection remains immediate; overlays, drawers, dragging, resizing, and chart transitions use restrained Apple-like easing/spring behavior with a reduced-motion fallback.
- Pilot chat layout at wide widths: global navigation + conversation list + active conversation; task and agent details open on demand in a right-side inspector rather than remaining permanently visible.
- Chat message structure: compact bubbles for user prompts; borderless document-flow responses for agents; reasoning, tool calls, execution events, and the full activity stream remain stored but are collapsed by default.
- Chat composer: a lightly elevated, width-constrained bottom composer that grows upward; attachments, model, skills/MCP, and context controls remain in a low-salience utility row.
- Task progress utility: a compact global status capsule by default; expands on demand into a draggable, resizable window that remembers position and dimensions and exposes checklist steps, current stage, details, and a collapsed full activity stream.
- Global navigation at wide Web widths: compact icon rail that expands on pointer hover or keyboard focus and participates in the flex layout, smoothly pushing the conversation workspace instead of covering it.
- Right-side task/agent inspector: 400 px default, user-resizable from 360–560 px with persisted width; becomes an overlay drawer at compact Web widths.
- Component strategy: layered migration. Build custom shell, chat, task-progress, and high-frequency primitives; retain Ant Design behavior for complex tables, dates, and forms behind the new token/component layer, then replace incrementally. No new component library is authorized yet.
- Iconography: Lucide-like neutral line icons with a normalized viewport and roughly 1.75 px stroke; replace Ant Design icons progressively inside the redesign scope after the design-system gate authorizes dependencies.
- Tabs and simple choices: frameless labels with a short underline or compact state marker for selection; bordered pills are not the default.
- Page header: frameless title/location content aligned to the page grid; actions appear as a small floating control cluster rather than a full-width framed bar.
- User-facing product name: `Di Agent` everywhere in the redesigned UI; `AgentHub` remains an internal/compatibility service name only.
- Brand signature: a minimal geometric product mark paired with a `Di Agent` wordmark; use the mark alone in the collapsed rail/favicon/status contexts. Exact geometry awaits visual-option approval and must not imitate Apple/OpenAI marks.
- Browser framing: responsive hybrid. At 1440 px and wider, retain roughly 12–16 px of warm-neutral outer canvas and a lightly rounded inner app frame; progressively remove the inset, reaching full-bleed at 1024 px.
- Conversation organization: hybrid hierarchy—favorites and in-progress tasks first, then project/task groups, with uncategorized conversations arranged chronologically; search and filters span all groups.
- Chat-to-task synchronization: ordinary agent conversation remains chat-only; when an agent enters planning, tool use, or execution, create a task automatically and continue synchronizing that task from the same private conversation.
- Task progress hierarchy: stable top-level phases for scanability, with agent-generated real substeps, tool events, outputs, and errors nested inside; completion checkmarks follow actual execution state rather than an invented percentage.
- Task-progress completion history: current task plus the three most recent completed tasks; each whole row opens detail, while the complete archive remains on the Task page.
- Task inspector organization: frameless `Overview / Progress / Artifacts / Activity` tabs with a short active underline; running tasks open Progress, completed tasks open Overview, and the full activity stream stays collapsed by default.
- Task-progress window movement: freely draggable with subtle magnetic edge snapping; persist snapped/free position and panel size without covering critical controls after viewport changes.
- Production replacement strategy: directly refactor the current UI with no legacy visual branch, feature flag, duplicate route, or hidden fallback. The approved shell/chat/Task surface is replaced first; other protected routes inherit the new global shell and tokens before later page-specific deep redesign.

## Open decisions

- Production file scope and rollout plan remain intentionally deferred to Gate 7.
- 2026-08-28 rail/conversation polish: follow-up corrections delivered locally in persistent default-selection mode; deployment remains out of scope.

## 2026-08-28 rail and conversation polish change request

- Gate 1 — local UI Brief: **approved**. Scope is limited to the global rail's layout relationship, the collapsed create control, and conversation-summary overflow presentation.
- Confirmed trigger: pointer hover and keyboard focus expand the rail; leaving the rail collapses it.
- Confirmed layout direction: expansion participates in the flex layout and pushes the conversation workspace instead of covering it.
- Preserved: routes, APIs, data, permissions, conversation grouping, existing light tokens, and the rest of the approved shell.
- Gate 5 — revised interaction/state/motion: **approved**. Hover intent, flex reflow, collapse grace period, create-control sequencing, summary fade/tooltip, keyboard behavior, and reduced-motion fallback are locked.
- Gate 7 — production change authorization: **approved**. Scope is limited to `GlobalRail`, `ConversationItem`, their local styles, and focused tests; no dependency, route, API, data, or permission change.
- Gate 8 — local patch review: **changes requested by the user and superseded by the follow-up below**.

### Change-request implementation evidence

- Collapsed rail measured at 56 px; the create control is a complete 38×38 px square.
- Expanded rail measured at 224 px; the conversation list moved from x=57 to x=225, and measured overlap remained 0 px.
- Expanded labels no longer produce duplicate icon tooltips.
- Conversation summaries retain the complete source text, use one width-aware 28 px edge fade, and expose the full value through the native title affordance.
- Frontend production build passed. Focused component test passed, and all 111 tests under `src/` passed across 25 test files.
- The repository-wide bare `vitest run` still collects Playwright/Electron suites with the wrong runner; those five pre-existing harness failures are outside this UI change, while the intended `vitest run src` command is green.

### Follow-up corrections after rendered review

- Interaction mode: **persistent default-selection mode**, activated by the user on 2026-08-28.
- Defaulted motion: 380 ms rail reflow and 220 ms content-only route entry, both using the existing restrained ease-out curve and reduced-motion fallback.
- Defaulted create control: a frameless Lucide plus icon in the collapsed rail with a subtle neutral hover state; the label appears only in the expanded rail.
- Defaulted summary presentation: one-line ellipsis plus a 58 px fade region, 16 px trailing safety space, and the complete original text retained through the title affordance.
- Gate 0–7: **auto-approved** for the local follow-up scope. Protected routes, APIs, data, permissions, light tokens, and conversation behavior remain unchanged.
- Gate 8: **auto-approved**. Corrected the collapsed create control's overflowing grid track, constrained conversation rows to the 288 px list, added content-only route motion, and reran rendered validation.
- Gate 9 local delivery: **auto-approved**. External deployment and broad rollout remain out of scope.
- Rendered measurements: the create control is fully contained at x=9.5–47.5 inside the 56 px rail; Agent conversation rows are 256 px inside the 288 px panel instead of expanding to roughly 92,610 px; full summary text remains in the DOM.
- Validation: 25 frontend test files and 111 tests passed; production build passed with only the existing large-chunk advisory.

### Collapsed-rail hover-intent refinement

- Interaction mode: **persistent default-selection mode**. The user explicitly restored the black create control and requested delayed pointer expansion; the remaining timing choice was defaulted to the recommended 320 ms dwell threshold.
- The rail now waits for 320 ms of continuous pointer presence before beginning its 380 ms reflow. Keyboard focus still expands immediately, and reduced-motion mode removes both the dwell and travel durations.
- The collapsed search icon is fixed at 16×16 px and can no longer shrink behind the hidden label or keyboard shortcut. Its containing action remains fully clipped inside the 56 px rail.
- The create control is restored to a complete 38×38 px graphite button (`rgb(29, 29, 31)`) with a white plus icon; its expanded state preserves the same action hierarchy.
- Rendered measurements: collapsed rail 56 px; create control 38×38 px at x=9.5; search action 39×38 px at x=9; visible search icon 16×16 px at x=20; resolved hover-intent token 320 ms.
- Gate 0–9 local refinement: **auto-approved** under the active default-selection mode. No route, API, data, permission, dependency, or deployment change was introduced.
- Validation: all 25 frontend test files and 111 tests passed; the production build passed with only the existing large-chunk advisory.

### Create-control axis-lock refinement

- The user rejected the create icon's two-step lateral movement during rail expansion and identified the stationary navigation icons as the correct motion reference.
- Defaulted structure: keep the plus icon on the navigation axis and animate only the graphite background width and label disclosure; the icon itself has no translation or alignment transition.
- Rendered measurements: collapsed create icon x=20 px at 16×16 px; expanded rail 224 px with the create icon still x=20 px at 16×16 px; measured horizontal delta is exactly 0 px.
- Gate 0–9 local refinement: **auto-approved** under persistent default-selection mode. Only the create-control presentation changed; navigation behavior, routes, data, APIs, permissions, and deployment remain untouched.
- Validation: all 25 frontend test files and 111 tests passed; production build passed with only the existing large-chunk advisory.

### Report workspace synchronization

- Interaction mode: **persistent default-selection mode**. The user requested a complete report UI synchronization including chart style, sizing, and interaction.
- Defaulted direction: compact analytical hierarchy; neutral workbench surfaces with graphite actions; system blue for structural selection; semantic multicolor reserved for data.
- Defaulted chart system: 2.25 px trend lines, quiet grid and numeric axes, date-snapped crosshair, multi-series tooltip, keyboard date focus, `aria-pressed` legend visibility, linked donut segment/legend hover, and no fake preview curves.
- Layout correction: report-content container queries replace viewport-only assumptions. At the rendered workbench width, the secondary trend increased from roughly 548×214 px to 913×357 px instead of remaining compressed beside the distribution.
- Public and personal report shells now share the same frameless tabs, restrained border/radius system, neutral canvas, selected state, and empty-state language; user-selected personal report content styles remain protected.
- Gates 0–9: **auto-approved** for local report frontend scope. Report APIs, metric definitions, date semantics, scheduler, permissions, authentication, and deployment remain unchanged.
- Rendered evidence: 1280×720 public overview, trend empty/failure state, and personal empty state; filter remains inside report content and main horizontal overflow is zero.
- Validation: 27 frontend test files and 115 tests passed; production build passed with only the existing large-chunk advisory.

### User-conversation UI synchronization

- Interaction mode: **persistent default-selection mode**. The user requested the user-conversation experience to become consistent and elegant across the active thread.
- Defaulted hierarchy: compact right-aligned graphite user prompts; borderless Agent document flow; structured artifacts, thinking, tools, cards, attachments, and failure output receive boundaries only when needed.
- Defaulted geometry: one fluid 860 px reading/composer axis, 8 px spacing basis, restrained 8–14 px radii, flat transcript, and elevation reserved for the composer and transient message-action rail.
- Defaulted interaction: four-action hover/focus rail with the complete right-click/click menu retained; long content uses a role-aware fade and frameless disclosure; streaming uses a quiet cursor/status instead of a perpetual conic outline.
- Synchronized ancillary states: search strip, thread drawer, forward preview, attachment preview, inline artifacts, knowledge/reply states, loading/empty/typing/send failure, drag upload, and reduced-motion/transparency behavior now use the same Workbench language.
- Gates 0–9: **auto-approved** for local conversation frontend scope. Message APIs, WebSockets, routing, Agent execution, task synchronization, data, permissions, and deployment remain unchanged.
- Rendered evidence: real 1280×720 authenticated thread, long structured content, search strip, failure output, message-action keyboard focus, and composer; main/log horizontal overflow measured zero.
- Validation: TypeScript passed; 27 frontend test files and 115 tests passed; production build passed with only the existing large-chunk advisory.

## Approval ledger

| Gate | Status | Approved scope | Conditions | Invalidated by |
| --- | --- | --- | --- | --- |
| 0 — Context audit | approved | Current Web routes, React/Vite/Ant Design stack, screenshots, product code, and external reference research | Read-only; no production styling changes | — |
| 1 — Requirements/UI Brief | approved | `ui-redesign-brief.md`: scope, roles, permissions, preserved behavior, journeys, pilot boundary, and constraints | User replied “开始” to the sole Gate 1 approval question on 2026-08-27 | Scope/business-rule change |
| 2 — Reference/design direction | approved | `ui-design-direction.md`: reference roles, light visual language, density, materials, motion character, and floating-layer model | User explicitly replied “批准” on 2026-08-27 | Upstream scope change |
| 3 — Information architecture | approved | `ui-information-architecture.md`: route hierarchy, shell/chat structure, Task projection, responsive layout, and overlay order | User explicitly replied “批准” on 2026-08-27 | Gates 1–2 change |
| 4 — Tokens/component language | approved | `ui-design-tokens.md`: exact starting colors, typography, spacing, radii, material, geometry, icons, and migration boundary | User explicitly replied “批准” on 2026-08-27; no dependency installed | Gates 1–3 change |
| 5 — Interaction/state/motion | approved | `ui-interaction-spec.md`: navigation, chat, Task, inspector, states, motion, responsive, keyboard, and accessibility behavior | User explicitly replied “批准” on 2026-08-27; specification only | Gates 1–4 change |
| 6 — Prototype/visual acceptance | approved | Variant A — Balanced Workbench approved as the visual production baseline; interaction behavior and intentional reference deviations accepted; no further prototype iteration required | User replied “a” separately to all four Gate 6 decisions on 2026-08-27 | Gates 1–5 change |
| 7 — Production authorization | approved | Direct replacement of the protected global shell plus deep shell/chat/Task pilot defined in `ui-production-plan.md` | User granted full production authorization after reviewing the file scope and rollback plan | Gates 1–6 change |
| 8 — Per-pass implementation | approved | All four implementation passes approved; local production UI redesign complete | User explicitly confirmed final Pass 4 approval on 2026-08-28 | Gate 7/change request |
| 9 — Release/rollout | open | No rollout authorized | Requires separate explicit deployment or broad-rollout authorization; local viewport/state evidence complete | Any unresolved regression |

## Gate 6 evidence

- Variant A — Balanced Workbench: selected and visually approved as the production baseline.
- Variant B — Calm Canvas: narrower reading column, calmer header, more editorial whitespace.
- Variant C — Operations Focus: denser conversation list with a persistent wide-screen Task inspector.
- Responsive screenshots: 1440×900, 1280×800, and 1024×768.
- Interaction checks: URL-stable variant switching, command palette focus/escape, collapsed execution stream, inspector tabs, composer send feedback, Task capsule/window, drag/resize response.
- Five high-impact issues corrected before review: Task capsule/composer collision, prototype switcher/composer collision, 1024 px prototype-note/title collision, Task capsule/inspector-header collision, and compact-height floating-layer safe-area loss.

## Pass 2 evidence

- Introduced semantic light-workbench tokens and mapped the retained Ant Design layer to the same color, geometry, focus, and elevation system.
- Replaced the pilot shell, command palette, and Task surfaces with normalized Lucide line icons.
- Applied flat persistent surfaces and reserved restrained glass/elevation for the command palette, Task utility, and composer.
- Corrected assistant messages to use the approved borderless 840 px document-flow layout while retaining compact graphite user prompts.
- Verified the production build and 14 focused chat/Task tests.
- Rendered and interacted with the live product: command palette keyboard opening, Task capsule/window, whole-card Task detail activation, Progress tabs, and the docked inspector.
- Screenshots: `pass2-workbench-current.png`, `pass2-command-palette.png`, and `pass2-task-inspector.png`.

## Pass 3 evidence

- Added retained-data failure states for conversation refresh and archived-list loading, with clear retry actions instead of replacing usable content.
- Added composer failure recovery: the text draft, selected knowledge bases, and pending attachments are restored after a failed send, with inline retry and dismiss actions.
- Added complete command-palette keyboard behavior and semantics: active-result highlighting, Arrow Up/Down wrapping, Home/End navigation, Enter execution, Escape close, combobox/listbox relationships, and focus-return handling.
- Added state-derived Task inspector defaults: running and failed tasks open Progress; completed and canceled tasks open Overview. Inspector tabs support roving keyboard focus and Arrow/Home/End navigation.
- Added explicit selected, pressed, disabled, loading, live-update, retry, stop, and partial-streaming presentation across chat header controls, message log, Task utility, and stop actions. Unavailable group-only settings now explain why they are disabled without inventing a new permission rule.
- Collapsed long execution and artifact content in Task Overview while retaining the complete original result behind an explicit disclosure, preventing successful output from overwhelming the inspector.
- Verified the production build and 19 focused chat, Task, and command-state tests.
- Rendered normal and non-success states from the live product. Screenshots: `pass3-command-keyboard-state.png`, `pass3-failed-task-state.png`, and `pass3-success-task-state.png`.

## Pass 4 evidence

- Added the approved 120–240 ms motion system for rail intent, command overlays, Task surfaces, inspector entry, and local control feedback. Travel is limited to at most 12 px and state changes never wait for animation completion.
- Added global reduced-motion, reduced-transparency, and increased-contrast fallbacks. Direct dragging and resizing remain direct; automatic snap and decorative activity motion become immediate or static.
- Added an 8 px Task-window safety margin, a 20 px magnetic-edge preview, restrained release snapping, persisted post-gesture geometry, and composer collision avoidance. Browser drag verification placed the 280 px panel at `x=1152` in a 1440 px viewport, exactly 8 px from the right edge.
- Added docked Task-inspector resizing from 360–560 px by pointer and keyboard, with 16 px Arrow steps, 1 px Shift+Arrow steps, Home reset, and persisted width. Browser verification observed `400 → 416 → 400` px.
- Changed the inspector to a modal drawer below 1360 px after the 1280 px screenshot showed that docking reduced the chat workspace below a usable width. The 1280 and 1024 drawers retain the full underlying workspace, scrim, focus containment, and close recovery.
- Reached full-bleed framing at 1024 px, removed unintended horizontal workbench scrolling, tightened compact message/composer spacing, and kept the rail, title, primary controls, Task status, and recovery actions available.
- Five highest-impact discrepancies corrected: 1280 dock squeeze, Task/composer collision, missing magnetic safety behavior, fixed non-keyboard inspector width, and conversation/transcript horizontal overflow.
- Verified the production build and 34 focused shell, chat, Task, Task-board, activation, and geometry tests. Only the existing Vite chunk-size advisory remains.
- Screenshots: `pass4-final-1440.png`, `pass4-task-window-snapped-1440.png`, `pass4-inspector-1440.png`, `pass4-final-1280.png`, `pass4-final-1024.png`, and `pass4-normal-1024.png`.
