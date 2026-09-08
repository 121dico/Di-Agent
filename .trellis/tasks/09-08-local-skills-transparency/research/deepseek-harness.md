# DeepSeek Harness reference

2026-09-08 read primary sources:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/tool-skill/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-skill/README.md

Pattern: session catalog contains name + capped description. Skill loader retrieves full body on demand from provider. Tool lifecycle events are persisted and UI replays frozen call/result slices, not current catalog; catalog changes must not rewrite historical usage. Skill loaded is observable, actual adherence to instructions is not guaranteed.

Di Agent adaptation: metadata-only machine catalog, local lazy loader (existing MCP get_agent_skill may resolve local-first); use existing tool events/blocks with optional metadata. Keep full local skill text out of upstream trace. Distinguish MCP, Skill, ordinary tool and failed/pending results. Do not infer usage from model narrative.
