# Di Agent UI redesign prototype — THROWAWAY

Question answered by this prototype:

> What should the approved Di Agent shell/chat/Task pilot look and feel like when rendered and interacted with at 1440–1024 px?

Three deliberately different variants share the approved functional contract:

- `?variant=A` — Balanced Workbench (recommended baseline)
- `?variant=B` — Calm Canvas (more editorial space)
- `?variant=C` — Operations Focus (denser, inspector-forward)

Run from `src/frontend` with one command:

```bash
npm exec -- vite prototypes/ui-redesign --host 127.0.0.1
```

This prototype is isolated from application routing, uses labeled demonstration data, has no backend mutations or persistence, and must not be promoted directly to production.

Validated viewports:

- 1440 × 900
- 1280 × 800
- 1024 × 768

Key interactions included for review:

- hover/focus expansion of the global icon rail without content reflow;
- URL-stable A/B/C variant switching;
- collapsed execution activity and Task detail tabs;
- floating composer send feedback;
- Task capsule, draggable/resizable Task window, and right-side inspector;
- command palette opened from the rail or `Cmd/Ctrl + K`.
