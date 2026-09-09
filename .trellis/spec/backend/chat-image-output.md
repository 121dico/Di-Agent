# Agent image replies

## Contract
- A task-scoped instruction in the current user prompt asks the Agent to save requested raster output inside its dedicated `image-outputs` directory and reference it as `![title](<absolute path>)`. It must reach every persistent turn as well as one-shot execution.
- The daemon collects explicit local image Markdown outside fenced code, never scans directories or downloads remote URLs. Resolve real paths and reject escapes. Supported: PNG/JPEG/GIF/WebP, at most four files and 4 MiB total.
- `task.completed.artifacts` carries bounded `image` data URLs. The authenticated handler verifies the task's assigned machine, including legitimate shared Agents, before persistence.
- UploadService validates raster dimensions/content, re-encodes PNG to discard non-image data, and stores files under originals. Persisted artifact content is empty; its URL uses FileURLBuilder.
- Image errors retain the text reply with a warning. Image work and normal task completion have separate timeout contexts.
- Frontend image artifacts, Markdown images and uploaded image attachments share preview-first behavior. Original-open and download are explicit actions. Never attach login credentials to third-party URLs.

## Verification
- Daemon tests: path escapes, symlinks, invalid bytes, limits, duplicate refs, fenced examples, current-turn prompt splitting.
- Service test: real daemon collector payload -> sanitized disk image -> URL artifact; pixels survive and trailing private metadata does not.
- Handler tests: assigned shared Agent, unauthorized machine, malformed image retaining answer.
- Frontend tests: primary preview instead of download, modal close/focus, errors and cross-origin credential isolation.
- Real Codex adapter returned the synthetic PNG reference; collector produced an exact 1700-byte payload match on 2026-09-09.
- Browser human-path acceptance is still not fully passed: the in-app tab creation timed out and native Edge control encountered user state changes before reaching a stable chat. Tests/adapter checks do not replace click/revisit acceptance.
