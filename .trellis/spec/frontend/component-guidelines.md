# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

### Convention: Draggable floating panels

Floating panels that users reposition must use a dedicated drag handle, Pointer
Events, and persisted finite `{ x, y }` coordinates. Clamp the panel against its
measured bounds and the current viewport both when restoring and when the
viewport resizes. End the gesture on `pointerup`, `pointercancel`, and
`lostpointercapture`; resizing during a gesture must cancel the old origin before
reclamping.

Interactive descendants such as collapse and close buttons must not start a
drag. Use CSS Modules for the `grab`/`grabbing` affordance and CSS custom
properties for dynamic coordinates rather than a React `style` prop.

```tsx
<header
  className={dragging ? styles.dragHandleActive : styles.dragHandle}
  onPointerDown={startDrag}
  onPointerMove={moveDrag}
  onPointerUp={finishDrag}
  onPointerCancel={finishDrag}
  onLostPointerCapture={finishDrag}
>
  <span>Panel title</span>
  <button type="button">Collapse</button>
</header>
```

Why: persisted positions can become invalid after display, zoom, or window-size
changes; incomplete pointer cleanup leaves panels stuck in a dragging state.

Resizable floating panels must keep a persisted finite `{ width, height }` pair
separate from their persisted position. Use a dedicated resize handle, clamp the
size to the component's minimum/maximum dimensions and the currently available
viewport space, and then clamp the position again. Reapply both clamps when the
panel is restored, reopened, or the viewport changes. A resize gesture follows
the same `pointerup`/`pointercancel`/`lostpointercapture` cleanup contract as a
drag gesture, and starting either gesture must finish the other one first.

Keep the default size compact enough that it does not obscure the primary page.
Expose dynamic width and height through CSS custom properties and persist the
final clamped dimensions, never raw or non-finite storage values.

### Convention: Dense information streams

When a task step contains a verbose log or information stream, keep the label,
status, and short summary visible, but place the full content in an independent
native `<details>` disclosure that is closed by default. Do not discard or
truncate the stored detail. Style `summary:focus-visible` and retain native
keyboard toggle semantics.

---

## Accessibility

Native disclosure controls are preferred for independently expandable task
details. Never remove the visible keyboard focus indicator from `<summary>`.

### Convention: Whole-card detail activation

When a task card contains nested operational controls, the card body should open
the task detail while those controls keep their independent actions. Prefer an
absolutely positioned native `<button type="button">` as the card's background
activation layer, place card content and operation buttons above it, and give the
background button an accessible name and visible `:focus-visible` treatment.
This provides native Enter/Space activation without putting buttons inside a
wrapper with `role="button"`.

If a body click handler is also used, ignore targets within `button`, `a`,
`input`, `select`, `textarea`, `[role="button"]`, or another explicitly marked
interactive descendant so an operation never opens the detail accidentally.

### Convention: Conversation export and quick Fork actions

Composer-level conversation actions stay presentation-only in the input
component. Put history paging, Markdown formatting, checkpoint polling, Agent
selection, and mutation feedback behind a dedicated hook/module so the already
dense chat window does not absorb another workflow.

When exporting all history, continue cursor paging until the server returns an
empty page or the cursor stops advancing. Do not treat `page.length < limit` as
the end: message visibility filtering happens after the repository limit and
can produce a short page even when older visible messages remain. Format the
same body the message surface renders—structured blocks take precedence over
legacy `content`—and omit streaming placeholders and internal thinking/tool
blocks.

Quick Fork creates a fresh conversation-shared checkpoint from the current end
of the conversation, waits for a backend-forkable terminal status, then calls
the existing Fork mutation. In group conversations prefer the Orchestrator,
then the latest responding member Agent, then the first available Agent. Keep
the original conversation unchanged and make the composer button mutually
exclusive with copy while either action is loading.

### Convention: Report dashboards

Report pages consume immutable backend snapshots and a visualization config;
they never invent placeholder metrics when no run exists. Normalize nullable
list responses to `[]` inside the `api/` module so views can render an empty
state without duplicating null checks.

Report dashboards use a bright analytical hierarchy inspired by the DataSeek
summary page: warm-white canvas, restrained orange brand accent, thin warm
borders, soft shadows, and optional translucent sticky navigation. Arrange a
report as summary hero -> anchor navigation -> numbered KPI, trend, detail, and
run-history sections. Keep cards compact enough to scan as a dashboard, and
always expose the persisted snapshot in a readable data table in addition to
charts.

Data curves may animate on entry but must preserve the real point values and
show their points. Respect `prefers-reduced-motion` and provide loading, empty,
failed, and successful states. Avoid dark full-page report themes and avoid
using blur without a solid light backing layer.

When a snapshot contains a numeric series, keep the chart area compact and
offer complementary views: a curve for direction, columns for row-by-row
comparison, and a donut for the real value distribution. Never fabricate
categories or values. A snapshot detail table must support cross-field search,
clickable column sorting, page-size selection, and pagination while retaining
the immutable source rows.

Legend toggles on a distribution chart must preserve the original denominator
and sector geometry. A disabled category remains in its proportional position
with a neutral gray treatment; restoring it transitions back to the semantic
color. Never renormalize or reflow the remaining sectors merely to hide a
series.

(To be filled by the team)

---

## Common Mistakes

- Restoring floating coordinates without reclamping can place the panel outside
  the current viewport.
- Handling only `pointerup` can leave drag state active after capture loss.
- Rendering every stored tool output by default makes the task timeline hard to
  scan; keep full information available behind per-step disclosure controls.
- Do not make a card containing operation buttons itself a `role="button"`;
  nested interactive semantics are invalid. Use a native background activation
  button instead.
- Persisting raw panel dimensions without finite-value and viewport clamping can
  make the resize handle unreachable after a display or zoom change.
- Stopping transcript pagination on a short page can silently omit older
  messages because hidden-message filtering occurs after the backend limit.
