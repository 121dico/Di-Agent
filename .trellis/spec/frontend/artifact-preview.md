# Artifact Preview Contracts

## Scenario: PPT High-Fidelity Preview

### 1. Scope / Trigger
- Trigger: uploaded PowerPoint attachments need web preview that preserves text, formulas, and special glyphs as much as possible.
- Do not rely on `pptx-preview` alone for PPT/PPTX fidelity. Its DOM renderer is a fallback because formulas and some Office drawing features are unsupported.

### 2. Signatures
- Backend route: `GET /api/ppt-preview/*filepath`
- Frontend component: `PptxPreview({ fileUrl, fileName, previewUrl })`
- Attachment source field: `MessageAttachment.file_name` is the display and download name; fallback to basename of `file_path` only when empty.

### 3. Contracts
- `filepath` is relative to the upload directory and should be built from `attachment.file_path` after stripping the leading `uploads/`.
- The preview endpoint returns `application/pdf` with `Content-Disposition: inline` when conversion succeeds.
- Conversion order is LibreOffice first, then Windows PowerPoint COM fallback.
- Frontend must try `previewUrl` first and render the returned PDF in an iframe; if the request fails or returns non-PDF content, fall back to `pptx-preview` DOM rendering.

### 4. Validation & Error Matrix
- Path traversal -> `403`
- Non-PPT/PPTX extension -> `415`
- Missing source file -> `404`
- No converter installed -> non-2xx response; frontend falls back to DOM preview.
- Conversion failure -> non-2xx response; frontend falls back to DOM preview.

### 5. Good/Base/Bad Cases
- Good: PPT with equations renders through the converted PDF and shows formula text.
- Base: simple PPT renders through PDF or DOM fallback with correct slide aspect ratio.
- Bad: converter unavailable; user still sees DOM fallback or the download fallback instead of a blank preview.

### 6. Tests Required
- Backend handler test: path traversal is rejected.
- Backend handler test: non-PowerPoint files are rejected.
- Frontend build/type check: `PptxPreview` accepts optional `previewUrl` and keeps fallback rendering.
- Manual check: upload a PPT with formula text, open preview, verify the file name is visible and the formula appears in PDF mode.

### 7. Wrong vs Correct

#### Wrong
```tsx
<PptxPreview fileUrl={fileUrl} fileName={attachment.file_name} />
```

#### Correct
```tsx
<PptxPreview fileUrl={fileUrl} fileName={fileName} previewUrl={previewUrl} />
```

## Scenario: Project HTML File Preview

### 1. Scope / Trigger
- Trigger: `project` cards open `FilesDrawer`, and users need to preview `.html` / `.htm` files instead of only reading source code.
- Do not add a separate `html_preview` card type for single-file previews. `project` remains the directory-level entry point; HTML rendering is a file viewer mode.

### 2. Signatures
- Frontend component: `FilesDrawer({ agentId, workDir, open, onClose })`
- File read API: `readFile(agentId, workDir, targetPath) -> ReadResult`
- Preview helper: `isHtmlPreviewFile(filepath)`, `defaultFileViewMode(filepath)`

### 3. Contracts
- `.html` and `.htm` files open in `preview` mode by default.
- The file panel header shows a segmented control only for HTML files in normal view mode: `preview` and `source`.
- Preview mode renders the file content through `WebpageFrame` with `srcDoc`, reusing its sandbox behavior.
- Source mode keeps the existing code viewer path and language inference (`html` -> CodeMirror HTML mode).
- Markdown, code, text, binary, large-file, and git-history views must keep their existing behavior.

### 4. Validation & Error Matrix
- Binary file -> existing binary unsupported hint, no HTML preview.
- Too-large file -> existing too-large hint, no HTML preview.
- Empty or missing file content -> existing empty/read hint.
- HTML file with external relative assets -> preview may render the HTML shell only; full project-relative asset preview requires a separate static preview/session URL.

### 5. Good/Base/Bad Cases
- Good: selecting `index.html` in a project card immediately shows iframe preview and lets the user switch to source.
- Base: selecting `README.md` still renders markdown preview and does not show the HTML segmented control.
- Bad: adding a new card type for HTML files duplicates `project` directory semantics and forces agents to choose card protocol variants for a file-viewer concern.

### 6. Tests Required
- Unit test for `.html` / `.htm` detection and default view mode.
- Frontend build/type check must pass because `FilesDrawer` owns the Ant Design segmented control and `WebpageFrame` integration.

### Direct HTML file references (2026-10-20)

- `FilesDrawer({ ..., initialPath? })` reads an explicitly selected file on opening; HTML type detection uses that path even when directory listing fails. Requests from a previous selection/closed drawer must not replace current content.
- Both ordinary Markdown and persisted/streamed `TextBlock` links/inline-code paths use `HtmlFileLink` under `HtmlFileMessageContext`. `htmlFileReference.ts` resolves full paths with assistant identity and same-conversation file cards. Exact cross-Agent ownership overrides the summarizing Agent; ambiguous matches must not pick arbitrarily. Relative names require an exact current-message diff file or a current-message project workspace; a diff directory alone must not resolve unrelated comparison filenames. Extension-only strings such as `.html` are not file links.
- HTML entries in `diff` cards open the existing file preview, without git-diff prefetch; non-HTML retains `DiffViewer`. Single HTML summary buttons open directly; multi-file lists retain expansion.
- Only click initiates authenticated `readFile`. Never navigate `/var/.../page.html` on the server: HTTP 200 may just be SPA fallback. Do not expose arbitrary filesystem paths as static routes.
- Reject traversal/unsafe schemes and preserve normal web URLs plus application upload routes. Local read failure shows an inline error and retry; binary/oversized files never run as HTML. Keep the existing `srcDoc` sandbox without `allow-same-origin`.
- Required tests: ordinary/streamed/persisted Markdown, inline path, cross-Agent exact/ambiguous matching, offline/retry, late old reads, failed directory + successful HTML read, non-HTML diff preservation. Real acceptance clicks the original file and its summary link, tests interaction, then reloads.
- Scope limitation: live local files require their source computer to remain connected; project-relative CSS/assets need a separate project-serving contract.

### Internal file RPC boundary (2026-10-20)

- `BrowseAgentFiles` registers task ownership through `CreateDaemonTask` before dispatch, then binds/removes the result promise. Completion retains user/machine authorization; do not resolve arbitrary unregistered task IDs.
- Internal browse/open-path/install-skill/model-discovery prompts are JSON payloads, not model prose: no image-return instructions or result artifact/image parsing.
- File browsing completions never create task-board items. Completion logs contain IDs and lengths only, never file bodies.
- File boundaries compare canonical real paths, so macOS `/var` and `/private/var` aliases are equivalent. Resolve the nearest existing ancestor for deleted historical files; reject external and dangling symlinks. Cover these cases through the RPC dispatch boundary.
- Regression tests must enter `handleTaskDispatch`, not just the inner file reader, and cover machine-owned completion → promise resolution without board writes. Existing HTML containing Markdown image text must be returned byte-for-byte.

### 7. Wrong vs Correct

#### Wrong
```json
{"type":"html_preview","workDir":"/repo","path":"index.html"}
```

#### Correct
```tsx
<WebpageFrame srcDoc={fileContent.content} />
```

## Scenario: Generated Images in Chat Markdown

### 1. Scope / Trigger
- Generated image artifacts can arrive after streamed text. Persisted `blocks_json` may still contain daemon-local paths even when `content` has an image placeholder.

### 2. Signatures
- `resolveMarkdownImageUrl(source, artifacts)` and `markdownImageUrlTransform(artifacts)` in `components/chat/markdownImages.tsx`.
- `TextBlock` receives same-message `ctx.artifacts`; ordinary and embedded Markdown receive the same message artifact list.

### 3. Contracts
- Resolve local references only against an unambiguous exact image artifact filename within the current message, and only to its same-origin uploaded URL. Never guess from alt text or another message.
- Apply resolution at ReactMarkdown's image URL transform, before unsupported local schemes are removed. Non-image links retain the default URL sanitizer.
- Render through `MessageImage`, so clicking opens a preview instead of downloading. Token attachment remains limited to the existing same-origin protected attachment routes.
- Artifact-only updates must refresh resolution without changing text; a changed image URL must clear stale image failure state.

### 4. Validation & Error Matrix
- Missing/ambiguous local reference or unsafe scheme -> existing unavailable indicator, never a raw filesystem request.
- External HTTP(S) image -> allowed by the existing preview contract, without the Di Agent token.
- Known same-origin upload/preview/static routes -> preserve their existing behavior.

### 5. Good/Base/Bad Cases
- Good: `![duck](</var/folders/task/little-duck.png>)` resolves to this message's uploaded `little-duck.png`.
- Base: direct uploaded image URL still opens the existing preview.
- Bad: choosing an arbitrary image because it is the only visible card or has matching alt text.

### 6. Tests Required
- Render real `MessageBubble` with persisted blocks, not only the resolver; assert uploaded `img.src`, preview button, and absence of local path requests.
- Cover streamed/late artifacts, ordinary/embedded Markdown, missing and duplicate names, unsafe protocols, protected routes, external token isolation, and preview click.
- Revisit the original production conversation, open the image, reload, and verify the image still works without modifying stored messages.

### 7. Wrong vs Correct
- Wrong: fix only `message.content` or artifact cards while `TextBlock` renders raw Markdown images.
- Correct: both block and ordinary Markdown renderers share resolution and the existing preview component.
