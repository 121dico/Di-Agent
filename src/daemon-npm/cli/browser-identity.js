const http = require('node:http');
const crypto = require('node:crypto');

// 此证明只供 UI 判别浏览器所在电脑，不可用于登录、授权或操作机器。
async function startBrowserIdentity({ serverURL, apiKey, port = 28683, now = Date.now }) {
  const configured = new URL(serverURL);
  if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || !apiKey) throw new Error('invalid_identity_configuration');
  const origin = configured.origin;
  const key = crypto.createHash('sha256').update(apiKey).digest('hex');
  const proofFor = nonce => {
    const issued_at = Math.floor(now() / 1000);
    const proof = crypto.createHmac('sha256', key).update(`di-agent-browser-identity-v1\n${nonce}\n${issued_at}`).digest('hex');
    return { nonce, issued_at, proof };
  };
  const validNonce = nonce => typeof nonce === 'string' && /^[a-f0-9]{64}$/.test(nonce);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const reject = code => { res.writeHead(code); res.end(); };
    // 不信任 DNS、转发头或任意网卡：必须为字面回环 Host 和回环 TCP 对端。
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.socket.remoteAddress !== '127.0.0.1') return reject(403);
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return reject(400); }
    if (url.pathname === '/identity-window' && req.method === 'GET') {
      if (req.headers.origin && req.headers.origin !== origin) return reject(403);
      if (url.searchParams.get('origin') !== origin || !validNonce(url.searchParams.get('nonce')) || [...url.searchParams.keys()].sort().join(',') !== 'nonce,origin') return reject(400);
      const scriptNonce = crypto.randomBytes(18).toString('base64');
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${scriptNonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const payload = JSON.stringify({ type: 'di-agent-browser-identity', ...proofFor(url.searchParams.get('nonce')) }).replace(/</g, '\\u003c');
      const destination = JSON.stringify(origin).replace(/</g, '\\u003c');
      res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>识别本机</title><p>正在将本机识别结果返回 Di Agent。完成后可关闭此窗口。</p><script nonce="${scriptNonce}">if(window.opener){window.opener.postMessage(${payload},${destination});window.close();}</script></html>`);
      return;
    }
    if (url.pathname !== '/identity' || url.search) return reject(404);
    if (req.headers.origin !== origin) return reject(403);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      if (req.headers['access-control-request-method'] !== 'POST' || (req.headers['access-control-request-headers'] || '').toLowerCase() !== 'content-type') return reject(403);
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return reject(204);
    }
    if (req.method !== 'POST') return reject(405);
    if (req.headers['content-type'] !== 'application/json') return reject(415);
    let size = 0; let body = '';
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size <= 256) body += chunk.toString('utf8');
      }
      if (size > 256) return reject(413);
      const data = JSON.parse(body);
      if (!data || Object.keys(data).join(',') !== 'nonce' || !validNonce(data.nonce)) return reject(400);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(proofFor(data.nonce)));
    } catch { if (!res.writableEnded) reject(400); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  server.maxHeadersCount = 16;
  server.maxConnections = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  server.unref();
  return server;
}

module.exports = { startBrowserIdentity };
