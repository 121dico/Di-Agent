'use strict';

const { createHash } = require('node:crypto');

// 仅在现有任务归属完全匹配时传递补充；回执不确定时绝不能自动开新一轮。
function createTaskSteering({ getRuntime }) {
  const receipts = new Map();
  return function handle(data = {}) {
    const { request_id, task_id, agent_id, conversation_id, user_id, prompt } = data;
    const result = (status, reason) => ({ request_id, task_id, status, ...(reason ? { reason } : {}) });
    if ([request_id, task_id, agent_id, conversation_id, user_id].some(value => typeof value !== 'string' || !value || value.length > 512)
      || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000 || (data.images && data.images.length)) {
      return Promise.resolve(result('unavailable', '补充输入格式无效'));
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([task_id, agent_id, conversation_id, user_id, prompt])).digest('hex');
    const existing = receipts.get(request_id);
    if (existing) {
      return existing.fingerprint === fingerprint ? existing.promise
        : Promise.resolve(result('unknown', '补充请求标识冲突，未重复发送'));
    }
    for (const [key, receipt] of receipts) {
      if (receipt.expiresAt && receipt.expiresAt < Date.now()) receipts.delete(key);
    }
    if (receipts.size >= 1024) return Promise.resolve(result('unavailable', '补充请求繁忙'));
    const entry = { fingerprint, promise: null, expiresAt: 0 };
    entry.promise = Promise.resolve().then(async () => {
      const { slot, context } = getRuntime(agent_id, conversation_id) || {};
      if (!slot || typeof slot.steerPrompt !== 'function') return result('unavailable', '当前运行器不支持即时引导');
      if (!context || context.taskId !== task_id || context.agentId !== agent_id
        || context.conversationId !== conversation_id || context.userId !== user_id) {
        return result('unavailable', '当前执行归属已改变');
      }
      try {
        const response = await slot.steerPrompt(prompt, { task_id, agent_id, conversation_id, user_id });
        if (response?.status === 'accepted') return result('accepted');
        if (response?.status === 'unavailable') return result('unavailable', '当前执行不能接收即时引导');
        return result('unknown', '运行时未确认补充指令，请勿重复发送');
      } catch {
        return result('unknown', '运行时未确认补充指令，请勿重复发送');
      }
    }).finally(() => { entry.expiresAt = Date.now() + 5 * 60 * 1000; });
    receipts.set(request_id, entry);
    return entry.promise;
  };
}

module.exports = { createTaskSteering };
