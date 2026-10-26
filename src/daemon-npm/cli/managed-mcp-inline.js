const crypto = require('node:crypto');
const nacl = require('tweetnacl');

const TTL = 5 * 60 * 1000;
const FIELDS = ['session_id', 'client_public_key', 'nonce', 'ciphertext'];
function decode(value, size, maximum = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('invalid_envelope');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length < size || bytes.length > maximum) throw new Error('invalid_envelope');
  return bytes;
}

// 只保留一次性解密密钥；控制面永远不需要接触明文配置。
function createInlineSetup({ authorize, snapshot, save, load, fingerprint, now = Date.now, storageSupported }) {
  const sessions = new Map();
  const saving = new Set();
  function discard(id) {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    session.keys.secretKey.fill(0);
    sessions.delete(id);
  }
  function close(connection) {
    for (const session of saving) if (!connection || session.connection === connection) session.revoked = true;
    for (const [id, session] of sessions) if (!connection || session.connection === connection) discard(id);
  }
  function reason() {
    const status = snapshot();
    if (!storageSupported) return 'unsupported_platform';
    return status.credential_source === 'environment' || status.project_source === 'environment' ? 'environment_override' : '';
  }
  function start(request, connection) {
    const blocked = reason();
    if (blocked) return { ...snapshot(), setup_session: { id: '', public_key: '', expires_at: '', supported: false, reason: blocked } };
    if (!connection || connection.readyState === 3 || connection.readyState === 2 || typeof request.machine_id !== 'string' || !request.machine_id || request.machine_id.length > 128) throw new Error('request_denied');
    // 同一个 owner/连接的新表单替换旧会话，限制内存和并发旧草稿。
    close(connection);
    const id = crypto.randomBytes(32).toString('base64url');
    const keys = nacl.box.keyPair();
    const expires = now() + TTL;
    const timer = setTimeout(() => discard(id), TTL);
    timer.unref();
    sessions.set(id, { keys, expires, timer, connection, userId: request.user_id, machineId: request.machine_id, fingerprint: fingerprint(), revoked: false });
    return { ...snapshot(), setup_session: { id, public_key: Buffer.from(keys.publicKey).toString('base64'), expires_at: new Date(expires).toISOString(), supported: true, reason: '' } };
  }
  async function persist(request, connection) {
    const envelope = request.envelope;
    if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object' || Object.keys(envelope).length !== 4 || FIELDS.some((field) => typeof envelope[field] !== 'string')) throw new Error('invalid_envelope');
    const session = sessions.get(envelope.session_id);
    if (!session) throw new Error('session_expired');
    // 异用户/异连接不能消耗原 owner 的合法会话。
    if (session.userId !== request.user_id || session.machineId !== request.machine_id || session.connection !== connection) throw new Error('request_denied');
    if (now() >= session.expires) { discard(envelope.session_id); throw new Error('session_expired'); }
    const secret = new Uint8Array(session.keys.secretKey);
    discard(envelope.session_id);
    saving.add(session);
    let plaintext;
    try {
      plaintext = nacl.box.open(decode(envelope.ciphertext, 16, 12288), decode(envelope.nonce, 24), decode(envelope.client_public_key, 32), secret);
      if (!plaintext) throw new Error('invalid_envelope');
      let input;
      try { input = JSON.parse(Buffer.from(plaintext).toString('utf8')); } catch { throw new Error('invalid_envelope'); }
      if (!input || Array.isArray(input) || Object.keys(input).length !== 5 || !['session_id', 'user_id', 'machine_id', 'api_key', 'project_code'].every((field) => typeof input[field] === 'string')) throw new Error('invalid_envelope');
      if (input.session_id !== envelope.session_id || input.user_id !== session.userId || input.machine_id !== session.machineId) throw new Error('invalid_envelope');
      const key = input.api_key.trim().replace(/^Bearer\s+/i, '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.project_code) || /^\d+$/.test(input.project_code) || (key && (key.length < 16 || key.length > 4096 || !/^[A-Za-z0-9._~+/=-]+$/.test(key))) || (!key && !load())) throw new Error('invalid_configuration');
      await authorize(request.user_id);
      if (now() >= session.expires || session.revoked || connection.readyState === 3 || connection.readyState === 2) throw new Error('session_expired');
      const blocked = reason();
      if (blocked) throw new Error(blocked);
      if (session.fingerprint !== fingerprint()) throw new Error('invalid_configuration');
      try { await save({ key, project: input.project_code }); } catch { throw new Error('save_failed'); }
      return { ...snapshot(), saved: true, configuration_changed: true };
    } finally {
      secret.fill(0);
      plaintext?.fill(0);
      saving.delete(session);
    }
  }
  return { start, persist, close };
}

module.exports = { createInlineSetup };
