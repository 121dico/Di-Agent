const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MCP_TOOLS, handleMcpMessage, detectCapabilities } = require('./di-agent-daemon');

const endpoint = 'http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp';
const allowed = ['datamap_search_asset', 'datamap_get_table_detail', 'get_hive_table_partition_page_list', 'check_sql_syntax', 'run_sql', 'get_sql_log', 'get_sql_result'];
const entry = { id: 'datadream', name: '数梦', purpose: 'query', enabled: true, endpoint, execution: 'user_local', transport: 'streamable-http', credential_binding: 'datadream-personal', allowed_tools: allowed };

async function invoke(ctx, name, args = {}, method = 'tools/call') {
  let output = '';
  const write = process.stdout.write;
  process.stdout.write = function(chunk, ...rest) { if (typeof chunk === 'string' && chunk.startsWith('{"jsonrpc":')) { output += chunk; return true; } return write.call(this, chunk, ...rest); };
  try { await handleMcpMessage(JSON.stringify({ id: 42, method, params: { name, arguments: args } }), new Map(MCP_TOOLS.map((tool) => [tool.name, tool])), ctx); }
  finally { process.stdout.write = write; }
  return JSON.parse(output).result;
}

function context(getCatalog = async () => ({ data: { version: 1, connectors: [entry] } })) {
  return { userId: 'owner', agentId: 'agent', allowedTools: null, currentAgent: { id: 'agent', tools_config: '{"toolset":"none"}' }, callManagedMcpApi: getCatalog };
}

test('platform stdio discovers managed tools and rejects owner/catalog mismatch before local access', async () => {
  const initialized = await invoke(context(), undefined, {}, 'initialize');
  assert.equal(initialized.serverInfo.version, require('../package.json').version);
  assert.ok(detectCapabilities().includes('managed_mcp_v1'));
  const ctx = context(async () => { throw new Error('HTTP 403 secret'); });
  const denied = await invoke(ctx, 'get_managed_mcp_tools', { connector_id: 'datadream' });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /鉴权失败/);
  assert.doesNotMatch(JSON.stringify(denied), /secret/);
  const invalid = await invoke(context(async () => ({ data: { version: 1, connectors: [{ ...entry, endpoint: 'http://evil/' }] } })), 'get_managed_mcp_tools', { connector_id: 'datadream' });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /不兼容/);
});

test('stdio progressive tools use personal headers, MCP session, read-only gate and preserve upstream failure', async (t) => {
  const originalKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  process.env.DI_AGENT_DATADREAM_API_KEY = 'test-personal-key-not-real';
  t.after(() => { if (originalKey === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = originalKey; });
  const requests = [];
  let syntaxOK = true;
  let redirect = false;
  let upstreamError = false;
  let jsonMode = false;
  let rpcError = false;
  let oversize = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    assert.equal(req.headers.authorization, 'Bearer test-personal-key-not-real');
    assert.equal(req.headers['project-code'], 'epower_platform');
    if (redirect) { res.writeHead(302, { Location: 'http://untrusted/' }); res.end(); return; }
    if (rpcError) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 0, error: { code: 50102, message: 'private upstream diagnostic' } })); return; }
    if (oversize) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('x'.repeat(8 * 1024 * 1024 + 1)); return; }
    if (body.method !== 'initialize') assert.equal(req.headers['mcp-session-id'], 'test-session');
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test' } };
    else if (body.method === 'tools/list') result = { tools: [...allowed, 'create_task'].map((name) => ({ name, inputSchema: { type: 'object' } })) };
    else if (body.params.name === 'check_sql_syntax') result = { isError: false, content: [{ type: 'text', text: JSON.stringify(`【SQL语法检查】\n状态：${syntaxOK ? '通过' : '失败'}\n结果：${syntaxOK ? 'SQL语法正确，无错误' : 'bad syntax'}`) }] };
    else result = { isError: upstreamError, content: [{ type: 'text', text: upstreamError ? 'permission denied' : 'taskId: 123' }] };
    if (jsonMode) { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'test-session' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const originalRequest = http.request;
  t.mock.method(http, 'request', (url, options) => { assert.equal(url, endpoint); return originalRequest(`http://127.0.0.1:${server.address().port}`, options); });
  let ownerChecks = 0;
  const ctx = context(async () => { ownerChecks++; return { data: { version: 1, connectors: [entry] } }; });
  const listed = await invoke(ctx, 'list_managed_mcps');
  assert.match(listed.content[0].text, /configured_unverified/);
  assert.equal(requests.length, 0);
  const tools = await invoke(ctx, 'get_managed_mcp_tools', { connector_id: 'datadream' });
  assert.equal(JSON.parse(tools.content[0].text).tools.length, 7);
  assert.doesNotMatch(JSON.stringify(tools), /create_task|test-personal-key/);
  const call = (tool_name, args) => invoke(ctx, 'call_managed_mcp_tool', { connector_id: 'datadream', tool_name, arguments: args });
  const success = await call('run_sql', { sql: 'WITH t AS (SELECT 1 AS n) SELECT n FROM t;' });
  assert.equal(success.isError, false);
  assert.equal(requests.filter((r) => r.method === 'tools/call').map((r) => r.params.name).join(','), 'check_sql_syntax,run_sql');
  for (const sql of ['DELETE FROM db.t', 'WITH t AS (SELECT 1) INSERT INTO db.t SELECT * FROM t', 'SELECT 1; DROP TABLE db.t', "SELECT reflect('java.lang.Runtime','getRuntime')", "SELECT `reflect` /* hidden */ ('x','y')", "SELECT `java_method`('x','y')", "SELECT TRANSFORM(x) USING 'sh' FROM db.t", 'SELECT 1 INTO OUTFILE x', "SELECT 'unclosed"]) {
    const result = await call('run_sql', { sql }); assert.equal(result.isError, true, sql);
  }
  assert.equal(requests.filter((r) => r.params?.name === 'run_sql').length, 1);
  syntaxOK = false;
  assert.equal((await call('run_sql', { sql: 'SELECT 1' })).isError, true);
  assert.equal(requests.filter((r) => r.params?.name === 'run_sql').length, 1);
  assert.equal((await call('create_task', {})).isError, true);
  assert.equal((await call('check_sql_syntax', { sql: 'SELECT 1', projectCode: 'other' })).isError, true);
  upstreamError = true;
  jsonMode = true;
  assert.equal((await call('datamap_get_table_detail', { uri: 'db.table' })).isError, true);
  rpcError = true;
  const loginError = await call('get_sql_result', { taskId: '123' });
  assert.equal(loginError.isError, true);
  assert.match(loginError.content[0].text, /登录态/);
  assert.doesNotMatch(JSON.stringify(loginError), /private upstream diagnostic/);
  rpcError = false;
  oversize = true;
  assert.match((await call('get_sql_result', { taskId: '123' })).content[0].text, /超过 8 MiB/);
  oversize = false;
  redirect = true;
  assert.equal((await call('get_sql_result', { taskId: '123' })).isError, true);
  const beforeRevocation = requests.length;
  ctx.callManagedMcpApi = async () => { throw new Error('revoked'); };
  assert.equal((await call('get_sql_result', { taskId: '123' })).isError, true);
  assert.equal(requests.length, beforeRevocation);
  assert.ok(ownerChecks >= 13);
});

test('missing personal credential is actionable and never connected', async (t) => {
  const prior = process.env.DI_AGENT_DATADREAM_API_KEY;
  process.env.DI_AGENT_DATADREAM_API_KEY = 'invalid';
  t.after(() => { if (prior === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = prior; });
  const result = await invoke(context(), 'get_managed_mcp_tools', { connector_id: 'datadream' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /configure-managed-mcp/);
});
