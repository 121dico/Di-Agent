const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startBrowserIdentity } = require('../browser-identity');

async function request(server, { method = 'POST', path = '/identity', origin = 'https://agent.example', host, body = JSON.stringify({ nonce: 'a'.repeat(64) }), headers = {} } = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, agent: false, headers: { host: host || `127.0.0.1:${port}`, ...(origin ? { origin } : {}), 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end(method === 'POST' ? body : undefined);
  });
}

test('owned origin receives a fresh nonce-bound proof without machine credentials', async t => {
  const server = await startBrowserIdentity({ serverURL: 'https://agent.example/path', apiKey: 'test-machine-key', port: 0, now: () => 1800000000000 });
  t.after(() => server.close());
  const result = await request(server);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.text), { nonce: 'a'.repeat(64), issued_at: 1800000000, proof: 'b2fbabca13c4ed8d0025d6be7c051ccade2bd09368fe58fab5e23fb15785aea7' });
  assert.equal(result.headers['access-control-allow-origin'], 'https://agent.example');
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('loopback identity rejects foreign origins, DNS aliases, bad methods and malformed bodies', async t => {
  const server = await startBrowserIdentity({ serverURL: 'https://agent.example', apiKey: 'test-machine-key', port: 0 });
  t.after(() => server.close());
  for (const options of [
    { origin: 'https://evil.example' }, { origin: undefined, headers: { origin: '' } },
    { host: `localhost:${server.address().port}` }, { host: 'evil.example' },
    { method: 'GET' }, { body: '{}' }, { body: '{"nonce":"short"}' },
    { body: JSON.stringify({ nonce: 'a'.repeat(64), api_key: 'injected' }) },
    { body: 'x'.repeat(257) }, { path: '/identity?nonce=foo' },
    { method: 'OPTIONS', headers: { 'access-control-request-method': 'DELETE', 'access-control-request-headers': 'content-type' } },
  ]) {
    const result = await request(server, options);
    assert.ok(result.status >= 400, JSON.stringify(options));
    assert.equal(result.text, '');
  }
  const preflight = await request(server, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
});

test('popup proof is posted only to configured origin with restrictive CSP', async t => {
  const server = await startBrowserIdentity({ serverURL: 'https://agent.example', apiKey: 'test-machine-key', port: 0 });
  t.after(() => server.close());
  const path = `/identity-window?nonce=${'b'.repeat(64)}&origin=${encodeURIComponent('https://agent.example')}`;
  const response = await request(server, { method: 'GET', path, origin: null });
  assert.equal(response.status, 200);
  assert.match(response.text, /postMessage\(.+,"https:\/\/agent.example"\)/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(response.headers['content-security-policy'], /script-src 'nonce-/);
  assert.ok(!response.text.includes('test-machine-key'));
  assert.equal((await request(server, { method: 'GET', path: path.replace('agent.example', 'evil.example'), origin: null })).status, 400);
  await assert.rejects(startBrowserIdentity({ serverURL: 'https://agent.example', apiKey: 'another', port: server.address().port }), { code: 'EADDRINUSE' });
});
