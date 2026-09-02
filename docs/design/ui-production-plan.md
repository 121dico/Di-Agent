# Di Agent Workbench UI production plan

> Revised Gate 7 proposal — direct replacement; no production UI changes are authorized by this document alone.

## Production scope

The rollout directly replaces the current UI with the approved Variant A language. There is no legacy UI branch, runtime feature flag, or parallel visual implementation.

- Global protected shell: `/`, `/contacts`, `/agents`, `/skills`, `/knowledge`, `/tasks`, `/reports`, `/settings`.
- Deep redesign: `/` message/private-Agent workspace, global Task progress utility, and Task detail inspector.
- Existing content bodies on Contacts, Agents, Skills, Knowledge, Tasks, Reports, and Settings remain functionally and structurally unchanged in this pass; they immediately inherit the new global rail, canvas framing, typography, and semantic tokens, then receive page-specific deep redesigns in later approved work.
- `/login` and `/register` are out of scope.
- No backend, API, database, permission-policy, scheduler, report-definition, or agent-contract change is part of this UI plan.

## Expected new production files

- `src/frontend/src/components/shell/GlobalRail.tsx`
- `src/frontend/src/components/shell/GlobalRail.module.css`
- `src/frontend/src/components/shell/CommandPalette.tsx`
- `src/frontend/src/components/shell/CommandPalette.module.css`
- `src/frontend/src/components/chat/TaskInspector.tsx`
- `src/frontend/src/components/chat/TaskInspector.module.css`
- `src/frontend/src/styles/workbench-tokens.css`

## Expected existing files to change

### Shell and routing

- `src/frontend/src/layout/AppLayout.tsx`
- `src/frontend/src/layout/AppLayout.module.css`
- `src/frontend/src/styles/globals.css`
- `src/frontend/src/theme/antd.ts`
- `src/frontend/src/views/ChatView.tsx`
- `src/frontend/src/views/ChatView.module.css`

### Conversation and chat presentation

- `src/frontend/src/components/sidebar/ConversationList.tsx`
- `src/frontend/src/components/sidebar/ConversationList.module.css`
- `src/frontend/src/components/sidebar/ConversationItem.tsx`
- `src/frontend/src/components/sidebar/ConversationItem.module.css`
- `src/frontend/src/components/chat/ChatWindow.tsx`
- `src/frontend/src/components/chat/ChatWindow.module.css`
- `src/frontend/src/components/chat/MessageList.tsx`
- `src/frontend/src/components/chat/MessageList.module.css`
- `src/frontend/src/components/chat/MessageBubble.tsx`
- `src/frontend/src/components/chat/MessageBubble.module.css`
- `src/frontend/src/components/chat/ChatInput.tsx`
- `src/frontend/src/components/chat/ChatInput.module.css`

### Task experience

- `src/frontend/src/components/chat/TaskProgressWidget.tsx`
- `src/frontend/src/components/chat/TaskProgressWidget.module.css`
- `src/frontend/src/components/chat/taskPanelPosition.ts`
- `src/frontend/src/components/chat/taskPanelPosition.test.ts`
- `src/frontend/src/components/chat/TaskProgressWidget.test.ts`

### Icon dependency in Pass 2

- `src/frontend/package.json`
- `src/frontend/package-lock.json`

Only `lucide-react` is proposed. Ant Design remains installed for complex behavior and existing screens. `pnpm-lock.yaml` will not be modified; this repository's tracked npm lockfile is the production dependency record.

## Expected legacy UI files to remove

- `src/frontend/src/components/settings/SettingsPanel.tsx`
- `src/frontend/src/components/settings/SettingsPanel.module.css`

`GlobalRail` replaces this component directly. No copy or hidden fallback of the previous navigation UI will remain.

## Contracts that remain unchanged

- Every current URL and React Router route.
- Authentication and authorization behavior, including administrator-only actions.
- API endpoints, request/response types, pagination, and report behavior.
- WebSocket event names and payloads.
- Conversation and message Zustand stores and their source-of-truth semantics.
- Private Agent chat synchronization and automatic Task projection from real message/tool execution state.
- Message send/stop, file upload, drag-and-drop, reply, forward, thread, search, pin, archive, mention, knowledge-reference, artifact, card, and streaming behavior.
- Task timeline data continues to derive from real stored messages; no fake percentage or prototype data enters production.

## Direct rollout and rollback

- The current `AppLayout`, `ChatView`, and pilot child components are refactored in place; the approved workbench becomes the only production UI.
- Shared workbench tokens apply to every protected route immediately. Deep layout changes are limited to the approved shell/chat/Task surface in this pass.
- No source-level copy, hidden route, environment flag, or bundled legacy CSS is retained.
- Each pass maintains a file-and-hunk manifest. Rollback uses targeted `apply_patch` changes only; no `git reset`, `git checkout`, or destructive cleanup is allowed because the working tree already contains user-owned changes.
- Rollback information exists only as the recorded per-pass patch history; it is not shipped as a second UI implementation.
- The throwaway prototype is never imported into production code.

## Four production passes

### Pass 1 — structure and information architecture

- Replace the existing shell structure directly with the approved Workbench structure.
- Add the overlay-expanding global rail and command-palette container using existing icons temporarily.
- Rebuild `ChatView`: conversation column, chat workspace, optional inspector slot.
- Reorganize conversation presentation into favorites/running/project/recent without changing conversation records.
- Split Task detail from the floating Task window into the right inspector structure.
- Keep current design tokens and most current component styling so this pass can be reviewed as structure, not polish.
- Validate with TypeScript build, focused Vitest suites, and rendered 1440/1280/1024 screenshots.

### Pass 2 — visual system

- Add approved semantic workbench tokens and Ant Design mapping.
- Add `lucide-react` and migrate only the pilot shell/chat/Task icons.
- Apply Variant A typography, spacing, borders, geometry, restrained material, and canvas framing.
- Preserve complex Ant Design behavior behind restyled wrappers.

### Pass 3 — states and permissions presentation

- Complete hover, active, focus, selected, disabled, loading, empty, stale, partial, error, permission-denied, success, retry, and stop states.
- Verify whole-row Task activation, keyboard focus restoration, IME-safe sending, and collapsed execution information.

### Pass 4 — motion and responsive polish

- Add approved 100–250 ms transitions, magnetic Task snapping, safe-area collision avoidance, persisted geometry, and reduced motion.
- Verify 1440, 1280, and 1024 px; preserve usable keyboard and pointer behavior.

## First-pass acceptance evidence

- `npm run build`
- Focused Vitest suites for Task geometry, Task timeline, Task widget disclosure, and whole-row activation.
- Browser screenshots at 1440×900, 1280×800, and 1024×768.
- One interaction-heavy state with Task window plus inspector.
- A five-item visual discrepancy report before requesting Pass 1 approval.
