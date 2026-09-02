# Di Agent Gate 5 — interaction, state, motion, and responsive specification

> Presented: 2026-08-27  
> Status: awaiting Gate 5 approval  
> Boundary: behavior specification only; no dependency, prototype, production edit, or rollout

## 1. Interaction principles

- The same action remains available by pointer and keyboard.
- High-frequency actions respond immediately; animation never delays intent.
- Reveal detail progressively without discarding it.
- Long-running Agent work shows real state and preserves partial output.
- Hover is enhancement, never the only path to an essential action.
- A state change affects only the smallest surface that owns it.
- Navigation, selection, bulk selection, and focus are visually and semantically different.

## 2. Global keyboard model

| Input | Result | Notes |
| --- | --- | --- |
| `Cmd/Ctrl K` | global command/search palette | conversation search is the first ranked scope from Messages |
| `Cmd/Ctrl N` | new conversation | preserves existing behavior |
| `/` outside editing | focus current page search/filter | only when no text input/editor owns focus |
| `Esc` | close highest dismissible layer | never closes multiple layers at once |
| `Tab` / `Shift Tab` | semantic focus order | no focus in hidden/collapsed content |
| Arrow keys | move within menu/list/grid where appropriate | does not unexpectedly change pages |
| `Enter` / `Space` | activate focused row/control | Space must not double-scroll |
| `?` outside editing | shortcut help | searchable and grouped by current page |

Chinese IME composition events never submit, activate shortcuts, or close a composer. Shortcuts ignore normal typing and content-editable surfaces unless explicitly scoped.

## 3. Global rail behavior

### Pointer

- Collapsed width: 56 px.
- Entering the rail starts a 120 ms intent delay before overlay expansion.
- Expansion runs for 180 ms without reflowing the page.
- Leaving the expanded rail starts a 260 ms safe collapse delay.
- Re-entering cancels collapse.
- An open rail menu/popover suspends collapse until the child closes.

### Keyboard

- Focusing any rail item expands immediately without animation delay.
- Focus remains in DOM order from product/global actions through routes to account/system actions.
- Leaving the rail by Tab collapses only after focus reaches the active page.
- Current route is announced and uses marker + text/icon contrast, not color alone.

### Selection and unread

- Click/Enter navigates once and returns focus to the new page heading or preserves the work context when the route retains it.
- Unread counts remain visible in both collapsed and expanded modes.
- Route hover does not resemble current-route state.

### Motion

- Overlay changes opacity and width/clip with `cubic-bezier(0.22, 1, 0.36, 1)`.
- No scale bounce and no content displacement.
- Reduced motion: immediate expansion/collapse after the same intent delays.

## 4. Page header and actions

- Title and state remain in document flow.
- Right-side action cluster floats visually but keeps a stable hit region.
- Primary route action remains visible; secondary actions move into overflow before labels truncate ambiguously.
- Action menus anchor to the trigger and return focus to it on close.
- Loading an action locks only that action unless the entire page truly cannot proceed.
- Destructive action is neutral in overflow and becomes red only in the confirmation/final action.

## 5. Conversation list

### Row interaction

- Whole row click/Enter opens the conversation.
- Hover reveals low-frequency pin/overflow controls without moving title/metadata.
- Nested controls stop row activation.
- Keyboard highlight is distinct from the open conversation.
- Active conversation retains a compact marker and quiet selected background.
- `Shift` range selection is reserved for a future explicit bulk mode; ordinary clicks never create hidden selection.

### Grouping

- Section headers collapse/expand with pointer or keyboard.
- Section state persists per user.
- Empty sections disappear.
- A conversation appears in the highest-priority eligible section only.
- Moving/favoriting updates the list without stealing focus or resetting scroll.

### Search

- Search debounces local filtering at about 120 ms; server search shows an inline progress affordance without clearing local results.
- Results flatten group hierarchy and show the original group/path in metadata.
- Clearing search restores the previous group expansion and scroll state.
- Zero results show query-specific recovery, not the general empty state.

### Realtime updates

- Incoming messages update preview/unread without reordering the row currently under pointer/focus.
- Active/running Task may move a conversation into `进行中` only when the user is not actively manipulating that row; otherwise reorder after interaction ends.
- Realtime changes use opacity/color feedback only, not row lift or slide animation.

## 6. Conversation and transcript behavior

### Loading/opening

- Shell, list, header, and composer remain stable.
- Existing conversation content remains until the new conversation has enough data to replace it, then crossfades locally within 120 ms.
- Failed load keeps the prior conversation visually identified and shows an inline retry state; it never displays the wrong title with stale content.

### Scroll and streaming

- If the user is within roughly 80 px of the bottom, new streamed content follows automatically.
- If the user has scrolled away, do not pull the viewport; show `回到最新` with unread/new-event count.
- Expanding a tool/activity block maintains the visible anchor to prevent the transcript from jumping.
- Switching conversations preserves each conversation's draft and recent scroll position in the current session.
- Date/context separators become sticky only when they do not cover message actions or code headers.

### User messages

- Click empty bubble area selects text normally; the row itself is not a button.
- Hover/focus reveals copy/edit/retry operations only where the backend supports them.
- Editing opens an inline editor and preserves the original until save succeeds.

### Agent responses

- Document-flow response actions appear at response end and on focus/hover of the response group.
- Copy copies rendered text/Markdown according to the named action.
- Retry/regenerate creates a version, never silently overwrites the prior result.
- Version navigation is explicit when multiple outputs exist.

### Tool/activity disclosure

- Default summary contains state, concise label, duration, and disclosure chevron.
- Click summary/Enter/Space expands in place.
- Nested links/actions remain independent.
- Live tool block can stream status while collapsed.
- Failure expands the failed summary only when doing so is necessary to show a required confirmation; ordinary failures do not steal focus.

## 7. Composer behavior

### Editing and send

- `Enter` sends when IME composition is inactive.
- `Shift Enter` inserts a newline.
- `Cmd/Ctrl Enter` also sends for users accustomed to editor workflows.
- Empty/whitespace-only content cannot send unless a valid attachment/context action exists.
- The composer grows upward to a defined max height, then scrolls internally.
- Drafts remain scoped to the conversation.

### Context, attachment, Skills/MCP, and model

- Context chips appear only when selected and wrap above the editor before compressing its minimum width.
- Removing a chip is undoable for a short period when removal is costly.
- Attachment processing shows per-file progress, success, and failure; one failed file does not discard successful files.
- Skills/MCP/model menus are searchable if the list exceeds a compact threshold.
- Menu choice updates the composer context without closing unrelated panels.

### Running state

- Send becomes Stop in the same stable location.
- Stop requests cancellation once, then shows `正在停止` until acknowledged.
- Partial output remains in the transcript.
- Repeated stop clicks do not issue repeated cancellation requests.

### Failure

- Send failure preserves the draft and attachment selections.
- The error appears next to the composer/failed message with retry.
- Offline state disables send only when queueing is unavailable and explains why.

## 8. Chat-to-Task synchronization

- Ordinary Agent replies do not create Tasks.
- First planning/tool/execution event creates one Task projection and links its source conversation/session.
- Subsequent matching events update the same Task until a terminal state.
- A later unrelated execution request creates a new Task rather than reopening/overwriting a completed Task.
- Duplicate/replayed WebSocket events are idempotent in the UI projection.
- Unknown phase remains indeterminate; do not infer completion from elapsed time.
- Task updates are announced through a polite live region, except errors/attention requests which use an assertive but concise announcement.

## 9. Task capsule and progress window

### Capsule

- Appears for running, attention, recently completed, or pinned state.
- Never expands automatically.
- Click/Enter/Space expands the progress window.
- Completion updates label/icon and may use a brief 160 ms emphasis; it does not move or steal focus.
- Multiple active Tasks show count + strongest state; expansion lists them by attention, running, recent completion.

### Dragging

- Drag begins only from the named drag/title region, never from controls or scroll content.
- Pointer capture keeps the gesture stable outside the panel.
- Movement tracks 1:1 while pressed with no spring/delay.
- The panel remains within an 8 px viewport safety margin.
- Within 20 px of an eligible edge, the edge preview becomes visible.
- Release applies a 220 ms restrained snap using `cubic-bezier(0.22, 1, 0.36, 1)`.
- `pointercancel`, lost capture, blur, or Escape ends the gesture safely at the last valid geometry.

Keyboard alternative:

- A `移动窗口` control exposes edge/corner positions and reset-to-default.
- Arrow-key nudging is available in move mode, 8 px normally and 1 px with Shift for fine adjustment.

### Resizing

- Visible bottom/right resize handle; cursor and accessible name indicate purpose.
- Clamp to 280–560 px width and 360–760 px height plus current viewport constraints.
- Resize tracks directly and preserves the opposite anchor where practical.
- Keyboard resize mode uses 16 px steps and offers reset.
- Size persists only after a completed gesture.

### Collision and layering

- Geometry is reclamped on viewport resize and when browser inset changes.
- The panel avoids the composer and global primary action zones where possible; if impossible at 1024 px it collapses to the capsule.
- Opening a blocking modal suppresses pointer interaction with the Task utility and visually lowers it.
- Only one expanded Task utility exists globally.

### Completed history and detail

- Show current/active Tasks and maximum three recent completed Tasks.
- Whole completed row opens detail.
- Full history action navigates to `/tasks`.
- Closing detail restores focus to the source row/window control.

## 10. Right inspector and drawers

### Open/close

- Inspector trigger toggles current contextual detail.
- Opening the same item retains the last valid tab/scroll when appropriate.
- Opening a different item starts on the state-derived default tab.
- Close returns focus to the opener when it still exists.

### Resizing

- Docked width: 360–560 px, default 400 px.
- Drag handle has a 1 px visual line but a wider invisible target.
- Keyboard resize control mirrors the Task window behavior.
- Persist width after interaction, not every pointer frame.

### Tabs

- Running Task opens `进程`; completed opens `概览`; failed opens `进程` focused near the failed phase.
- Left/right arrows move among tabs; Enter/Space activates under manual activation if content is expensive.
- Tab content keeps independent scroll position within a Task session.

### Overlay mode

- At compact width, use modal drawer + scrim.
- Trap focus and block background interaction.
- Escape closes only the drawer's highest child first, then the drawer.
- Reduced motion uses an opacity/state change without travel.

## 11. Command palette, menus, and dialogs

### Command palette

- Global invocation is centered and searchable.
- Results group by current context, then global actions.
- Active row is visible and announced.
- Arrow keys navigate; Enter executes; Esc closes; query remains while a child confirmation is handled.
- Destructive commands never execute from the palette without confirmation.

### Contextual menu

- Mouse invocation anchors near the trigger.
- The same action model and labels power keyboard/global presentation.
- Submenus open after intent, not incidental pointer crossing.
- Menus close after successful action unless continued multi-selection is expected.

### Dialog

- Title states the decision, not a generic `提示`.
- Body names impact and recoverability.
- Primary/secondary action order stays consistent.
- Destructive confirmation focuses the safe action initially unless immediate destructive focus is demonstrably required.
- Async failure remains inside the open dialog with retry; typed content persists.

## 12. Reports interaction contract (later migration)

### Loading and freshness

- Show the latest usable snapshot immediately when available.
- Refresh in the background with a compact `更新中`/last-updated status.
- On refresh failure retain snapshot, mark it stale, and offer retry.
- Full blocking load appears only when no usable snapshot exists.

### Filters

- City and time changes are draft selections until Apply, unless the control is explicitly labeled instant.
- Applied filters remain visible and removable.
- URL/state sharing preserves applied filters, not half-finished drafts.
- Normal users cannot see admin-only filter/config shells.

### Charts

- Hover/focus shows date, series label, value, and unit.
- Legend click/Enter toggles a series and updates accessibility state.
- Toggling series rescales thoughtfully without a disorienting full redraw.
- One-week/month/year uses business event time from the API.
- Single-point/no-history state states why no line exists; never draws a fake preview line.
- Ring chart segments pair color with labels, values, percentage, and focusable legend actions.

### Tables and DUID search

- Standard users receive exact DUID search results only, not unrestricted browsing.
- Admin table retains pagination, sort, field groups, and stable column geometry.
- Loading next page preserves table headers/widths.
- Null/missing values display an explicit neutral dash with accessible meaning.

## 13. Agent administration interaction contract (later migration)

- Runtime overview reads actual connection/runtime data and distinguishes unknown from offline.
- Select all Skills/MCP applies only to the visible scoped collection and states the scope.
- User can clear all and reverse select-all before save.
- Download/install Skill shows source, permissions, progress, verification, failure reason, and retry.
- Partial configuration failure does not discard successful selections or unrelated edits.
- Admin-only controls are omitted for ordinary users.

## 14. State matrix

| State | Visual/behavior contract | Recovery |
| --- | --- | --- |
| default | stable geometry, clear label/icon | normal action |
| hover | immediate quiet fill/contrast, no movement | pointer leave |
| pressed | local stronger fill | release/cancel |
| focus-visible | 2 px blue ring, no layout shift | continue/Tab/Esc |
| keyboard highlight | list/menu row highlight distinct from selection | arrows/Esc |
| selected | marker/check + surface; color not sole signal | toggle/clear |
| current/open | location marker + stronger label | navigate/close |
| disabled | unavailable semantics + discoverable reason | satisfy prerequisite |
| loading | preserve geometry; local progress | wait/cancel where safe |
| streaming | real partial content/current phase | stop |
| stale | last usable data + timestamp | retry/background refresh |
| partial | successful content retained + failed subset marked | retry subset |
| empty | reason + one next action | create/clear filter |
| zero result | query/filter retained | revise/clear |
| permission denied | restricted content absent + safe explanation | return/request access |
| error | attached message/icon, retained input/content | retry/edit/return |
| offline | one compact persistent status | reconnect/work offline if supported |
| success | quiet local update/confirmation | undo when supported |

## 15. Motion tokens

```css
:root {
  --motion-instant: 0ms;
  --motion-fast: 120ms;
  --motion-control: 160ms;
  --motion-overlay: 200ms;
  --motion-panel: 240ms;
  --motion-snap: 220ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
}
```

| Context | Duration/easing | Properties |
| --- | --- | --- |
| row hover/current | 0–120 ms standard | color/background/opacity |
| button/control | 120–160 ms standard | color/background/border |
| tooltip/menu/popover | 160–200 ms out | opacity + ≤4 px transform |
| inspector/drawer | 240 ms out | transform + opacity |
| Task snap/release | 220 ms out | position only after release |
| chart update | 240–360 ms out | path/value transition; no autoplay |
| completion emphasis | 160 ms | icon/color/opacity only |

Forbidden:

- moving dense rows on hover;
- looped floating decoration in operational pages;
- bounce/overshoot on menus;
- blur animation over large scrolling content;
- animated fake progress;
- delaying click execution until an animation finishes.

## 16. Reduced motion, transparency, and performance

### Reduced motion

- Remove travel, spring, continuous pulse, and chart path tween.
- Keep status icon/text and instantaneous visibility changes.
- Direct dragging/resizing remains direct because it is user-controlled; snapping becomes immediate.

### Reduced transparency/high contrast

- Replace glass with opaque surface.
- Increase separator/focus contrast as needed.
- Do not communicate depth only with blur.

### Performance constraints

- No full-page `backdrop-filter`.
- Animate transform/opacity where animation is required; avoid layout animation of transcript/list rows.
- Persist drag/resize state on completion, not every frame.
- Batch realtime state updates and preserve scroll anchors.
- Large lists/tables should support virtualization or pagination without changing semantics.
- Avoid loading-related layout shifts in header, composer, charts, and inspectors.

## 17. Responsive behavior matrix

| Width | Rail | Conversation list | Inspector | Task utility | Header/composer |
| --- | --- | --- | --- | --- | --- |
| `≥1440` | 56 → 224 overlay | 288 px | docked 360–560 | draggable window allowed | full labels/actions |
| `1280–1439` | same | 256–288 px | dock if chat stays usable, else overlay | reclamped | secondary actions overflow |
| `1024–1279` | same/full-bleed app | visible until overlay conflict; user-toggleable when needed | modal drawer | capsule preferred on collision | compact action labels; same composer priority |
| `<1024` | basic access | may become overlay | full-width overlay | capsule | basic read/compose/recovery only |

Breakpoint changes never remove the current title, primary action, applied filter state, running Task state, or error recovery.

## 18. Accessibility acceptance

- Logical headings and landmarks for rail, conversation list, transcript, composer, inspector, and modal layers.
- Named icon buttons and disclosure state via `aria-expanded`/`aria-controls` where applicable.
- Live-region announcements are concise and rate-limited.
- Focus never moves due only to realtime data arrival.
- Modal focus trap and return focus are verified.
- 200% zoom at 1024 CSS px preserves core workflow.
- Color contrast meets the Gate 4 targets; chart data has labels/markers beyond color.
- Pointer-only drag/resize has keyboard controls and reset.
- Mixed Chinese/English, long technical identifiers, code, and screen-reader names remain usable.

## 19. Gate 5 acceptance criteria

- Every primary pilot action has pointer, keyboard, loading, error, and recovery behavior.
- Chat streaming never steals scroll when the user is reading history.
- Partial Agent output survives cancel/failure.
- Task creation is based on real execution state and is idempotent.
- Task window drag/resize/snap/collision behavior is deterministic.
- Rail expansion never reflows the page.
- Inspector focus, resize, tabs, and compact drawer behavior are explicit.
- Permissions hide unauthorized structure rather than showing misleading disabled shells.
- Realtime report refresh can show cached/stale data without blocking the entire page.
- Motion explains state and causality, respects reduced motion, and does not delay work.
- Gate 6 can create an isolated interactive pilot without making new interaction decisions.

## 20. Gate effect

Approving Gate 5 locks the interaction, state, motion, responsive, accessibility, and performance contracts described here. It authorizes creation of an isolated/disposable interactive pilot for Gate 6 and rendered review at 1440×900, 1280×800, and 1024×768.

It does not authorize production application edits, dependency installation in the production frontend, or rollout. Those require Gate 6 visual/interaction acceptance followed by explicit Gate 7 production authorization.
