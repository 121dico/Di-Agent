const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const credentials = require('./managed-mcp-credentials');
const { openClient, validateConnector, ALLOWED } = require('./managed-mcp');
const { createInlineSetup } = require('./managed-mcp-inline');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL = 15 * 60 * 1000;
const ASSETS = { '/setup': ['managed-mcp-setup.html', 'text/html; charset=utf-8'], '/app.js': ['managed-mcp-setup-browser.js', 'text/javascript; charset=utf-8'], '/style.css': ['managed-mcp-setup.css', 'text/css; charset=utf-8'] };

// 只访问 daemon 已配置的平台；机器凭据放 Header，拒绝重定向及无界等待。
function fetchOwnerCatalog(serverURL, machineKey, userId) {
  const url = new URL(serverURL);
  if (!['http:', 'https:'].includes(url.protocol) || !UUID.test(userId || '') || !machineKey) return Promise.reject(new Error('request_denied'));
  url.pathname = `${url.pathname.replace(/\/$/, '')}/daemon/managed-mcps`;
  url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  url.searchParams.set('user_id', userId);
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = (url.protocol === 'https:' ? https : http).request(url, { headers: { Authorization: `Bearer ${machineKey}` } });
    const timer = setTimeout(() => { finish(new Error('request_denied')); req.destroy(); }, 8000);
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    req.on('error', () => finish(new Error('request_denied')));
    req.on('response', (res) => {
      if (res.statusCode !== 200) { res.resume(); finish(new Error('request_denied')); return; }
      let body = ''; let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 65536) { finish(new Error('request_denied')); res.destroy(); return; }
        body += chunk.toString('utf8');
      });
      res.on('error', () => finish(new Error('request_denied')));
      res.on('end', () => { try { finish(null, JSON.parse(body)); } catch { finish(new Error('request_denied')); } });
    });
    req.end();
  });
}

function probeProxy() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 28582 });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; socket.destroy(); resolve(ok); } };
    socket.setTimeout(2000, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

function openLocalBrowser(url) {
  // URL 只由本模块产生；不接受平台提供的 URL 或 shell 字符串。
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('open_failed')); }, 5000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('open_failed')); });
    child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('open_failed')); });
  });
}

function createManagedMcpSetup(options = {}) {
  const storageSupported = (options.platform || process.platform) !== 'win32';
  const load = options.loadCredential || credentials.loadDatadreamCredential;
  const state = options.configState || credentials.getDatadreamConfigState;
  const save = options.saveCredential || credentials.saveDatadreamCredential;
  const connect = options.openClient || openClient;
  const probe = options.probeProxy || probeProxy;
  const authorize = options.authorize;
  const open = options.openBrowser || openLocalBrowser;
  const now = options.now || Date.now;
  const salt = crypto.randomBytes(32);
  let latestFingerprint = '';
  let session = null;
  let busy = false;

  // 指纹仅在本进程内比较；不返回给平台，也不写入磁盘。
  function fingerprint(value = load()) {
    return crypto.createHmac('sha256', salt).update(JSON.stringify(value)).digest('hex');
  }
  function snapshot(credential = load()) {
    const current = state(credential);
    return {
      status: current.key_configured ? 'configured_unverified' : 'setup_required',
      checked_at: new Date(now()).toISOString(), configuration_changed: false,
      ...current,
      checks: [
        { id: 'daemon', status: 'passed', code: 'daemon_ready' },
        { id: 'proxy', status: 'unverified', code: 'proxy_unreachable' },
        { id: 'identity', status: 'unverified', code: 'identity_required' },
        { id: 'credential', status: current.key_configured ? 'passed' : 'failed', code: current.key_configured ? 'key_present' : 'key_missing' },
        { id: 'project', status: 'unverified', code: 'project_unverified' },
      ], opened: false,
    };
  }
  async function inspect() {
    const credential = load();
    const initial = fingerprint(credential);
    const result = snapshot(credential);
    result.configuration_changed = !!latestFingerprint && latestFingerprint !== initial;
    latestFingerprint = initial;
    const reachable = await probe();
    result.checks[1] = { id: 'proxy', status: reachable ? 'passed' : 'failed', code: reachable ? 'proxy_reachable' : 'proxy_unreachable' };
    if (reachable && credential) {
      try {
        const client = await connect(credential, 7000);
        const list = await client.rpc('tools/list', {});
        if (!Array.isArray(list.tools) || !list.tools.some((tool) => ALLOWED.includes(tool.name))) throw new Error('mcp_failed');
        result.status = 'connected';
        result.configuration_changed = false;
        result.checks[2] = { id: 'identity', status: 'passed', code: 'identity_verified' };
      } catch (error) {
        result.status = 'failed';
        result.checks[2] = { id: 'identity', status: 'failed', code: ['identity_required', 'timeout'].includes(error?.diagnosticCode) ? error.diagnosticCode : 'mcp_failed' };
      }
    } else if (credential) result.status = 'failed';
    if (fingerprint() !== initial) {
      result.status = 'configured_unverified';
      result.configuration_changed = true;
      result.checks[2] = { id: 'identity', status: 'unverified', code: 'configuration_changed' };
    }
    return result;
  }
  async function exclusive(action) {
    if (busy) throw new Error('busy');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function authorized(userId) {
    if (!UUID.test(userId || '') || typeof authorize !== 'function') throw new Error('request_denied');
    try {
      const response = await authorize(userId);
      const catalog = response?.data ?? response;
      if (catalog?.version !== 1 || !Array.isArray(catalog.connectors)) throw new Error();
      validateConnector(catalog.connectors.find((item) => item.id === 'datadream'));
    } catch { throw new Error('request_denied'); }
  }
  function closeSession() {
    if (!session) return;
    clearTimeout(session.timer);
    session.server.close();
    session.server.closeAllConnections?.();
    session = null;
  }
  async function createSession(userId) {
    closeSession();
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(32).toString('hex');
    const expires = now() + (options.sessionTtlMs || SESSION_TTL);
    const server = http.createServer();
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 30;
    const sessionState = { server, token, csrf, expires, timer: null };
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    function send(res, code, value, type = 'application/json; charset=utf-8') {
      res.writeHead(code, { 'Content-Type': type, Connection: 'close', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    }
    server.on('request', async (req, res) => {
      // 不开放 CORS/PNA，也不接受 localhost/任意域名，阻止 DNS rebinding。
      if (req.headers.host !== new URL(origin).host || req.socket.remoteAddress !== '127.0.0.1') return send(res, 403, { error: 'request_denied' });
      if (now() >= expires || session !== sessionState) return send(res, 410, { error: 'session_expired' });
      if (req.method === 'GET' && req.url === '/capabilities') return send(res, 200, { storage_supported: storageSupported });
      if (req.method === 'GET' && Object.hasOwn(ASSETS, req.url)) {
        const [file, type] = ASSETS[req.url];
        return send(res, 200, fs.readFileSync(path.join(__dirname, file)), type);
      }
      if (req.method !== 'POST' || !['/state', '/save', '/inspect'].includes(req.url)) return send(res, 404, { error: 'request_denied' });
      if (req.headers.origin !== origin || req.headers['x-diagent-session'] !== token || req.headers['x-csrf-token'] !== csrf || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { error: 'request_denied' });
      if (Number(req.headers['content-length']) > 8192) { req.resume(); return send(res, 413, { error: 'body_too_large' }); }
      let body = ''; let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8192) { send(res, 413, { error: 'body_too_large' }); return; }
          body += chunk.toString('utf8');
        }
        const input = JSON.parse(body || '{}');
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_input');
        await authorized(userId);
        const result = await exclusive(async () => {
          if (now() >= expires || session !== sessionState) throw new Error('session_expired');
          if (req.url === '/inspect') return inspect();
          if (req.url === '/save') {
            if (!storageSupported) throw new Error('unsupported_storage');
            if (Object.keys(input).some((key) => !['key', 'project'].includes(key)) || typeof input.project !== 'string' || typeof input.key !== 'string') throw new Error('invalid_input');
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.project) || /^\d+$/.test(input.project)) throw new Error('invalid_input');
            await save(input);
            const result = snapshot();
            result.configuration_changed = true;
            return result;
          }
          return snapshot();
        });
        if (now() >= expires || session !== sessionState) return send(res, 410, { error: 'session_expired' });
        send(res, 200, result);
      } catch (error) {
        const code = ['busy', 'request_denied', 'invalid_input', 'session_expired', 'unsupported_storage'].includes(error?.message) ? error.message : 'configure_failed';
        send(res, code === 'session_expired' ? 410 : code === 'request_denied' ? 403 : code === 'busy' ? 409 : 400, { error: code });
      }
    });
    session = sessionState;
    sessionState.timer = setTimeout(() => { if (session === sessionState) closeSession(); }, options.sessionTtlMs || SESSION_TTL);
    sessionState.timer.unref();
    server.unref();
    return `${origin}/setup#${token}.${csrf}`;
  }

  const inline = createInlineSetup({ authorize: authorized, snapshot, save, load, fingerprint, now, storageSupported });
  async function handle(action, request, connection) {
    const requestId = request?.request_id;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return null;
    try {
      await authorized(request.user_id);
      return await exclusive(async () => {
        if (action === 'managed_mcp.inspect') return { ...await inspect(), request_id: requestId };
        if (action === 'managed_mcp.setup_session') return { ...inline.start(request, connection), request_id: requestId };
        if (action === 'managed_mcp.save') {
          try { return { ...await inline.persist(request, connection), request_id: requestId }; }
          catch (error) {
            if (['session_expired', 'invalid_envelope', 'invalid_configuration', 'environment_override', 'unsupported_platform', 'save_failed'].includes(error?.message)) return { ...snapshot(), status: 'failed', error_code: error.message, saved: false, request_id: requestId };
            throw error;
          }
        }
        if (action !== 'managed_mcp.configure') throw new Error('request_denied');
        const url = await createSession(request.user_id);
        try { await open(url); } catch { closeSession(); return { ...snapshot(), request_id: requestId, error_code: 'open_failed' }; }
        return { ...snapshot(), opened: true, request_id: requestId };
      });
    } catch (error) {
      // 未授权时连个人项目名也不披露。
      return { request_id: requestId, status: 'failed', error_code: error?.message === 'busy' ? 'busy' : 'request_denied' };
    }
  }
  return { handle, close: (connection) => { inline.close(connection); closeSession(); } };
}

module.exports = { createManagedMcpSetup, fetchOwnerCatalog };
