const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { MCP_TOOLS, callDataMapMachineApi, handleMcpMessage, resolveAllowedTools } = require('./di-agent-daemon.js');

function tool(name) {
  return MCP_TOOLS.find((item) => item.name === name);
}

const agent = { id: 'existing-agent', tools_config: '{"toolset":"none","allowed_tools":[]}' };

test('existing agents discover compact internal sources without receiving guides', async () => {
  const allowed = await resolveAllowedTools({ agentId: agent.id, currentAgent: agent, allowedTools: null });
  assert.ok(allowed.includes('discover_internal_sources'));
  assert.ok(allowed.includes('get_internal_source_guide'));
  const result = await tool('discover_internal_sources').run({});
  assert.deepEqual(result.sources.map((source) => source.id), ['cooper', 'gitlab', 'data_map', 'hive', 'hive_data']);
  assert.ok(result.sources.every((source) => source.status === 'not_connected'));
  assert.ok(JSON.stringify(result).length < 2000);
  assert.ok(!JSON.stringify(result).includes('guide'));
});

test('source guide discloses one source only and rejects unknown IDs', async () => {
  const result = await tool('get_internal_source_guide').run({ source_id: 'cooper' });
  assert.equal(result.source_id, 'cooper');
  assert.equal(result.status, 'not_connected');
  assert.match(result.guidance, /未接入/);
  for (const other of ['GitLab', '数据地图', 'Hive']) {
    assert.ok(!JSON.stringify(result).includes(other));
  }
  await assert.rejects(tool('get_internal_source_guide').run({ source_id: 'unknown' }), /未知资料源/);
  await assert.rejects(tool('get_internal_source_guide').run({ source_id: 'secret-value'.repeat(1000) }), (error) => {
    assert.equal(error.message, '未知资料源');
    return true;
  });
  const hiveGuide = await tool('get_internal_source_guide').run({ source_id: 'hive' });
  assert.match(hiveGuide.guidance, /Hive 真实数据/);
  assert.match(hiveGuide.guidance, /不能声称已读取业务数据/);
  assert.doesNotMatch(hiveGuide.guidance, /适合在明确表、字段和日期后核对实际数值/);
});

test('MCP tools/list and tools/call expose governed discovery to ordinary agents', async () => {
  const toolMap = new Map(MCP_TOOLS.map((item) => [item.name, item]));
  const ctx = { agentId: agent.id, currentAgent: agent, allowedTools: null };
  const output = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output.push(JSON.parse(chunk)); return true; };
  try {
    await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), toolMap, ctx);
    await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'discover_internal_sources', arguments: {} } }), toolMap, ctx);
    await handleMcpMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_internal_source_guide', arguments: { source_id: 'unknown' } } }), toolMap, ctx);
  } finally {
    process.stdout.write = originalWrite;
  }
  const names = output[0].result.tools.map((item) => item.name);
  assert.ok(names.includes('discover_internal_sources'));
  assert.ok(names.includes('get_internal_source_guide'));
  assert.equal(JSON.parse(output[1].result.content[0].text).sources.length, 5);
  assert.equal(output[2].result.isError, true);
});

test('Data Map Hive metadata status is dynamic and search sends only bounded query fields', async () => {
  const calls = [];
  const ctx = {
    agentId: agent.id,
    currentAgent: agent,
    allowedTools: null,
    callDataMapApi: async (method, path, options) => {
      calls.push({ method, path, options });
      if (path === '/daemon/internal-sources/status') return { data: { status: 'configured_unverified', capability: 'hive_table_metadata_only' } };
      if (path === '/daemon/internal-sources/data-map/hive/tables') return { data: { source: 'data_map', tables: [{ db_name: 'epower_platform', table_name: 'price_sensitive_v1_3' }] } };
      throw new Error('unexpected path');
    },
  };
  const allowed = await resolveAllowedTools(ctx);
  assert.ok(allowed.includes('search_data_map_hive_tables'));
  const catalog = await tool('discover_internal_sources').run({}, ctx);
  assert.equal(catalog.sources.find((source) => source.id === 'data_map').status, 'configured_unverified');
  assert.equal(catalog.sources.find((source) => source.id === 'hive').status, 'not_connected');
  const guide = await tool('get_internal_source_guide').run({ source_id: 'data_map' }, ctx);
  assert.match(guide.guidance, /search_data_map_hive_tables/);
  const result = await tool('search_data_map_hive_tables').run({ db_name: 'epower_platform', prefix: 'price_sensitive', page_no: 1, page_size: 10 }, ctx);
  assert.deepEqual(result.tables, [{ db_name: 'epower_platform', table_name: 'price_sensitive_v1_3' }]);
  assert.deepEqual(calls.at(-1), { method: 'GET', path: '/daemon/internal-sources/data-map/hive/tables', options: { query: { db_name: 'epower_platform', prefix: 'price_sensitive', page_no: 1, page_size: 10 } } });
});

test('Data Map machine key travels only in Authorization header', async () => {
  let observed;
  const server = http.createServer((req, res) => {
    observed = { path: req.url, authorization: req.headers.authorization };
    res.setHeader('Content-Type', 'application/json');
    res.end('{"code":0,"data":{"status":"not_configured"}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callDataMapMachineApi(`http://127.0.0.1:${address.port}`, 'sk_machine_test_private', 'GET', '/daemon/internal-sources/status', {}, 'owner');
    assert.equal(observed.authorization, 'Bearer sk_machine_test_private');
    assert.equal(observed.path, '/daemon/internal-sources/status?user_id=owner');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Data Map source status distinguishes denied machine from temporary outage', async () => {
  const ctx = { callDataMapApi: async () => { throw new Error('HTTP 403: denied'); } };
  const denied = await tool('discover_internal_sources').run({}, ctx);
  assert.equal(denied.sources.find((source) => source.id === 'data_map').status, 'no_permission');
  ctx.callDataMapApi = async () => { throw new Error('HTTP 503: unavailable'); };
  const unavailable = await tool('discover_internal_sources').run({}, ctx);
  assert.equal(unavailable.sources.find((source) => source.id === 'data_map').status, 'temporarily_unavailable');
});

test('Agent can discover and probe the owner-bound Hive data channel separately from Data Map assets', async () => {
  const calls = [];
  const ctx = {
    agentId: agent.id,
    currentAgent: agent,
    allowedTools: null,
    callDataMapApi: async () => ({ data: { status: 'not_configured', capability: 'hive_table_metadata_only' } }),
    callHiveDataApi: async (method, path, options) => {
      calls.push({ method, path, options });
      if (path === '/daemon/internal-sources/hive-data/status') {
        return { data: { status: 'connected', capability: 'approved_hive_dt_probe_only' } };
      }
      if (path === '/daemon/internal-sources/hive-data/probe') {
        return { data: { table_name: 'epower_platform.price_sensitive_v1_3', dt: '2026-10-07', readable: true, row_found: true } };
      }
      throw new Error('unexpected Hive path');
    },
  };
  const allowed = await resolveAllowedTools(ctx);
  assert.ok(allowed.includes('probe_hive_data'));
  const catalog = await tool('discover_internal_sources').run({}, ctx);
  assert.equal(catalog.sources.find((source) => source.id === 'data_map').status, 'not_configured');
  assert.equal(catalog.sources.find((source) => source.id === 'hive_data').status, 'connected');
  assert.equal(catalog.sources.find((source) => source.id === 'hive').status, 'connected');
  const legacyGuide = await tool('get_internal_source_guide').run({ source_id: 'hive' }, ctx);
  assert.match(legacyGuide.guidance, /probe_hive_data/);
  const guide = await tool('get_internal_source_guide').run({ source_id: 'hive_data' }, ctx);
  assert.match(guide.guidance, /probe_hive_data/);
  const probe = await tool('probe_hive_data').run({ table_name: 'epower_platform.price_sensitive_v1_3', dt: '2026-10-07' }, ctx);
  assert.equal(probe.readable, true);
  assert.equal(probe.row_found, true);
  assert.deepEqual(calls.at(-1), {
    method: 'POST', path: '/daemon/internal-sources/hive-data/probe',
    options: { body: { table_name: 'epower_platform.price_sensitive_v1_3', dt: '2026-10-07' } },
  });
});

test('Hive data guide asks for the requesters own Hadoop login when there is no session', async () => {
  const ctx = { callHiveDataApi: async () => ({ data: { status: 'login_required', capability: 'approved_hive_dt_probe_only' } }) };
  const guide = await tool('get_internal_source_guide').run({ source_id: 'hive_data' }, ctx);
  assert.equal(guide.status, 'login_required');
  assert.match(guide.guidance, /自己的 Hadoop 账号登录/);
  assert.doesNotMatch(guide.guidance, /借用.*凭据/);
});
