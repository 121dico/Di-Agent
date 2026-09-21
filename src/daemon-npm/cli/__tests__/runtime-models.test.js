'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { scanRuntimeModels, listCodexModels, normalizeModel } = require('../runtime-models');
function fakeProcess(reply) {
  const calls = []; const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = { end() {}, write(line, cb) {
    const msg = JSON.parse(line); calls.push(msg);
    queueMicrotask(() => { const result = reply(msg); if (result) child.stdout.emit('data', JSON.stringify(result) + '\n'); });
    cb?.();
  } };
  child.kill = () => { calls.push('killed'); child.emit('close'); };
  return { child, calls, spawnImpl: () => child };
}
test('scan reads native models across pages and strips account/config secrets without starting a turn', async () => {
  const mock = fakeProcess(msg => ({ id: msg.id, result: msg.method === 'initialize' ? {}
    : msg.method === 'config/read' ? { config: { model: 'gpt-local', api_key: 'secret' } }
      : msg.params.cursor ? { data: [{ model: 'gpt-next', displayName: 'Next' }], nextCursor: null }
        : { data: [{ model: 'gpt-local', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }], nextCursor: 'page-2' } }));
  const result = await scanRuntimeModels({ cliTool: 'codex', command: 'codex', ...mock });
  assert.deepEqual(result.models.map(m => m.id), ['gpt-local', 'gpt-next']);
  assert.equal(result.default_model, 'gpt-local');
  assert.deepEqual(result.models[0].reasoning_efforts, ['ultra']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(mock.calls.some(c => c.method === 'thread/start' || c.method === 'turn/start'), false);
  assert.equal(mock.calls.at(-1), 'killed');
});
test('Claude scan exposes locally resolved aliases and never account metadata', async () => {
  const mock = fakeProcess(msg => ({ type: 'control_response', response: { request_id: msg.request_id, subtype: 'success', response: {
    account: { token: 'secret' }, models: [{ value: 'default', resolvedModel: 'local-v1', displayName: 'Default' }, { value: 'opus', resolvedModel: 'local-v2', displayName: 'Local' }],
  } } }));
  const result = await scanRuntimeModels({ cliTool: 'claude', command: 'claude', ...mock });
  assert.equal(result.default_model, 'local-v1');
  assert.deepEqual(result.models.map(m => m.id), ['', 'opus']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('probe times out and closes child; empty models are a failure, not an invented list', async () => {
  const timeout = fakeProcess(() => null);
  await assert.rejects(scanRuntimeModels({ cliTool: 'codex', command: 'codex', ...timeout, timeoutMs: 5 }), /超时/);
  assert.equal(timeout.calls.at(-1), 'killed');
  const empty = fakeProcess(msg => ({ id: msg.id, result: { data: [] } }));
  await assert.rejects(scanRuntimeModels({ cliTool: 'codex', command: 'codex', ...empty }), /没有返回/);
});
test('model pagination rejects repeated cursors and model normalization handles wire defaults', async () => {
  await assert.rejects(listCodexModels(async () => ({ result: { data: [], nextCursor: 'repeat' } })), /分页/);
  for (const v of [undefined, null, '', 'default']) assert.equal(normalizeModel(v), '');
  assert.equal(normalizeModel('provider/model-new[1m]'), 'provider/model-new[1m]');
  for (const v of ['--model', 'bad\nmodel', {}, 1]) assert.throws(() => normalizeModel(v), /model/);
});
