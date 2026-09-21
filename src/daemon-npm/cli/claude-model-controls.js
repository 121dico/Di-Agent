'use strict';
const { normalizeModel } = require('./runtime-models');
// Claude 的 model-only 控制与 Codex 审批策略隔离，不借模型切换改变权限。
function normalizeClaudeRuntime(value) {
  if (!value || Object.keys(value).length === 0 || value.version === 0) return '';
  const model = normalizeModel(value.model);
  if (![1, 2].includes(value.version) || value.approval_mode !== 'auto'
    || value.reasoning_effort !== 'medium' || (value.service_tier && value.service_tier !== 'default')) {
    throw new Error('Claude 目前仅支持模型选择，请保持其它运行设置为默认');
  }
  return model;
}
function createClaudeModelControls(child, onRecovery = () => {}, timeoutMs = 12000) {
  let nextID = 1; let currentModel = ''; let initialized = false;
  const pending = new Map();
  const failAll = () => { for (const reject of pending.values()) reject(new Error('Claude 运行器已退出')); pending.clear(); };
  const handleLine = line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== 'control_response') return;
    const response = msg.response || {};
    const settle = pending.get(response.request_id);
    if (!settle) return;
    pending.delete(response.request_id);
    if (response.subtype === 'success') settle(response.response || {});
    else {
      const error = new Error('Claude 拒绝模型切换，请重新扫描');
      const detail = String(response.error || '');
      error.modelRejected = /model/i.test(detail) && /not found|unsupported|not supported|unknown|invalid|unavailable/i.test(detail)
        && !/timeout|network|connection|auth|quota|rate.?limit/i.test(detail);
      settle(error);
    }
  };
  const request = (subtype, params = {}) => new Promise((resolve, reject) => {
    const id = `di-model-${nextID++}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Claude 模型切换超时，请重试')); }, timeoutMs);
    pending.set(id, result => { clearTimeout(timer); result instanceof Error ? reject(result) : resolve(result); });
    try { child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype, ...params } }) + '\n'); }
    catch { const settle = pending.get(id); pending.delete(id); settle(new Error('Claude 模型切换失败')); }
  });
  const apply = value => {
    let selected = normalizeClaudeRuntime(value);
    if (selected === currentModel) return;
    return (async () => {
    if (!initialized) { await request('initialize'); initialized = true; }
    // 重新扫描可能返回新模型；以原生设置结果为准，不能用旧目录缓存降级。
    try { await request('set_model', { model: selected || null }); }
    catch (error) {
      if (!selected || !error.modelRejected) throw error;
      await request('set_model', { model: null });
      selected = ''; onRecovery('所选模型已被运行器拒绝，已恢复本地默认模型。');
    }
    currentModel = selected;
    })();
  };
  return { apply, handleLine, close: failAll };
}
module.exports = { createClaudeModelControls, normalizeClaudeRuntime };
