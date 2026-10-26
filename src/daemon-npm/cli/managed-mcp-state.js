const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function fileFor(ctx, id, create = false) {
  if (!ctx.userId || !ctx.managedMcpScope) throw new Error('MCP 启用状态需要本人及电脑身份，请升级连接程序。');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('MCP 标识无效');
  const scope = crypto.createHash('sha256').update(JSON.stringify([ctx.managedMcpScope, ctx.userId])).digest('hex');
  let dir = os.homedir();
  for (const segment of ['.di-agent', 'managed-mcp', 'connections', scope]) {
    dir = path.join(dir, segment);
    if (!fs.existsSync(dir)) {
      if (!create) return null;
      fs.mkdirSync(dir, { mode: 0o700 });
    }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid())) throw new Error('MCP 本机配置目录不安全');
    if (create && process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  }
  return path.join(dir, id + '.json');
}

function readPrivate(file) {
  if (!file || !fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw new Error('MCP 本机配置权限无效');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { throw new Error('MCP 本机启用状态损坏，请重新配置'); }
}

function atomicWrite(file, value) {
  if (process.platform === 'win32') throw new Error('Windows 暂未验证本机连接状态的安全持久化，请勿启用新 MCP。');
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function revocation(file) {
  const value = file && readPrivate(file + '.revoked');
  if (value && typeof value.revision !== 'string') throw new Error('MCP 撤销状态损坏');
  return value?.revision || null;
}

function readConnection(ctx, id) {
  if (!ctx.managedMcpScope && id === 'datadream') return { enabled: true, revision: null };
  const file = fileFor(ctx, id);
  const value = readPrivate(file);
  const revoked = revocation(file);
  if (value && (typeof value.enabled !== 'boolean' || typeof value.revision !== 'string')) throw new Error('MCP 本机启用状态损坏');
  return {
    enabled: value ? value.enabled && (value.revocation || null) === revoked : id === 'datadream' && revoked === null,
    revision: value || revoked ? JSON.stringify([value?.revision || null, revoked]) : null,
  };
}

function saveConnection(ctx, id, enabled, expectedRevision) {
  const file = fileFor(ctx, id, true);
  // 撤销使用独立代次：崩溃不会遗留锁，旧启用即使最后写入也无法覆盖撤销。
  if (!enabled) { atomicWrite(file + '.revoked', { revision: crypto.randomUUID() }); return; }
  const revoked = revocation(file);
  if (expectedRevision !== undefined && readConnection(ctx, id).revision !== expectedRevision) throw new Error('MCP 配置已变化，请重新确认后接入');
  atomicWrite(file, { enabled: true, revision: crypto.randomUUID(), revocation: revoked });
  if (!readConnection(ctx, id).enabled) throw new Error('MCP 配置已变化，请重新确认后接入');
}

// 仅本机可信配置流程调用；模型工具不能自动认领 OS 钥匙串中的个人令牌。
function bindCredential(ctx, key) {
  if (typeof key !== 'string' || key.length < 16) throw new Error('个人凭据无效');
  atomicWrite(fileFor(ctx, 'personal-credential', true), { fingerprint: crypto.createHash('sha256').update(key).digest('hex') });
}

function credentialBound(ctx, key) {
  const value = readPrivate(fileFor(ctx, 'personal-credential'));
  return !!value && value.fingerprint === crypto.createHash('sha256').update(key).digest('hex');
}

// Chrome 登录态只由当前 OS 用户读取；平台用户须在本人终端确认绑定。
function bindBrowser(ctx) {
  atomicWrite(fileFor(ctx, 'intranet-browser', true), { confirmed: true, at: new Date().toISOString() });
}

function browserBound(ctx) {
  return readPrivate(fileFor(ctx, 'intranet-browser'))?.confirmed === true;
}

module.exports = { readConnection, saveConnection, bindCredential, credentialBound, bindBrowser, browserBound };
