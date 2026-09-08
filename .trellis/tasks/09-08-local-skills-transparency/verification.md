# Verification evidence — local Skills and execution transparency

Date: 2026-09-08. Fixed review baseline:
`bd2536cdc25d822daa8ba32a0374c2eb3bbbde85`.

## Backend verification

Use the repository test runner. Go was not installed on PATH; the official,
repository-pinned Go 1.26.3 toolchain was downloaded to `.tmp/toolchains/go`.

```bash
GO_BIN="$PWD/.tmp/toolchains/go/bin/go" ./scripts/test.sh ./internal/model ./internal/service
GO_BIN="$PWD/.tmp/toolchains/go/bin/go" ./scripts/test.sh ./internal/service/tool_specs
```

Both commands passed after the integration fixes. `git diff --check` passed.
Relevant regression tests include:

- `TestRegistrationsStoreLocalSkillIndexWithoutBody`: both registration endpoints
  retain purpose/source but omit body text and the `detail` key.
- `TestAgentContextIncludesLocalIndexWithoutPlatformAssignment`: local purpose,
  usage, and name-only loading instruction appear without custom assignment.
- `TestToolTraceMetadataAndInputSurviveHistoryReplay`: input and MCP/Skill
  metadata survive serialization; failed tool results do not terminate streaming.
- `TestLocalSkillTraceRedactsBodyAcrossBatchesButKeepsPlatformOutput` and
  `TestLegacyLocalSkillResultRedactedAfterPartialInputInSameBatch`: local body
  suppression works across batches and legacy partial arguments.
- `TestAgentEventAcceptsNativeObjectToolResults`: object-shaped native MCP output
  no longer rejects the entire batch. This test failed before the decoder fix.
- `TestParallelLegacyToolInputsMatchInvocationIDs`: interleaved calls retain their
  own arguments; unknown IDs do not corrupt the last call. This test failed
  before exact-ID routing was added.

## Actual cross-language transport probe

The real daemon `createToolTrace` module generated seven events using camelCase
native invocation IDs: local Skill success, local Skill failure, a successful
MCP call with structured object output, and a final text event. The original
local result fixture contained `PRIVATE_LOCAL_SKILL_BODY` as a sentinel.

A temporary Go test loaded that generated JSON and mirrored the handler boundary:
first event batch → sanitizer → streaming buffer → second batch with previous
blocks → sanitizer → outgoing events and persisted blocks. It asserted seven
blocks, stable IDs, local success/failure, `server_name=github`, preserved MCP
JSON output, and no sentinel in either server output representation. Passed.

A temporary Vitest probe consumed all three representations (raw daemon events,
server outgoing events, persisted blocks) through the real frontend reducer and
`executionTrace`. Every representation produced exactly:

| Invocation ID | Type | State |
|---|---|---|
| `local-ok` | Skill | success |
| `local-fail` | Skill | error |
| `mcp-1` | MCP | success |

The MCP result was `{"matches":["guide"]}` in every representation, and the
private-body sentinel was absent. Vitest: 1 test passed. Temporary probe source
files were removed after execution. Local evidence artifacts remain in:

- `.tmp/skills-contract/daemon-events.json`
- `.tmp/skills-contract/server-events.json`
- `.tmp/skills-contract/server-blocks.json`

This is executable component integration evidence, not a live network or
production-Agent execution claim. Real browser/product acceptance is recorded
separately by the main task.

## Full backend suite and independently confirmed baseline failure

The full `./scripts/test.sh` run passed service, model, repository, server,
WebSocket, and other tested packages, but failed the handler test
`TestServeSite_RejectsTraversalIntoAnotherDeployment` at `deployment_test.go:147`:
actual HTTP 404, expected 403.

To establish whether this task introduced the failure, the exact baseline was
extracted into an isolated `.tmp/baseline-deployment` directory using:

```bash
mkdir -p .tmp/baseline-deployment
git archive bd2536cdc25d822daa8ba32a0374c2eb3bbbde85 src/backend scripts/test.sh | tar -x -C .tmp/baseline-deployment
GO_BIN="$PWD/.tmp/toolchains/go/bin/go" bash -c 'cd .tmp/baseline-deployment && ./scripts/test.sh ./internal/handler -run TestServeSite_RejectsTraversalIntoAnotherDeployment'
```

The baseline-only test reproduced the identical failure at line 147. The task
diff did not modify `deployment.go` or `deployment_test.go`. No unrelated fix
was made; the full backend suite must therefore be reported as having this
known baseline failure, not as entirely passing.

## Integration corrections identified during review

- Native object tool results needed string normalization at the daemon boundary
  plus receive compatibility in Go.
- The server prompt originally requested `source_path` as a loader argument;
  the actual loader accepts only `name`. The prompt and tool catalog description
  now agree with the schema. ToolRegistry registration updates persisted tool
  descriptions on server startup without granting additional tools.
- Parallel legacy input fragments needed exact-ID routing in both reducers.
- Trace redaction alone was insufficient for Codex's missing final-output-file
  fallback: raw structured stdout could become `task.complete.result`. The
  daemon change now extracts completed assistant messages instead of returning
  the raw protocol transcript; its regression is covered in daemon adapter tests.

## Live product acceptance (isolated environment)

The running production server on :8080 and its dist were left unchanged. Built
and served the implementation on :18080 with a schema-only isolated database,
then used the supplied account in the browser. An isolated real Codex Desktop
runtime loaded the actual local skill directory through a symlink; no source
skill files were changed. Enabled plugin discovery was separately verified
against real local installation evidence: 30 base + 9 enabled plugin skills.

Browser acceptance covered compact top Agent selection, local Skills as default,
search, metadata detail, local index-only library copy, and secondary platform
library. Real Agent execution loaded ask-matt, called list_agents, and attempted
an intentionally missing skill. The independent reply Drawer showed, in order:
Skill success, MCP success, Skill failure. Input/name/path and invocation IDs
were visible; local Skill result contained only load metadata. Refreshing the
page retained the same three IDs, order, and states. No raw skill body appeared
in the transmitted result or reply. No mock result was inserted into the UI.

Live acceptance caught a taskTimeline crash when Go omitempty omitted the text
field on a no-argument list_agents tool call. A real-shape regression reproduced
it before the fix; live/history normalization now retains that call with empty
text. Rebuilt and reran the real success/failure scenario without Recovery.

Final frontend suite: 55 files, 238 tests passed. Final npm daemon suite: 214
passed. Go daemon tests passed. Backend relevant tests passed; the documented
baseline-only handler failure remains. Isolated production build and TypeScript
passed; Vite reported existing bundle-size warnings.

Responsive checks used desktop/laptop and 390px CSS viewports. At 390px, the
existing global navigation was collapsed, Skills used one column, and the Skill
detail / real execution Drawer fit the viewport; expanded JSON results wrapped
without horizontal overflow. Long local card descriptions are capped at three
lines and paths at two; detail retains full metadata. Temporary browser viewport
overrides are reset after acceptance.
