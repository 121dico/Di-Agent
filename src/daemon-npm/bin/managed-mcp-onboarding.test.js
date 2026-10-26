const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MANAGED_MCP_TOOLS } = require('../cli/managed-mcp');

const entry = { id: 'cooper', name: 'Cooper', purpose: '读取公司文档', enabled: true,
  execution: 'user_local', transport: 'streamable-http',
  endpoint: 'http://127.0.0.1:28582/v1/hub/cooper_mcp', credential_binding: 'company-personal',
  allowed_tools: ['readContent', 'getKnowledgeDirectory'] };
const invoke = (ctx, name, args = {}) => {
  const tool = MANAGED_MCP_TOOLS.find((item) => item.name === name);
  assert.ok(tool, 'public MCP tool must be discoverable: ' + name);
  return tool.run(args, ctx);
};

test('owner discovers, connects, reads and revokes Cooper without sharing another scope', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-mcp-onboarding-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const previousKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  process.env.DI_AGENT_DATADREAM_API_KEY = 'test-onboarding-personal-key';
  t.after(() => { if (previousKey === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = previousKey; });
  let available = true;
  const ctx = { userId: 'owner', managedMcpScope: 'platform-machine-A',
    callManagedMcpApi: async () => ({ data: { version: 1, connectors: available ? [entry] : [] } }) };
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), /绑定/);
  require('../cli/managed-mcp-state').bindCredential(ctx, 'test-onboarding-personal-key');
  const discovered = await invoke(ctx, 'list_managed_mcps', { keyword: 'Cooper' });
  assert.equal(discovered.connectors[0]?.status, 'not_enabled');
  await assert.rejects(invoke(ctx, 'get_managed_mcp_tools', { connector_id: 'cooper' }), /未启用/);

  const calls = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-onboarding-personal-key');
    assert.equal(req.headers['project-code'], undefined);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw); calls.push(request);
    if (request.id === undefined) { res.writeHead(202); res.end(); return; }
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture' } };
    if (request.method === 'tools/list') result = { tools: ['readContent', 'getKnowledgeDirectory', 'createCooperDocument'].map(name => ({ name, inputSchema: { type: 'object' } })) };
    if (request.method === 'tools/call') result = { content: [{ type: 'text', text: 'official document fixture' }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const realRequest = http.request;
  t.mock.method(http, 'request', (url, options) => {
    assert.equal(url, entry.endpoint);
    return realRequest('http://127.0.0.1:' + server.address().port, options);
  });
  const connected = await invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.tools.length, 2);
  await assert.rejects(invoke({ ...ctx, userId: 'another' }, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), /绑定/);
  await assert.rejects(invoke({ ...ctx, managedMcpScope: 'platform-machine-B' }, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), /绑定/);
  const read = await invoke(ctx, 'call_managed_mcp_tool', {
    connector_id: 'cooper', tool_name: 'readContent', arguments: { resourceId: '2209268754504', appId: 4 },
  });
  assert.equal(read.content[0].text, 'official document fixture');
  const callCount = calls.filter(item => item.method === 'tools/call').length;
  await assert.rejects(invoke(ctx, 'call_managed_mcp_tool', { connector_id: 'cooper', tool_name: 'createCooperDocument', arguments: {} }), /未授权/);
  await assert.rejects(invoke({ ...ctx, userId: 'another' }, 'get_managed_mcp_tools', { connector_id: 'cooper' }), /未启用/);
  await assert.rejects(invoke({ ...ctx, managedMcpScope: 'platform-machine-B' }, 'get_managed_mcp_tools', { connector_id: 'cooper' }), /未启用/);
  assert.equal(calls.filter(item => item.method === 'tools/call').length, callCount);
  await invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: false });
  await assert.rejects(invoke(ctx, 'call_managed_mcp_tool', { connector_id: 'cooper', tool_name: 'readContent', arguments: { resourceId: '2209268754504', appId: 4 } }), /未启用/);
  available = false;
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }));
  assert.doesNotMatch(JSON.stringify(connected), /test-onboarding-personal-key|createCooperDocument/);
});

test('untrusted endpoint and denied owner never send a personal credential', async (t) => {
  let requests = 0;
  t.mock.method(http, 'request', () => { requests++; throw new Error('must not connect'); });
  const ctx = { userId: 'owner', managedMcpScope: 'machine',
    callManagedMcpApi: async () => ({ data: { version: 1, connectors: [{ ...entry, endpoint: 'http://untrusted.example/mcp' }] } }) };
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), /不兼容/);
  ctx.callManagedMcpApi = async () => { throw new Error('private platform diagnostic'); };
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: false }), /目录鉴权失败/);
  assert.equal(requests, 0);
});

test('failed or concurrently revoked onboarding never persists a connected state', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-mcp-failure-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const previousKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  process.env.DI_AGENT_DATADREAM_API_KEY = 'test-onboarding-personal-key';
  t.after(() => { if (previousKey === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = previousKey; });
  let mode = 'denied';
  const ctx = { userId: 'owner', managedMcpScope: 'machine',
    callManagedMcpApi: async () => ({ data: { version: 1, connectors: [entry] } }) };
  require('../cli/managed-mcp-state').bindCredential(ctx, 'test-onboarding-personal-key');
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    if (mode === 'denied') { res.writeHead(403); res.end('secret-server-error'); return; }
    if (request.id === undefined) { res.writeHead(202); res.end(); return; }
    if (request.method === 'tools/list') await invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: false });
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture' } }
      : { tools: [{ name: 'readContent', inputSchema: { type: 'object' } }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const realRequest = http.request;
  t.mock.method(http, 'request', (_url, options) => realRequest('http://127.0.0.1:' + server.address().port, options));
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), error => /403/.test(error.message) && !error.message.includes('secret-server-error'));
  assert.equal((await invoke(ctx, 'list_managed_mcps')).connectors[0].status, 'not_enabled');
  mode = 'revoke';
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: 'cooper', enabled: true }), /配置已变化/);
  assert.equal((await invoke(ctx, 'list_managed_mcps')).connectors[0].status, 'not_enabled');
});

test('activation tool requires explicit agent authorization at the stdio boundary', async (t) => {
  const { MCP_TOOLS, handleMcpMessage, resolveAllowedTools } = require('./di-agent-daemon');
  const ctx = { agentId: 'agent', currentAgent: { id: 'agent', tools_config: '{"allowed_tools":[]}' }, allowedTools: null };
  assert.ok(!(await resolveAllowedTools(ctx)).includes('set_managed_mcp_enabled'));
  let output = '';
  const write = process.stdout.write;
  t.mock.method(process.stdout, 'write', function(chunk, ...rest) {
    if (typeof chunk === 'string' && chunk.startsWith('{"jsonrpc":')) { output += chunk; return true; }
    return write.call(this, chunk, ...rest);
  });
  await handleMcpMessage(JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'set_managed_mcp_enabled', arguments: { connector_id: 'cooper', enabled: true } } }), new Map(MCP_TOOLS.map(tool => [tool.name, tool])), ctx);
  assert.equal(JSON.parse(output).result.isError, true);
  assert.match(JSON.parse(output).result.content[0].text, /未授权/);
  ctx.currentAgent.tools_config = '{"allowed_tools":["set_managed_mcp_enabled"]}'; ctx.allowedTools = null;
  assert.ok((await resolveAllowedTools(ctx)).includes('set_managed_mcp_enabled'));
});

test('revocation remains available after interrupted writes and fences a stale activation', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-mcp-revoke-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const { readConnection, saveConnection } = require('../cli/managed-mcp-state');
  const ctx = { userId: 'owner', managedMcpScope: 'machine' };
  saveConnection(ctx, 'cooper', true, null);
  const before = readConnection(ctx, 'cooper');
  const scope = fs.readdirSync(path.join(home, '.di-agent/managed-mcp/connections'))[0];
  fs.writeFileSync(path.join(home, '.di-agent/managed-mcp/connections', scope, 'cooper.json.lock'), 'abandoned', { mode: 0o600 });
  saveConnection(ctx, 'cooper', false);
  assert.equal(readConnection(ctx, 'cooper').enabled, false);
  assert.throws(() => saveConnection(ctx, 'cooper', true, before.revision), /配置已变化/);
});
