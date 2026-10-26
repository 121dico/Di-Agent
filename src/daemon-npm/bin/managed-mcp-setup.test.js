const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createManagedMcpSetup, fetchOwnerCatalog } = require('../cli/managed-mcp-setup');
const OWNER = '11111111-1111-4111-8111-111111111111';
const KEY = 'fixture-personal-key-never-real';
const connector = { id: 'datadream', enabled: true, endpoint: 'http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp', execution: 'user_local', transport: 'streamable-http', credential_binding: 'datadream-personal', allowed_tools: ['datamap_search_asset'] };
function fixture(t, overrides = {}) {
  let url; let saved = 0; let credential = { key: KEY, project: 'fixture_project' };
  const setup = createManagedMcpSetup({
    loadCredential: () => credential,
    configState: () => ({ key_configured: !!credential, project_code: credential?.project || '', credential_source: credential ? 'keychain' : 'missing', project_source: credential ? 'file' : 'missing' }),
    authorize: async (user) => { if (user !== OWNER) throw new Error(KEY); return { version: 1, connectors: [connector] }; },
    openBrowser: async (value) => { url = new URL(value); },
    saveCredential: async (input) => { saved++; credential = { key: input.key || credential.key, project: input.project }; },
    probeProxy: async () => true,
    openClient: async () => ({ rpc: async (method) => { assert.equal(method, 'tools/list'); return { tools: [{ name: 'datamap_search_asset' }] }; } }),
    ...overrides,
  });
  t.after(() => setup.close());
  const handle = (action = 'inspect', user = OWNER) => setup.handle(`managed_mcp.${action}`, { request_id: 'fixture_request', user_id: user });
  function request(route, body = {}, headers = {}, method = 'POST', raw = false) {
    const parts = url.hash.slice(1).split('.');
    const payload = raw ? body : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(new URL(route, url.origin), { method, headers: { Host: url.host, Origin: url.origin, 'Content-Type': 'application/json', 'X-DiAgent-Session': parts[0], 'X-CSRF-Token': parts[1], ...headers } }, (res) => {
        let text = ''; res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data, headers: res.headers }); });
      });
      req.on('error', reject); req.end(method === 'GET' ? undefined : payload);
    });
  }
  return { setup, handle, request, get url() { return url; }, get saved() { return saved; }, setCredential: (value) => { credential = value; } };
}

test('real handshake required; owner check and all returned fields exclude secrets/session URL', async (t) => {
  const f = fixture(t);
  const result = await f.handle();
  assert.equal(result.status, 'connected'); assert.equal(result.checks[4].status, 'unverified');
  assert.equal(result.configuration_changed, false);
  const opened = await f.handle('configure'); assert.equal(opened.opened, true);
  assert.equal(opened.status, 'configured_unverified');
  assert.doesNotMatch(JSON.stringify(opened), /fixture-personal-key|127\.0\.0\.1|[a-f0-9]{64}/);
  assert.deepEqual(await f.handle('inspect', '22222222-2222-4222-8222-222222222222'), { request_id: 'fixture_request', status: 'failed', error_code: 'request_denied' });
});

test('local config routes pin Host, Origin, CSRF and token, reject CORS, and serve strict private assets', async (t) => {
  const f = fixture(t); await f.handle('configure');
  const page = await f.request('/setup', {}, {}, 'GET');
  assert.equal(page.status, 200); assert.match(page.data, /连接数梦/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await f.request('/state')).status, 200);
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }, { Origin: 'null' }, { 'X-CSRF-Token': 'wrong' }, { 'X-DiAgent-Session': 'wrong' }]) assert.equal((await f.request('/save', { key: KEY, project: 'changed' }, headers)).status, 403);
  const cors = await f.request('/save', {}, {}, 'OPTIONS');
  assert.equal(cors.status, 404); assert.equal(cors.headers['access-control-allow-origin'], undefined);
  assert.equal(f.saved, 0);
  assert.equal((await f.request('/save', { key: KEY, project: 'new_project' })).status, 200);
  assert.equal(f.saved, 1);
});

test('body bounds, invalid JSON, unexpected save fields, unauthorized-after-open are safe', async (t) => {
  let permitted = true;
  const f = fixture(t, { authorize: async () => { if (!permitted) throw new Error(KEY); return { version: 1, connectors: [connector] }; } });
  await f.handle('configure');
  assert.equal((await f.request('/save', { key: 'x'.repeat(9000), project: 'fixture' })).status, 413);
  assert.equal((await f.request('/save', '{broken', {}, 'POST', true)).status, 400);
  assert.equal((await f.request('/save', { key: KEY, project: 'fixture', url: 'https://evil.example' })).status, 400);
  assert.equal((await f.request('/save', { key: KEY, project: '839' })).status, 400);
  permitted = false;
  const result = await f.request('/save', { key: KEY, project: 'fixture' });
  assert.equal(result.status, 403); assert.equal(f.saved, 0); assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
});

test('Windows capability is explicit before secret entry; local save blocked but inspection still works', async (t) => {
  const f = fixture(t, { platform: 'win32' }); await f.handle('configure');
  const capability = await f.request('/capabilities', {}, {}, 'GET');
  assert.deepEqual(capability.data, { storage_supported: false });
  const page = await f.request('/setup', {}, {}, 'GET');
  assert.match(page.data, /id="api-key"[^>]+disabled/);
  assert.match(page.data, /DI_AGENT_DATADREAM_API_KEY/);
  assert.match(page.data, /DI_AGENT_DATADREAM_PROJECT_CODE/);
  const result = await f.request('/save', { key: KEY, project: 'fixture_project' });
  assert.equal(result.status, 400); assert.equal(result.data.error, 'unsupported_storage'); assert.equal(f.saved, 0);
  assert.equal((await f.request('/inspect')).data.status, 'connected');
  assert.equal(Object.hasOwn(await f.handle(), 'storage_supported'), false);
});

test('expired and superseded sessions cannot mutate credentials, including expiry during authorization', async (t) => {
  let time = Date.now(); let expireDuringAuth = false;
  const f = fixture(t, { now: () => time, sessionTtlMs: 1000, authorize: async () => { if (expireDuringAuth) time += 2000; return { version: 1, connectors: [connector] }; } });
  await f.handle('configure'); expireDuringAuth = true;
  assert.equal((await f.request('/save', { key: KEY, project: 'fixture' })).status, 410);
  assert.equal(f.saved, 0);
});

test('port reachable alone, missing keys, upstream errors never imply connected', async (t) => {
  const f = fixture(t, { openClient: async () => { throw Object.assign(new Error(`Bearer ${KEY}`), { diagnosticCode: 'identity_required' }); } });
  const result = await f.handle();
  assert.equal(result.status, 'failed'); assert.equal(result.checks[2].code, 'identity_required'); assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  f.setCredential(null); assert.equal((await f.handle()).status, 'setup_required');
  const unreachable = fixture(t, { probeProxy: async () => false });
  assert.equal((await unreachable.handle()).checks[1].code, 'proxy_unreachable');
});

test('changed config before recheck may pass; changes during handshake invalidate late success', async (t) => {
  let resolve; let blocked = false;
  const f = fixture(t, { openClient: async () => {
    if (blocked) await new Promise((done) => { resolve = done; });
    return { rpc: async () => ({ tools: [{ name: 'datamap_search_asset' }] }) };
  } });
  assert.equal((await f.handle()).status, 'connected');
  f.setCredential({ key: `${KEY}-new`, project: 'new_project' });
  assert.equal((await f.handle()).configuration_changed, false);
  blocked = true; const pending = f.handle();
  while (!resolve) await new Promise((done) => setImmediate(done));
  assert.equal((await f.handle()).error_code, 'busy');
  f.setCredential({ key: `${KEY}-newer`, project: 'newer_project' }); resolve();
  const result = await pending;
  assert.equal(result.status, 'configured_unverified'); assert.equal(result.configuration_changed, true);
  assert.equal(result.checks[2].code, 'configuration_changed');
});

test('browser launch failure is explicit and revokes its session', async (t) => {
  const f = fixture(t, { openBrowser: async () => { throw new Error(KEY); } });
  const result = await f.handle('configure');
  assert.equal(result.opened, false); assert.equal(result.error_code, 'open_failed'); assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
});

test('owner catalog fetch uses header identity, bounded body, and refuses redirects', async (t) => {
  let mode = 'ok'; let calls = 0;
  const server = http.createServer((req, res) => {
    calls++; assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    assert.equal(req.url, `/daemon/managed-mcps?user_id=${OWNER}`);
    if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/steal' }); res.end(); }
    else if (mode === 'large') res.end('x'.repeat(65537));
    else res.end(JSON.stringify({ version: 1, connectors: [connector] }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetchOwnerCatalog(url, KEY, OWNER)).version, 1);
  mode = 'redirect'; await assert.rejects(fetchOwnerCatalog(url, KEY, OWNER), /request_denied/);
  mode = 'large'; await assert.rejects(fetchOwnerCatalog(url, KEY, OWNER), /request_denied/);
  assert.equal(calls, 3);
});
