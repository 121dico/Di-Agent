const assert = require('node:assert/strict');
const test = require('node:test');
const { MCP_TOOLS, handleMcpMessage, resolveAllowedTools } = require('./di-agent-daemon.js');

function tool(name) {
  return MCP_TOOLS.find((item) => item.name === name);
}

const agent = { id: 'existing-agent', tools_config: '{"toolset":"none","allowed_tools":[]}' };

test('existing agents discover compact internal sources without receiving guides', async () => {
  const allowed = await resolveAllowedTools({ agentId: agent.id, currentAgent: agent, allowedTools: null });
  assert.ok(allowed.includes('discover_internal_sources'));
  assert.ok(allowed.includes('get_internal_source_guide'));
  const result = await tool('discover_internal_sources').run({});
  assert.deepEqual(result.sources.map((source) => source.id), ['cooper', 'gitlab', 'data_map', 'hive']);
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
  assert.equal(JSON.parse(output[1].result.content[0].text).sources.length, 4);
  assert.equal(output[2].result.isError, true);
});
