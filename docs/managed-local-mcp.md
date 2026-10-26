# Platform-managed local MCP (first release)

The server publishes a credential-free catalog at `GET /daemon/managed-mcps?user_id=<task requester>`. A machine API key in the Bearer header must authenticate a machine owned by that exact requester. Every bridge operation fetches this catalog again; revocation and ownership checks do not rely on a cached `user_id` assertion.

The existing `di-agent-platform` stdio server exposes three progressively disclosed tools to local Agents, including existing Agents with `toolset=none`:

1. `list_managed_mcps({})`: compact connector index and `setup_required` or `configured_unverified` status.
2. `get_managed_mcp_tools({connector_id:"datadream"})`: real MCP handshake and the seven permitted upstream schemas; `connected` means this call succeeded.
3. `call_managed_mcp_tool({connector_id:"datadream",tool_name:"...",arguments:{...}})`: owner-authorized local invocation, preserving upstream errors and result bodies.

## Personal setup

On macOS/Linux, run on the computer that owns the Agent:

```sh
di-agent-daemon --configure-managed-mcp datadream
```

The interactive terminal prompts for project code (pilot default `epower_platform`) and a hidden personal API Key. macOS uses Keychain service `di-agent-datadream-mcp` and the current OS username (the pilot's existing `didi` entry is reused). Linux stores the personal configuration under `~/.di-agent/managed-mcp/datadream.json` with directory mode 0700 and file mode 0600. No Key is added to Git, the catalog, model schemas, process arguments, or the remote server.

The daemon process may instead receive `DI_AGENT_DATADREAM_API_KEY` and `DI_AGENT_DATADREAM_PROJECT_CODE` through the user's own process environment. This is the first-release Windows option; do not pass the key as a CLI argument or commit it in a launcher. Existing managed MCP subprocesses inherit the daemon environment, so environment changes require a safe daemon restart after active tasks finish. Keys configured through Keychain are read on each bridge operation.

Each user must log into their own security assistant's intelligent-agent security and use their own new API Key. A local credential existing is not proof of a valid login, Hive table permissions, or project access.

## Execution boundary

Datadream stays at `http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp` on each user's computer. Deploying the catalog does not host that company service on the Linux server. The local binding pins this exact endpoint and never follows redirects or executes helpers supplied by the server. Adding other connectors requires a reviewed local adapter release as well as a catalog entry.

The first allowlist is `datamap_search_asset`, `datamap_get_table_detail`, `get_hive_table_partition_page_list`, `check_sql_syntax`, `run_sql`, `get_sql_log`, and `get_sql_result`. SQL is a single SELECT, optionally WITH, limited to 20 KiB. DML/DDL, multiple statements, scripts, `TRANSFORM`, `reflect`, and `java_method` are rejected. `run_sql` automatically performs the official SPARK_SQL syntax check and requires an explicit successful result before submission. This lexical policy is a conservative guard, not a replacement for upstream authorization.

Execution remains asynchronous: submit once, then poll the returned task ID through result/log tools. Upstream preview caps, export approvals, and permission failures remain intact. Each HTTP request has a 45-second timeout and an 8 MiB response cap; these limits are not a claim about SQL job duration or upstream capacity.

The legacy Hive probe and Data Map connector retain their existing distinct statuses. Their discovery response points to the managed MCP index; no legacy channel is falsely marked connected.

## Release and validation

Run `bash scripts/test-managed-mcp.sh`, then the normal daemon regression suite. Publishing the backend catalog and downloadable daemon package does not upgrade already-running clients: upgrade their local daemon, wait for existing tasks to finish before restarting, and start a new Agent turn. Old servers return an actionable upgrade/authentication error; unconfigured clients return personal setup instructions.

The real acceptance sequence is owner-authenticated catalog → local metadata lookup → read-only syntax check/submission → task-result retrieval, through the existing platform stdio tools. Unit fixtures alone do not establish real connectivity.
