# Native chat image inputs

## 1. Scope

Clipboard/drop image attachments must reach a real multimodal Agent, not only the
document extraction text. Applies to direct chat and Dispatcher task dispatch.

## 2. Signatures

- Frontend: native textarea `paste` and chat-window `drop` → existing `/api/upload`
  → `/api/conversations/:id/messages` attachment payload.
- Backend: source-message attachments → `task.dispatch.data.images`.
- Wire: `images: [{ mime_type: string, data: string /* canonical base64 */ }]`.
- Daemon: `sendPrompt(prompt, runtimeConfig, { ...taskContext, images })`.
- Required daemon capability: `image_inputs_v1`.

## 3. Contracts

- Reuse original uploaded bytes; never fetch an attachment URL or pass server-local
  paths to a remote Agent.
- Resolve the upload API's `uploads/originals/...` logical path beneath the
  configured upload directory's `originals` directory. The literal `uploads/`
  prefix is not a second storage directory.
- Reject traversal, external paths, symlink escapes, non-regular files, and images
  outside the original-upload namespace. Source message must belong to the task
  conversation. Attachment persistence alone does not prove file ownership;
  legacy uploads currently use globally authenticated content-hash paths.
- Maximum 4 PNG/JPEG/GIF/WebP images and 4 MiB decoded bytes in one turn. Enforce
  limits at frontend admission, backend read, and daemon decoding boundaries.
- Codex `turn/start.input` uses `{type:'image', url:'data:<mime>;base64,...'}`;
  Claude stream-json content uses base64 `image` blocks.
- Never log the base64 payload. Images apply only to the current send; normal
  text turns must not carry a previous turn's image payload.

## 4. Validation / errors

| State | Visible behavior |
| --- | --- |
| Plain text paste | Browser default insertion unchanged |
| Image paste/drop | Pending thumbnail; no automatic send |
| Uploading/failed file | Do not send a partial text-only message |
| Unsupported/oversized image | Explicit format/size message; no silent discard |
| Old daemon | Fail capability check and explain update is required |
| Unsupported CLI/one-shot mode | Explicit native-image limitation |
| Conversation changes | Ignore stale upload completion; no cross-chat attachment |

## 5. Cases

- Good: pasted screenshot uploads, image-only send dispatches bytes, real Agent
  correctly describes the synthetic picture.
- Base: text-only chat keeps the existing payload and routing.
- Bad: uploaded PNG becomes “convert to a document”; a URL string masquerades as
  actual vision input; upload failure clears an unsent image.

## 6. Required tests

- Real React paste/drop events through upload and message API client, image-only
  message, MIME/count/size rejection, stale completion, upload/send failure.
- Real UploadService output resolved to byte-identical native image input;
  path escapes, invalid type, aggregate byte/count limits.
- Native Codex/Claude request payloads for image then text-only turns.
- Actual vision adapter verification using a synthetic image whose answer is not
  present in the prompt or filename. Browser human-path acceptance remains a
  separate required check, not replaced by mocked or API-only tests.

## 7. Wrong / correct

Wrong: `filepath.Join(uploadDir, "uploads/originals/hash.png")`, then tell the
Agent the unsupported-document placeholder.

Correct: resolve the canonical logical upload path inside the originals storage
root; dispatch bounded image bytes and build the CLI's native multimodal input.
