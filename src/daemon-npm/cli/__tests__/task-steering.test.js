'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTaskSteering } = require('../task-steering');

test('daemon routes a supplement to the exact running task and reuses its receipt', async () => {
  const request = { request_id: 'r1', task_id: 't1', agent_id: 'a1', conversation_id: 'c1', user_id: 'u1', prompt: 'change direction' };
  const deliveries = [];
  const handle = createTaskSteering({ getRuntime: () => ({
    context: { taskId: 't1', agentId: 'a1', conversationId: 'c1', userId: 'u1' },
    slot: { async steerPrompt(prompt, identity) { deliveries.push({ prompt, identity }); return { status: 'accepted' }; } },
  }) });
  const receipts = await Promise.all([handle(request), handle(request)]);
  assert.deepEqual(receipts, [
    { request_id: 'r1', task_id: 't1', status: 'accepted' },
    { request_id: 'r1', task_id: 't1', status: 'accepted' },
  ]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].prompt, 'change direction');
  assert.equal(deliveries[0].identity.task_id, 't1');
});

test('daemon refuses wrong task, conversation, agent or user before touching the runtime', async () => {
  let deliveries = 0;
  const request = { request_id: 'r', task_id: 't', agent_id: 'a', conversation_id: 'c', user_id: 'u', prompt: 'change' };
  const handle = createTaskSteering({ getRuntime: () => ({
    context: { taskId: 't', agentId: 'a', conversationId: 'c', userId: 'u' },
    slot: { async steerPrompt() { deliveries += 1; return { status: 'accepted' }; } },
  }) });
  for (const field of ['task_id', 'agent_id', 'conversation_id', 'user_id']) {
    assert.equal((await handle({ ...request, request_id: field, [field]: 'other' })).status, 'unavailable');
  }
  assert.equal(deliveries, 0);
});

test('unsupported runtime is unavailable and ambiguous delivery stays unknown on retry', async () => {
  const request = { request_id: 'r', task_id: 't', agent_id: 'a', conversation_id: 'c', user_id: 'u', prompt: 'change' };
  const context = { taskId: 't', agentId: 'a', conversationId: 'c', userId: 'u' };
  const unsupported = createTaskSteering({ getRuntime: () => ({ context, slot: {} }) });
  assert.equal((await unsupported(request)).status, 'unavailable');
  for (const failure of ['throw', 'unknown', 'malformed']) {
    let deliveries = 0;
    const handle = createTaskSteering({ getRuntime: () => ({ context, slot: {
      async steerPrompt() {
        deliveries += 1;
        if (failure === 'throw') throw new Error('private native failure');
        return failure === 'unknown' ? { status: 'unknown' } : undefined;
      },
    } }) });
    const result = await handle(request);
    assert.equal(result.status, 'unknown');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(await handle(request), result);
    assert.equal(deliveries, 1);
    assert.equal((await handle({ ...request, prompt: 'different instruction' })).status, 'unknown');
    assert.equal(deliveries, 1);
  }
});
