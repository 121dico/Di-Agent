'use strict';
// 目录仅决定模型能力，不改变用户的审批或沙盒策略。
function resolveModelPolicy(config, models, nativeDefault, forceDefault = false, rejectedModel = config.model) {
  const next = { ...config };
  const listed = models || [];
  const catalogDefault = listed.find(m => m.is_default);
  const configured = require('./runtime-models').modelID(nativeDefault) ? nativeDefault : '';
  // 隐藏/自定义默认模型可能不在菜单中，目录缺失不能证明它不可用。
  const defaultID = configured || catalogDefault?.id || '';
  if (forceDefault) next.model = (configured && configured !== rejectedModel ? configured : catalogDefault?.id) || ''; 
  else if (!config.model) next.model = defaultID;
  const effective = listed.find(m => m.id === next.model);
  if (!effective) return { config: next, changed: Boolean(config.model && next.model !== config.model) };
  if (effective.reasoning_efforts.length && !effective.reasoning_efforts.includes(next.reasoning_effort)) {
    next.reasoning_effort = effective.reasoning_efforts.includes(effective.default_reasoning_effort)
      ? effective.default_reasoning_effort : effective.reasoning_efforts[0];
  }
  if (next.service_tier === 'priority' && !effective.supports_priority) next.service_tier = 'default';
  return { config: next, changed: Boolean(config.model && next.model !== config.model)
    || next.reasoning_effort !== config.reasoning_effort || next.service_tier !== config.service_tier };
}
function isModelRejection(response) {
  // 无 turn ID 的明确模型参数拒绝才可重试；网络超时、限额、任务执行中错误均不能重放。
  if (response?.result?.turn?.id || !response?.error) return false;
  const message = String(response.error.message || '');
  return /(?:unsupported|unknown|invalid|unavailable|not found|not supported|does not exist)/i.test(message)
    && /\bmodel\b/i.test(message)
    && !/timeout|timed out|connection|network|rate.?limit|quota|auth/i.test(message);
}
module.exports = { resolveModelPolicy, isModelRejection };
