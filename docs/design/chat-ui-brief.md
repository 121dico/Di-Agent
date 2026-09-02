# User conversation UI brief

## 1. Design read

The conversation workspace is the product's primary daily surface: users scan a thread, distinguish their requests from Agent work, inspect structured outputs, and continue from a composer without losing context. It should feel like one calm operational document inside the light Di Agent Workbench, not a collection of unrelated chat bubbles and cards.

## 2. Scope

- In scope: active-conversation header, message timeline, user and Agent message presentation, message metadata/actions, time dividers, long-message disclosure, replies, attachments, knowledge references, code/tool/thinking/card surfaces, typing/loading/empty/error states, composer, and responsive presentation.
- Out of scope: message APIs, WebSocket behavior, routing, Agent execution, task synchronization, permissions, data retention, search behavior, upload rules, and backend contracts.
- Must preserve: all existing message actions, context menu, Pin, reply, forward, recall/delete, threads, streaming/stop, cards, artifacts, attachments, mentions, knowledge-base selection, draft recovery, drag upload, header actions, and real message content.

## 3. Primary journeys

- Open a conversation → scan the most recent exchange → distinguish request, Agent author, status, and structured output.
- Read a long Agent response → inspect code/tool/card details → disclose the full response when needed.
- Reply or act on a message → continue from the same aligned composer.
- Recover from loading/sending failure without losing usable content or the draft.

## 4. Direction and hierarchy

- User prompts: compact right-aligned graphite bubbles, no decorative tail or gradient.
- Agent responses: left-aligned borderless document flow with a quiet author/time line.
- Structured execution: nested only when the content needs a boundary; thin borders, subtle neutral fills, restrained 8–10 px radius.
- Message actions: one low-salience action rail revealed by hover/focus; complete context menu remains available.
- Composer: the single elevated persistent interaction surface, aligned exactly with the reading column.

## 5. Visual system

- Reuse Workbench tokens: neutral canvas, white reading surface, graphite actions, system-blue focus/selection.
- Reading width: 860 px, fluid down to the available pane width.
- Typography: 14 px message copy at 1.72 line height; 12 px metadata; 15 px composer text; tabular time where available.
- Spacing: 8 px base; 20–24 px message group rhythm; 3–6 px within grouped runs.
- Geometry: 8 px controls, 10–12 px message/structured surfaces, 14 px composer; pills only for status or compact tags.
- Elevation: none on the transcript; restrained elevation only for composer, action rail, tooltip/dropdown, and new-message affordance.

## 6. Interaction and states

- Hover/focus reveals message actions in 140–180 ms without shifting content.
- Long content ends in a 64 px role-aware fade and a text disclosure aligned with the content edge.
- Streaming uses a quiet cursor/status treatment; no perpetual conic-border spectacle around borderless Agent text.
- Loading skeletons occupy the final reading geometry. Empty, typing, send-failure, upload-drag, and new-message states preserve context and use semantic colors sparingly.
- Composer focus uses a blue focus ring, grows upward, and keeps attachment/reply/knowledge states inside the same aligned column.

## 7. Responsive and accessibility

- Wide: stable 860 px reading column; header actions remain compact.
- Medium: reading column becomes fluid; low-priority header labels collapse before controls wrap.
- Compact: 16 px side padding, smaller avatars, user bubble up to 88% width, horizontally safe code/tables, composer controls remain reachable.
- Preserve log semantics, live regions, keyboard activation, visible focus, `aria-pressed`, labels, reduced-motion, reduced-transparency, and increased-contrast behavior.

## 8. Technical plan

- Keep React, CSS Modules, Ant Design behavioral components, existing message models, stores, and handlers.
- Restructure only presentation wrappers needed for the action rail and header hierarchy.
- Consolidate chat-specific visual values onto existing Workbench tokens; remove obsolete green/gradient and dark-mode presentation overrides from the light-only workbench scope.

## 9. Validation

- Validate the real product at wide and compact Web widths.
- Inspect normal message rhythm plus loading/empty presentation; use component tests for states that are not currently present in local data.
- Verify no transcript or composer horizontal overflow, no content movement when actions appear, and aligned reading/composer geometry.
- Run focused chat tests, the frontend `src` test suite, and production build.

## 10. Decision ledger

- confirmed: full user-conversation UI optimization; consistency with the approved light Workbench; existing behavior preserved.
- defaulted: compact user bubble + Agent document flow; 860 px aligned reading column; hover/focus action rail; graphite/blue neutral system; restrained composer elevation; smooth fade disclosure; responsive Web only.
- assumed: current message content, author metadata, message grouping, and functional state derivation remain authoritative.
- open: none for the authorized local UI scope.
- out of scope: APIs, backend, Agent logic, data, permissions, deployment.

## 11. Gate ledger

| Gate | Status | Basis | Scope |
| --- | --- | --- | --- |
| 0 Context | auto-approved | Existing design ledger, running local shell, message components, and preserved behaviors audited | conversation UI only |
| 1 Brief | auto-approved | Material visible choices defaulted under persistent default-selection mode | local production UI |
| 2 Direction | auto-approved | Workbench structure with compact prompt/document-flow response hierarchy | visual direction |
| 3 Structure | auto-approved | Header → transcript → transient state → aligned composer | active conversation |
| 4 Tokens | auto-approved | Existing Workbench neutral/action/focus tokens | chat components |
| 5 Interaction | auto-approved | Action reveal, disclosure, composer focus, state and responsive behavior specified | conversation interactions |
| 6 Acceptance | auto-approved | Real 1280×720 thread, long content, search, message action focus, failure output, and composer rendered | local product |
| 7 Production | auto-approved | User requested direct conversation UI optimization; protected contracts listed | frontend presentation files |
| 8 Passes | auto-approved | Structure, visual, state, motion/responsive passes completed; alignment and reply-quote findings corrected | local code |
| 9 Delivery | auto-approved | 27 frontend test files / 115 tests and production build passed | local only; deployment excluded |

### Acceptance evidence

- Real authenticated `Codex` thread rendered at 1280×720 with existing user prompts, Agent replies, reply quotes, artifacts, thinking/tool blocks, execution failure, threads, and composer; no mock production messages were inserted.
- Active message log measured `clientWidth=923` and `scrollWidth=923`; the surrounding main workspace measured `clientWidth=934` and `scrollWidth=934`, confirming zero horizontal overflow.
- Reading content and composer resolve to the same 860 px maximum axis while remaining fluid in the 934 px chat pane.
- Keyboard focus reveals the 113×32 px four-action message rail at full opacity without changing the 819 px message-content bounds.
- Search expands as a 55 px aligned strip without changing main/log width; the composer remains visible and stable.
- Validation: TypeScript check, 27 frontend test files / 115 tests, and production build passed. Only the existing Vite large-chunk advisory remains.
