# UI brief

Mode: myuiskill detail mode. High-impact choices confirmed by user: compact top Agent selector, local Skills default expanded, preserve library operations, transparent reply activity. Remaining presentation safely inferred from existing Ant Design/CSS module interface; no open blocking choice.

Scope: SkillsView / AgentSkillsPanel and reply tool activity. Preserve permissions and platform library actions. No visual system migration.

Reference roles: current app tokens/Ant Design for visual language and controls; DeepSeek Harness for replayable skill/tool lifecycle. No new dependencies or copied branding.

Hierarchy: compact heading + searchable Agent selector, local skill list with search and detail first; platform assigned/library secondary tabs. User correction CONFIRMED: reply has only a 查看执行链路 button, opening a separate Drawer with chronological type/name/status rows and expandable input/results. Do not insert trace summaries into reply prose. Drawer chosen from user's permitted popup alternative using existing AntD conventions; no flip animation.

Tokens: reuse --color-bg*, --color-text*, --color-border*, --color-primary and existing spacing/radius. Neutral surfaces, one primary accent; semantic success/error only. Existing icon library. No gradients or new marketing headers.

Responsive: desktop 1440 and laptop 1024 selector inline; mobile 390 wraps to full width and skill list one column. Long names/paths wrap; no horizontal page overflow. Native button/select keyboard behavior, focus-visible and reduced-motion inherited/supplemented.

States: loading, error retry, no Agent, no local skill, no search match, disconnected/local path unavailable; activity pending, success, error, no captured events and old message fallback. No state claims current availability or successful use without evidence.

Primary paths: Skills navigation → select Agent → local search → open skill metadata/location → switch platform tabs. Chat → submit real task using MCP/Skill → inspect activity → reload and replay.

Gate ledger: 0–5 auto-approved from previous online audit, user's explicit choices, existing token/component evidence and defined states. 6 pilot integrated rather than throwaway; 7 auto-approved for scoped production edits. 8/9 pending rendered desktop/laptop/mobile and real product path evidence.

Gate 8/9: auto-approved after rendered Skills/search/detail/library-copy and real
Codex success/MCP/failure/reload acceptance; evidence in verification.md. Fixed
long-card density and real no-argument tool transient crash during acceptance.
Remaining runtime limitation: tools that do not expose native invocation events
cannot be reported as fully traced; the UI explicitly distinguishes no events.
Delivery is local implementation/preview; production deployment remains out of scope.
