const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const intranet = require('../cli/managed-mcp-intranet');
const state = require('../cli/managed-mcp-state');
const { MANAGED_MCP_TOOLS } = require('../cli/managed-mcp');

const entry = { id: 'intranet-fetcher', name: '内网页面检索', purpose: '读取公司内网页面', enabled: true,
  source: 'mcphub', source_url: intranet.SOURCE, execution: 'user_local', transport: 'stdio',
  package: '@didi/intranet-fetcher-mcp', version: '4.1.1', credential_binding: 'chrome-local-confirmed',
  allowed_tools: ['fetch_intranet'] };

function invoke(ctx, name, args) {
  return MANAGED_MCP_TOOLS.find(tool => tool.name === name).run(args, ctx);
}

test('mcphub discovery, scoped binding, activation, read and revoke', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-mcphub-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const ctx = { userId: 'owner', managedMcpScope: 'machine-1',
    callManagedMcpApi: async () => ({ data: { version: 1, connectors: [entry] } }) };
  const discovered = await invoke(ctx, 'list_managed_mcps', { keyword: 'mcphub' });
  assert.equal(discovered.connectors[0].id, 'intranet-fetcher');
  assert.equal(discovered.connectors[0].status, 'not_enabled');
  await assert.rejects(invoke(ctx, 'set_managed_mcp_enabled', { connector_id: entry.id, enabled: true }), /绑定/);
  state.bindBrowser(ctx);
  await assert.rejects(invoke({ ...ctx, userId: 'other' }, 'set_managed_mcp_enabled', { connector_id: entry.id, enabled: true }), /绑定/);
  await assert.rejects(invoke({ ...ctx, managedMcpScope: 'machine-2' }, 'set_managed_mcp_enabled', { connector_id: entry.id, enabled: true }), /绑定/);
  t.mock.method(intranet, 'listTools', async () => [{ name: 'fetch_intranet', inputSchema: { type: 'object' } }]);
  t.mock.method(intranet, 'callTool', async () => ({ isError: false, content: [{ type: 'text', text: 'company page' }] }));
  const active = await invoke(ctx, 'set_managed_mcp_enabled', { connector_id: entry.id, enabled: true });
  assert.equal(active.status, 'connected');
  const tools = await invoke(ctx, 'get_managed_mcp_tools', { connector_id: entry.id });
  assert.equal(tools.tools[0].name, 'fetch_intranet');
  const read = await invoke(ctx, 'call_managed_mcp_tool', { connector_id: entry.id,
    tool_name: 'fetch_intranet', arguments: { url: intranet.SOURCE } });
  assert.equal(read.content[0].text, 'company page');
  await assert.rejects(invoke(ctx, 'call_managed_mcp_tool', { connector_id: entry.id,
    tool_name: 'screenshot_intranet', arguments: { url: intranet.SOURCE } }), /未授权/);
  await invoke(ctx, 'set_managed_mcp_enabled', { connector_id: entry.id, enabled: false });
  await assert.rejects(invoke(ctx, 'call_managed_mcp_tool', { connector_id: entry.id,
    tool_name: 'fetch_intranet', arguments: { url: intranet.SOURCE } }), /撤销|尚未启用/);
});

test('mcphub allows only company HTTPS pages and bounded read parameters', () => {
  assert.equal(intranet.validateArguments({ url: intranet.SOURCE }).maxLength, 12000);
  for (const url of ['http://boss.xiaojukeji.com/', 'https://example.com/',
    'https://xiaojukeji.com.evil.test/', 'https://u:p@boss.xiaojukeji.com/']) {
    assert.throws(() => intranet.validateArguments({ url }), /HTTPS|域名/);
  }
  assert.throws(() => intranet.validateArguments({ url: intranet.SOURCE, maxLength: 999999 }), /上限/);
  assert.throws(() => intranet.validateArguments({ url: intranet.SOURCE, command: 'shell' }), /参数无效/);
  assert.throws(() => intranet.validateConnector({ ...entry, package: '@other/npm' }), /不兼容/);
});
