const test = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');
const { createManagedMcpSetup } = require('../cli/managed-mcp-setup');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = 'fixture-never-a-real-personal-key';
const MACHINE = 'test-machine';
const connector = { id: 'datadream', enabled: true, endpoint: 'http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp', execution: 'user_local', transport: 'streamable-http', credential_binding: 'datadream-personal', allowed_tools: ['datamap_search_asset'] };
function fixture(t, options = {}) {
  let clock = Date.now(); let credential = { key: KEY, project: 'old_project' }; let saved = 0; let allowed = true; let authorizeCount = 0; let beforeAuthorize;
  const connection = { readyState: 1 };
  const setup = createManagedMcpSetup({
    platform: 'linux', now: () => clock,
    loadCredential: () => credential,
    configState: () => ({ key_configured: !!credential, project_code: credential?.project || '', credential_source: 'file', project_source: 'file' }),
    authorize: async () => { authorizeCount++; await beforeAuthorize?.(authorizeCount); if (!allowed) throw new Error(KEY); return { version: 1, connectors: [connector] }; },
    saveCredential: async ({ key, project }) => { saved++; credential = { key: key || credential?.key, project }; },
    openBrowser: () => { throw new Error('must not open browser'); },
    probeProxy: async () => true,
    openClient: async () => ({ rpc: async () => ({ tools: [{ name: 'datamap_search_asset' }] }) }),
    ...options,
  });
  t.after(() => setup.close());
  const request = (action, extra = {}, conn = connection) => setup.handle(`managed_mcp.${action}`, { request_id: 'fixture_request', user_id: OWNER, machine_id: MACHINE, ...extra }, conn);
  return { setup, request, connection, advance: () => { clock += 300001; }, setAllowed: (v) => { allowed = v; }, setCredential: (v) => { credential = v; }, onAuthorize: (fn) => { beforeAuthorize = fn; }, get saved() { return saved; }, get credential() { return credential; } };
}
function encrypted(session, changes = {}) {
  const pair = nacl.box.keyPair(); const nonce = nacl.randomBytes(24);
  const body = { session_id: session.id, user_id: OWNER, machine_id: MACHINE, api_key: KEY, project_code: 'new_project', ...changes };
  return { session_id: session.id, client_public_key: Buffer.from(pair.publicKey).toString('base64'), nonce: Buffer.from(nonce).toString('base64'), ciphertext: Buffer.from(nacl.box(Buffer.from(JSON.stringify(body)), nonce, Buffer.from(session.public_key, 'base64'), pair.secretKey)).toString('base64') };
}
test('inline roundtrip persists locally, blank retains key, requires separate real handshake and never opens browser', async (t) => {
  const f = fixture(t); const issued = await f.request('setup_session');
  assert.equal(issued.setup_session.supported, true); assert.equal(issued.opened, false);
  const envelope = encrypted(issued.setup_session, { api_key: '' });
  const result = await f.request('save', { envelope });
  assert.equal(result.saved, true); assert.equal(result.status, 'configured_unverified'); assert.equal(result.configuration_changed, true);
  assert.equal(f.saved, 1); assert.deepEqual(f.credential, { key: KEY, project: 'new_project' });
  assert.equal((await f.request('inspect')).status, 'connected');
  assert.equal((await f.request('save', { envelope })).error_code, 'session_expired');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
});
test('Bearer normalization local only; tampering consumes session before decrypt', async (t) => {
  const f = fixture(t); let session = (await f.request('setup_session')).setup_session;
  assert.equal((await f.request('save', { envelope: encrypted(session, { api_key: `Bearer ${KEY}` }) })).saved, true);
  session = (await f.request('setup_session')).setup_session;
  const envelope = encrypted(session); const broken = { ...envelope, ciphertext: Buffer.alloc(32).toString('base64') };
  assert.equal((await f.request('save', { envelope: broken })).error_code, 'invalid_envelope');
  assert.equal((await f.request('save', { envelope })).error_code, 'session_expired'); assert.equal(f.saved, 1);
});
test('foreign request owner, machine and connection cannot consume owner session; encrypted binding must match', async (t) => {
  const f = fixture(t); const session = (await f.request('setup_session')).setup_session; const envelope = encrypted(session);
  for (const extra of [{ user_id: OTHER }, { machine_id: 'other-machine' }]) assert.equal((await f.request('save', { envelope, ...extra })).error_code, 'request_denied');
  assert.equal((await f.request('save', { envelope }, {})).error_code, 'request_denied');
  assert.equal((await f.request('save', { envelope })).saved, true);
  for (const changes of [{ user_id: OTHER }, { machine_id: 'other-machine' }, { session_id: 'wrong' }]) {
    const s = (await f.request('setup_session')).setup_session;
    assert.equal((await f.request('save', { envelope: encrypted(s, changes) })).error_code, 'invalid_envelope');
  }
  assert.equal(f.saved, 1);
});
test('expiry, disconnect, changed configuration and owner revocation stop persistence', async (t) => {
  const f = fixture(t); let s = (await f.request('setup_session')).setup_session; f.advance();
  assert.equal((await f.request('save', { envelope: encrypted(s) })).error_code, 'session_expired');
  s = (await f.request('setup_session')).setup_session; f.setup.close(f.connection);
  assert.equal((await f.request('save', { envelope: encrypted(s) })).error_code, 'session_expired');
  s = (await f.request('setup_session')).setup_session; f.setCredential({ key: KEY, project: 'another_change' });
  assert.equal((await f.request('save', { envelope: encrypted(s) })).error_code, 'invalid_configuration');
  s = (await f.request('setup_session')).setup_session; f.setAllowed(false);
  const denied = await f.request('save', { envelope: encrypted(s) });
  assert.equal(denied.error_code, 'request_denied'); assert.equal(denied.project_code, undefined); assert.equal(f.saved, 0);
});
test('independent owner recheck immediately before save and disconnect during it abort', async (t) => {
  for (const revoke of ['owner', 'connection']) {
    const f = fixture(t); const s = (await f.request('setup_session')).setup_session;
    f.onAuthorize((count) => { if (count === 3) { if (revoke === 'owner') f.setAllowed(false); else f.setup.close(f.connection); } });
    const result = await f.request('save', { envelope: encrypted(s) });
    assert.equal(result.error_code, revoke === 'owner' ? 'request_denied' : 'session_expired'); assert.equal(f.saved, 0);
  }
});
test('invalid configuration and bounded/strict envelope produce only fixed safe errors', async (t) => {
  const f = fixture(t);
  for (const changes of [{ project_code: '839' }, { project_code: 'secret/path' }, { api_key: 'bad' }, { api_key: 'x'.repeat(4097) }]) {
    const s = (await f.request('setup_session')).setup_session;
    assert.equal((await f.request('save', { envelope: encrypted(s, changes) })).error_code, 'invalid_configuration');
  }
  for (const changes of [{ nonce: 'x' }, { client_public_key: '' }, { ciphertext: 'A'.repeat(17000) }, { api_key: KEY }]) {
    const s = (await f.request('setup_session')).setup_session;
    const result = await f.request('save', { envelope: { ...encrypted(s), ...changes } });
    assert.equal(result.error_code, 'invalid_envelope'); assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  }
  const s = (await f.request('setup_session')).setup_session;
  assert.equal((await f.request('save', { envelope: encrypted(s, { extra: KEY }) })).error_code, 'invalid_envelope');
  assert.equal(f.saved, 0);
});
test('unsupported and environment override disclosed before entry; storage failure redacted', async (t) => {
  for (const [options, reason] of [[{ platform: 'win32' }, 'unsupported_platform'], [{ configState: () => ({ key_configured: true, project_code: 'example', credential_source: 'environment', project_source: 'file' }) }, 'environment_override']]) {
    const f = fixture(t, options); const result = await f.request('setup_session');
    assert.deepEqual(result.setup_session, { id: '', public_key: '', expires_at: '', supported: false, reason }); assert.equal(f.saved, 0);
  }
  const f = fixture(t, { saveCredential: () => { throw new Error(KEY); } }); const s = (await f.request('setup_session')).setup_session;
  const result = await f.request('save', { envelope: encrypted(s) });
  assert.equal(result.error_code, 'save_failed'); assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
});
