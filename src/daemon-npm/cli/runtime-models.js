'use strict';
const { spawn } = require('node:child_process');
const os = require('node:os');
const { normalizeProcessSpec } = require('./runtime');

const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
function modelID(value) {
  return typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]*$/.test(value);
}
function normalizeModel(value) {
  if (value == null || value === '' || value === 'default') return '';
  if (!modelID(value)) throw new Error('Invalid runtime config: unsupported model identifier');
  return value;
}
function codexModels(rows) {
  return (Array.isArray(rows) ? rows : []).filter(m => m && !m.hidden && modelID(m.model)).map(m => ({
    id: m.model, label: String(m.displayName || m.model).slice(0, 200),
    is_default: m.isDefault === true,
    reasoning_efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort).filter(e => EFFORTS.has(e)),
    default_reasoning_effort: EFFORTS.has(m.defaultReasoningEffort) ? m.defaultReasoningEffort : 'medium',
    // 旧版未报告此字段时不推断支持；服务端仍负责最终校验。
    supports_priority: Array.isArray(m.serviceTiers) && m.serviceTiers.some(t => t.id === 'priority'),
  }));
}
async function listCodexModels(rpc) {
  const models = [];
  const seen = new Set();
  let cursor;
  do {
    const res = await rpc('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (res.error || !Array.isArray(res.result?.data)) throw new Error('无法读取运行器模型目录，请重新扫描');
    models.push(...codexModels(res.result.data));
    cursor = res.result.nextCursor;
    if (cursor && (seen.has(cursor) || seen.size >= 20)) throw new Error('模型目录分页异常，请重试');
    seen.add(cursor);
  } while (cursor);
  return [...new Map(models.map(m => [m.id, m])).values()];
}

// 只进行初始化和能力查询；不启动对话，不发送用户提示，也不把账号信息返回服务器。
function openModelProbe(command, args, { env = process.env, spawnImpl = spawn, timeoutMs = 12000 } = {}) {
  const spec = normalizeProcessSpec(command, args);
  const child = spawnImpl(spec.command, spec.args, {
    cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let buffer = '';
  let nextID = 1;
  let closed = false;
  const pending = new Map();
  const settle = (error) => {
    closed = true;
    for (const resolve of pending.values()) resolve({ error: { message: error } });
    pending.clear();
  };
  child.on('error', () => settle('本地运行器启动失败'));
  child.on('close', () => settle('本地运行器已退出'));
  child.stderr.on('data', () => {});
  child.stdin.on?.('error', () => settle('模型查询写入失败'));
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 2 * 1024 * 1024) { settle('模型目录过大'); child.kill(); return; }
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const id = msg.type === 'control_response' ? msg.response?.request_id : msg.id;
      const resolve = pending.get(String(id));
      if (!resolve) continue;
      pending.delete(String(id));
      resolve(msg.type === 'control_response'
        ? (msg.response.subtype === 'success' ? { result: msg.response.response } : { error: { message: '模型目录查询被运行器拒绝' } })
        : msg);
    }
  });
  const rpc = (method, params, claude = false) => new Promise(resolve => {
    if (closed) { resolve({ error: { message: '本地运行器已退出' } }); return; }
    const id = String(nextID++);
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: { message: '扫描模型超时' } }); }, timeoutMs);
    pending.set(id, res => { clearTimeout(timer); resolve(res); });
    const message = claude
      ? { type: 'control_request', request_id: id, request: { subtype: method, ...params } }
      : { id, method, params };
    try { child.stdin.write(JSON.stringify(message) + '\n', err => { if (err) settle('模型查询写入失败'); }); }
    catch { settle('模型查询写入失败'); }
  });
  return { rpc, close() { settle('扫描结束'); child.stdin.end(); child.kill(); } };
}
async function scanRuntimeModels({ cliTool, command, env, spawnImpl, timeoutMs }) {
  if (!['codex', 'claude'].includes(cliTool)) {
    return { models: [], source: 'unsupported', default_model: '', warning: '此运行器暂未提供可读取的模型目录，请使用本地默认模型' };
  }
  const args = cliTool === 'codex' ? ['app-server'] : [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ];
  const probe = openModelProbe(command, args, { env, spawnImpl, timeoutMs });
  try {
    const init = await probe.rpc('initialize', cliTool === 'codex'
      ? { clientInfo: { name: 'di-agent-models', version: '1.0' } } : {}, cliTool === 'claude');
    if (init.error) throw new Error(init.error.message);
    let models; let defaultModel = '';
    if (cliTool === 'codex') {
      models = await listCodexModels(probe.rpc);
      const config = await probe.rpc('config/read', { includeLayers: false });
      const configured = config.result?.config?.model;
      defaultModel = modelID(configured) ? configured : (models.find(m => m.is_default)?.id || '');
    } else {
      models = (Array.isArray(init.result?.models) ? init.result.models : []).filter(m => modelID(m.value)).map(m => ({
        id: m.value === 'default' ? '' : m.value,
        label: String(m.displayName || m.value).slice(0, 200),
        resolved_model: modelID(m.resolvedModel) ? m.resolvedModel : '',
        is_default: m.value === 'default', reasoning_efforts: [], supports_priority: false,
      }));
      defaultModel = models.find(m => m.is_default)?.resolved_model || '';
    }
    if (!models.length) throw new Error('本地运行器没有返回可选模型，请检查登录状态后重新扫描');
    return { models, default_model: defaultModel, source: 'runtime', scanned_at: new Date().toISOString() };
  } finally { probe.close(); }
}
module.exports = { normalizeModel, modelID, EFFORTS, codexModels, listCodexModels, openModelProbe, scanRuntimeModels };
