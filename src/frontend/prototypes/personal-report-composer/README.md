# Personal Report Composer — THROWAWAY PROTOTYPE

Question: what should the Agent-linked personal report composer look and feel like inside the existing chat workspace?

This isolated prototype contains three structurally different variants, switchable with the floating bottom control or the variant query parameter:

- A — Balanced workspace
- B — Analysis cockpit
- C — Story studio

All displayed figures are mock prototype data. The prototype does not call backend APIs, persist changes, or modify production routes.

Run with one command from src/frontend:

    npm run dev -- --host 127.0.0.1

Then open:

    http://127.0.0.1:5173/prototypes/personal-report-composer/index.html?variant=A&state=ready

Available states: ready, loading, empty, partial, error.

