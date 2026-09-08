'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { createCodexCliSpec, normalizeRuntimeConfig, runtimeConfigFingerprint } = require('../codex');

// ctx.codexLocalInstallPaths / codexExtensionPath / existingFile / commandVersion /
// fs / pathJoin / tmpdir / defaultSkills / resolveCommand（fallback）/ ensureDiAgentCodexHome /
// ensureDiAgentCodexMcpConfig / ensureTaskWorkdir / buildDiAgentContextEnv /
// logFlow / processSpec / spawnSync / firstLine
function buildMockCtx(overrides = {}) {
  return {
    defaultSkills: (caps) => caps.map((id) => ({ id, name: id })),
    resolveCommand: (name) => `/bin/${name}`,
    commandVersion: overrides.commandVersion || (() => '1.0.0'),
    existingFile: overrides.existingFile || ((v) => v || null),
    codexLocalInstallPaths: overrides.codexLocalInstallPaths || (() => []),
    codexDesktopRuntimePaths: overrides.codexDesktopRuntimePaths || (() => []),
    codexExtensionPath: overrides.codexExtensionPath || (() => null),
    fs: overrides.fs || {
      existsSync: () => false,
      readFileSync: () => '',
      rmSync: () => {},
    },
    pathJoin: (...args) => args.join('/'),
    tmpdir: () => '/tmp',
    ensureDiAgentCodexHome: overrides.ensureDiAgentCodexHome || (() => '/tmp/codex-home'),
    ensureDiAgentCodexMcpConfig: overrides.ensureDiAgentCodexMcpConfig || (() => {}),
    ensureTaskWorkdir: () => '/tmp/work',
    buildDiAgentContextEnv: overrides.buildDiAgentContextEnv || (() => ({})),
    logFlow: () => {},
    processSpec: (command, args) => ({ command, args }),
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    firstLine: (s) => String(s || '').split('\n')[0],
  };
}

function fakeCodexChild(onRequest = () => {}) {
  const child = new EventEmitter();
  child.pid = 9876;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = {
    writes: [],
    write(line, callback) {
      this.writes.push(line);
      onRequest(JSON.parse(line), child);
      if (typeof callback === 'function') queueMicrotask(() => callback(null));
      return true;
    },
  };
  child.kill = () => { child.exitCode = 0; };
  return child;
}

function emitCodexLine(child, message) {
  queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(message)}\n`));
}

function buildPersistentHarness(overrides = {}) {
  const calls = { spawn: [], logs: [], processSpec: [] };
  let child;
  let lastTurnControls = null;
  const ctx = buildMockCtx({
    resolveCommand: () => '/Applications/ChatGPT.app/Contents/Resources/codex',
    ...overrides,
  });
  Object.assign(ctx, {
    resolveCommand: () => '/Applications/ChatGPT.app/Contents/Resources/codex',
    ensureTaskWorkdir: () => '/tmp/codex-work',
    buildDiAgentContextEnv: () => ({ DI_AGENT_TASK_ID: 'task-1' }),
    crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
    agentTurnStates: new Map(),
    truncateStr: (value) => value,
    EXEC_TIMEOUT_MS: 1000,
    PROTOCOL_TIMEOUT_MS: 20,
    logFlow: (level, event, payload) => calls.logs.push({ level, event, payload }),
    processSpec: (command, args) => {
      calls.processSpec.push({ command, args });
      return { command: '/wrapped-codex', args: [command, ...args] };
    },
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options });
      child = fakeCodexChild((message, activeChild) => {
        if (message.method === 'initialize') {
          emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: {} });
        } else if (message.method === 'thread/start') {
          emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: { thread: { id: 'thread-1' } } });
        } else if (message.method === 'turn/start') {
          lastTurnControls = message.params;
          emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-1' } } });
          setImmediate(() => {
            activeChild.stdout.emit('data', `${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'hello' } })}\n`);
            activeChild.stdout.emit('data', `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })}\n`);
            if (overrides.duplicateTerminal) {
              activeChild.stdout.emit('data', `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })}\n`);
            }
          });
        } else if (message.method === 'thread/resume') {
          if (overrides.resumeError) {
            emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, error: overrides.resumeError });
          } else if (overrides.resumeUnavailable) {
            emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: {} });
          } else {
            const resumeSettings = overrides.resumeSettings || {
              model: lastTurnControls?.model || 'gpt-5.6-sol',
              reasoningEffort: lastTurnControls?.effort || 'medium',
              serviceTier: lastTurnControls?.serviceTier ?? null,
            };
            emitCodexLine(activeChild, {
              jsonrpc: '2.0',
              id: message.id,
              result: { thread: { id: 'thread-1' }, ...resumeSettings },
            });
          }
        }
      });
      return child;
    },
  });
  Object.assign(ctx, overrides);
  return { ctx, calls, get child() { return child; } };
}

test('codex.resolveCommand returns DI_AGENT_CODEX_COMMAND env var when valid', () => {
  process.env.DI_AGENT_CODEX_COMMAND = '/custom/codex';
  const ctx = buildMockCtx({
    existingFile: (v) => v || null,
    commandVersion: () => '1.2.3',
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.resolveCommand(), '/custom/codex');
  delete process.env.DI_AGENT_CODEX_COMMAND;
});

test('codex persistent adapter launches the resolved runtime through process normalization', async () => {
  const harness = buildPersistentHarness();
  const selections = [];
  harness.ctx.resolveCommand = (cliTool, runtimeVariant) => {
    selections.push({ cliTool, runtimeVariant });
    return '/Applications/ChatGPT.app/Contents/Resources/codex';
  };
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    runtimeVariant: 'desktop',
  }, harness.ctx);

  assert.deepStrictEqual(await runtime.sendPrompt('hello'), { result: 'hello' });
  assert.strictEqual(harness.calls.processSpec.length, 1);
  assert.strictEqual(harness.calls.spawn[0].command, '/wrapped-codex');
  assert.deepStrictEqual(harness.calls.spawn[0].args.slice(0, 2), [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    'app-server',
  ]);
  assert.deepStrictEqual(selections, [{ cliTool: 'codex', runtimeVariant: 'desktop' }]);
});

test('codex persistent adapter sends model, reasoning and safe approval controls per turn', async () => {
  const harness = buildPersistentHarness();
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-controls',
    conversationId: 'conv-controls',
    userId: 'user-controls',
  }, harness.ctx);

  await runtime.sendPrompt('hello', {
    version: 2,
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    approval_mode: 'request',
    service_tier: 'priority',
  });

  const turnStart = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.method === 'turn/start');
  assert.strictEqual(turnStart.params.model, 'gpt-5.6-sol');
  assert.strictEqual(turnStart.params.effort, 'high');
  assert.strictEqual(turnStart.params.serviceTier, 'priority');
  assert.strictEqual(turnStart.params.approvalPolicy, 'untrusted');
  assert.strictEqual(turnStart.params.approvalsReviewer, 'user');
  assert.strictEqual(turnStart.params.sandboxPolicy.type, 'workspaceWrite');
});

test('codex runtime config rejects malformed or unknown policy instead of silently downgrading', () => {
  assert.throws(() => normalizeRuntimeConfig({ approval_mode: 'request' }), /version/);
  assert.throws(() => normalizeRuntimeConfig({
    version: 1,
    model: 'not-a-model',
    reasoning_effort: 'medium',
    approval_mode: 'auto',
  }), /model/);
  assert.throws(() => runtimeConfigFingerprint({
    version: 3,
    model: '',
    reasoning_effort: 'medium',
    approval_mode: 'auto',
    service_tier: 'default',
  }), /version/);
});

test('codex runtime config migrates v1 and rejects unsupported priority combinations', () => {
  assert.deepStrictEqual(normalizeRuntimeConfig({
    version: 1, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto',
  }), {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto', service_tier: 'default',
  });
  assert.throws(() => normalizeRuntimeConfig({
    version: 2, model: 'gpt-5.4-mini', reasoning_effort: 'medium', approval_mode: 'auto', service_tier: 'priority',
  }), /service tier/);
  assert.throws(() => normalizeRuntimeConfig({
    version: 1, model: 'gpt-5.6-sol', reasoning_effort: 'medium', approval_mode: 'auto', service_tier: 'priority',
  }), /version 2/);
});

test('codex logs app-server applied settings without prompts or secrets', async () => {
  const harness = buildPersistentHarness({
    resumeSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'high', serviceTier: 'priority' },
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-evidence', conversationId: 'conv-evidence', userId: 'user-evidence',
  }, harness.ctx);
  await runtime.sendPrompt('secret prompt must not be logged', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto', service_tier: 'priority',
  }, { task_id: 'task-evidence' });

  const evidence = harness.calls.logs.find((entry) => entry.event === 'agent.codex_runtime_applied');
  assert.ok(evidence);
  assert.deepStrictEqual(evidence.payload, {
    agent_id: 'agent-evidence',
    conversation_id: 'conv-evidence',
    task_id: 'task-evidence',
    thread_id: 'thread-1',
    requested_model: 'gpt-5.6-sol',
    applied_model: 'gpt-5.6-sol',
    requested_effort: 'high',
    applied_effort: 'high',
    requested_service_tier: 'priority',
    applied_service_tier: 'priority',
    runtime_match: true,
    runtime_status: 'matched',
  });
  assert.doesNotMatch(JSON.stringify(evidence), /secret prompt/);
  const resume = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.method === 'thread/resume');
  assert.deepStrictEqual(resume.params, { threadId: 'thread-1', excludeTurns: true });
  assert.ok(
    harness.calls.logs.findIndex((entry) => entry.event === 'agent.codex_runtime_applied')
      < harness.calls.logs.findIndex((entry) => entry.event === 'agent.turn_result'),
    'runtime verification must complete before the turn result is reported',
  );
});

test('codex reports runtime selection as unverified when thread/resume fails', async () => {
  const harness = buildPersistentHarness({ resumeError: { message: 'resume unavailable' } });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-no-evidence', conversationId: 'conv-no-evidence', userId: 'user-no-evidence',
  }, harness.ctx);
  await runtime.sendPrompt('hello', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'low', approval_mode: 'auto', service_tier: 'priority',
  }, { task_id: 'task-no-evidence' });
  const unverified = harness.calls.logs.find((entry) => entry.event === 'agent.codex_runtime_unverified');
  assert.ok(unverified);
  assert.strictEqual(unverified.payload.runtime_status, 'unverified');
  assert.strictEqual(unverified.payload.requested_model, 'gpt-5.6-sol');
  assert.strictEqual('applied_model' in unverified.payload, false);
  const requests = harness.child.stdin.writes.map((line) => JSON.parse(line));
  assert.strictEqual(requests.filter((message) => message.method === 'thread/resume').length, 1);
  assert.ok(
    harness.calls.logs.findIndex((entry) => entry.event === 'agent.codex_runtime_unverified')
      < harness.calls.logs.findIndex((entry) => entry.event === 'agent.turn_result'),
    'failed verification must be reported before the turn result',
  );
});

test('codex does not claim applied settings when thread/resume returns no runtime evidence', async () => {
  const harness = buildPersistentHarness({ resumeUnavailable: true });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-empty-evidence', conversationId: 'conv-empty-evidence', userId: 'user-empty-evidence',
  }, harness.ctx);
  await runtime.sendPrompt('hello', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'low', approval_mode: 'auto', service_tier: 'default',
  }, { task_id: 'task-empty-evidence' });

  assert.strictEqual(
    harness.calls.logs.filter((entry) => entry.event === 'agent.codex_runtime_unverified').length,
    1,
  );
  assert.strictEqual(
    harness.calls.logs.filter((entry) => entry.event === 'agent.codex_runtime_applied').length,
    0,
  );
});

test('codex sanitizes hostile applied settings and records a mismatch', async () => {
  const harness = buildPersistentHarness({
    resumeSettings: {
      model: 'hostile-model-with-secret',
      reasoningEffort: 'hostile-effort-with-secret',
      serviceTier: 'hostile-tier-with-secret',
    },
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-hostile', conversationId: 'conv-hostile', userId: 'user-hostile',
  }, harness.ctx);
  await runtime.sendPrompt('hello', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto', service_tier: 'priority',
  }, { task_id: 'task-hostile' });

  const evidence = harness.calls.logs.find((entry) => entry.event === 'agent.codex_runtime_applied');
  assert.ok(evidence);
  assert.strictEqual(evidence.payload.applied_model, 'unknown');
  assert.strictEqual(evidence.payload.applied_effort, 'unknown');
  assert.strictEqual(evidence.payload.applied_service_tier, 'unknown');
  assert.strictEqual(evidence.payload.runtime_match, false);
  assert.strictEqual(evidence.payload.runtime_status, 'mismatch');
  assert.doesNotMatch(JSON.stringify(evidence), /hostile-.*-with-secret/);
});

test('codex reports recognized thread/resume settings that differ from the request as a mismatch', async () => {
  const harness = buildPersistentHarness({
    resumeSettings: { model: 'gpt-5.6-terra', reasoningEffort: 'medium', serviceTier: null },
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-mismatch', conversationId: 'conv-mismatch', userId: 'user-mismatch',
  }, harness.ctx);
  await runtime.sendPrompt('hello', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto', service_tier: 'priority',
  }, { task_id: 'task-mismatch' });

  const evidence = harness.calls.logs.find((entry) => entry.event === 'agent.codex_runtime_applied');
  assert.ok(evidence);
  assert.strictEqual(evidence.payload.applied_model, 'gpt-5.6-terra');
  assert.strictEqual(evidence.payload.applied_effort, 'medium');
  assert.strictEqual(evidence.payload.applied_service_tier, 'default');
  assert.strictEqual(evidence.payload.runtime_match, false);
  assert.strictEqual(evidence.payload.runtime_status, 'mismatch');
});

test('codex verifies and finishes only once when app-server repeats a terminal notification', async () => {
  const events = [];
  const harness = buildPersistentHarness({ duplicateTerminal: true });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-duplicate-terminal',
    conversationId: 'conv-duplicate-terminal',
    userId: 'user-duplicate-terminal',
    eventRef: { current: (event) => events.push(event) },
  }, harness.ctx);

  assert.deepStrictEqual(await runtime.sendPrompt('hello', {
    version: 2, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'auto', service_tier: 'priority',
  }), { result: 'hello' });

  const requests = harness.child.stdin.writes.map((line) => JSON.parse(line));
  assert.strictEqual(requests.filter((message) => message.method === 'thread/resume').length, 1);
  assert.strictEqual(events.filter((event) => event.type === 'turn_end').length, 1);
  assert.strictEqual(harness.calls.logs.filter((entry) => entry.event === 'agent.codex_runtime_applied').length, 1);
  assert.strictEqual(harness.calls.logs.filter((entry) => entry.event === 'agent.turn_result').length, 1);
});

test('codex runtime config accepts every model exposed by the composer', () => {
  for (const model of [
    '', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
  ]) {
    assert.strictEqual(normalizeRuntimeConfig({
      version: 1, model, reasoning_effort: 'medium', approval_mode: 'auto',
    }).model, model);
  }
});

test('codex persistent adapter answers app-server approval requests through the daemon callback', async () => {
  const requests = [];
  const acknowledgements = [];
  const harness = buildPersistentHarness({
    requestApproval: async (request) => {
      requests.push(request);
      return { decision: 'accept', approval_id: 'approval-88', task_id: 'task-88' };
    },
    acknowledgeApproval: (acknowledgement) => acknowledgements.push(acknowledgement),
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-approval',
    conversationId: 'conv-approval',
    userId: 'user-approval',
  }, harness.ctx);

  const response = runtime.sendPrompt('run pwd', {
    version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'request',
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.child.stdout.emit('data', `${JSON.stringify({
    jsonrpc: '2.0',
    id: 88,
    method: 'item/commandExecution/requestApproval',
    params: { command: 'pwd', reason: 'inspect workdir' },
  })}\n`);
  await response;

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].kind, 'command');
  const approvalResponse = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 88);
  assert.deepStrictEqual(approvalResponse.result, { decision: 'accept' });
  assert.deepStrictEqual(acknowledgements, [{ approval_id: 'approval-88', task_id: 'task-88' }]);
});

test('codex persistent adapter does not acknowledge an approval when the app-server write fails', async () => {
  const acknowledgements = [];
  const failures = [];
  const harness = buildPersistentHarness({
    requestApproval: async () => ({ decision: 'accept', approval_id: 'approval-write-failed', task_id: 'task-write-failed' }),
    acknowledgeApproval: (acknowledgement) => acknowledgements.push(acknowledgement),
    failApproval: (failure) => failures.push(failure),
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-write-failed', conversationId: 'conv-write-failed', userId: 'user-write-failed',
  }, harness.ctx);

  const response = runtime.sendPrompt('run pwd', {
    version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'request',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const originalWrite = harness.child.stdin.write.bind(harness.child.stdin);
  harness.child.stdin.write = function writeWithApprovalFailure(line, callback) {
    const message = JSON.parse(line);
    if (message.id === 92) {
      this.writes.push(line);
      queueMicrotask(() => callback(new Error('write after end')));
      return false;
    }
    return originalWrite(line, callback);
  };
  harness.child.stdout.emit('data', `${JSON.stringify({
    jsonrpc: '2.0', id: 92, method: 'item/commandExecution/requestApproval', params: { command: 'pwd' },
  })}\n`);
  await response;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(acknowledgements, []);
  assert.deepStrictEqual(failures, [{
    approval_id: 'approval-write-failed', task_id: 'task-write-failed', error: 'write after end',
  }]);
  assert.ok(harness.calls.logs.some((entry) => entry.event === 'agent.approval_write_failed'));
});

test('codex persistent adapter returns a schema-valid empty permission grant when declined', async () => {
  const harness = buildPersistentHarness({ requestApproval: async () => 'decline' });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-permissions',
    conversationId: 'conv-permissions',
    userId: 'user-permissions',
  }, harness.ctx);

  const response = runtime.sendPrompt('use network', {
    version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'request',
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.child.stdout.emit('data', `${JSON.stringify({
    jsonrpc: '2.0',
    id: 89,
    method: 'item/permissions/requestApproval',
    params: { permissions: { network: { enabled: true } }, reason: 'reach API' },
  })}\n`);
  await response;

  const approvalResponse = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 89);
  assert.deepStrictEqual(approvalResponse.result, { permissions: {}, scope: 'turn' });
});

test('codex persistent adapter returns the requested permission profile when allowed once', async () => {
  const harness = buildPersistentHarness({ requestApproval: async () => 'accept' });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-permissions-allow', conversationId: 'conv-permissions-allow', userId: 'user-permissions-allow',
  }, harness.ctx);
  const response = runtime.sendPrompt('use network', {
    version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'request',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const permissions = { network: { enabled: true } };
  harness.child.stdout.emit('data', `${JSON.stringify({
    jsonrpc: '2.0', id: 90, method: 'item/permissions/requestApproval',
    params: { permissions, reason: 'reach API' },
  })}\n`);
  await response;
  const approvalResponse = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 90);
  assert.deepStrictEqual(approvalResponse.result, { permissions, scope: 'turn' });
});

test('codex persistent adapter refreshes the per-turn MCP task context', async () => {
  const updates = [];
  const harness = buildPersistentHarness({
    updateDiAgentCodexTaskContext: (_home, conversationId, userId, agentId, taskId) => {
      updates.push({ conversationId, userId, agentId, taskId });
    },
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-context',
    conversationId: 'conv-context',
    userId: 'user-context',
  }, harness.ctx);
  const config = { version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'auto' };

  await runtime.sendPrompt('first', config, { task_id: 'task-first', user_id: 'user-first' });
  await runtime.sendPrompt('second', config, { task_id: 'task-second', user_id: 'user-second' });

  assert.deepStrictEqual(updates.map((entry) => entry.taskId), ['task-first', 'task-second']);
  assert.deepStrictEqual(updates.map((entry) => entry.userId), ['user-first', 'user-second']);
});

test('codex binds a same-chunk approval request to the turn being started', async () => {
  const requests = [];
  const child = fakeCodexChild((message, activeChild) => {
    if (message.method === 'initialize') {
      emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'thread/start') {
      emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: { thread: { id: 'thread-race' } } });
    } else if (message.method === 'turn/start') {
      queueMicrotask(() => activeChild.stdout.emit('data', [
        JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-race' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 901, method: 'item/commandExecution/requestApproval', params: { command: 'pwd' } }),
      ].join('\n') + '\n'));
      setImmediate(() => activeChild.stdout.emit('data', `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-race', status: 'completed' } } })}\n`));
    }
  });
  const harness = buildPersistentHarness({
    spawn: () => child,
    requestApproval: async (request) => {
      requests.push(request);
      return 'decline';
    },
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-race', conversationId: 'conv-race', userId: 'user-race',
    taskCtx: { taskId: 'slot-first-task' },
  }, harness.ctx);

  await runtime.sendPrompt('next', {
    version: 1, model: '', reasoning_effort: 'medium', approval_mode: 'request',
  }, { task_id: 'current-task', agent_id: 'agent-race', conversation_id: 'conv-race', user_id: 'user-race' });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].task_id, 'current-task');
});

test('codex preserves same-chunk turn/start response, delta, and terminal notification order', async () => {
  const events = [];
  const child = fakeCodexChild((message, activeChild) => {
    if (message.method === 'initialize') {
      emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'thread/start') {
      emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: { thread: { id: 'thread-same-chunk' } } });
    } else if (message.method === 'turn/start') {
      queueMicrotask(() => activeChild.stdout.emit('data', [
        JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-same-chunk' } } }),
        JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'same chunk result' } }),
        JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-same-chunk', status: 'completed' } } }),
      ].join('\n') + '\n'));
    } else if (message.method === 'thread/resume') {
      emitCodexLine(activeChild, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          thread: { id: 'thread-same-chunk' },
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          serviceTier: 'priority',
        },
      });
    }
  });
  const harness = buildPersistentHarness({ spawn: () => child });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-same-chunk',
    conversationId: 'conv-same-chunk',
    userId: 'user-same-chunk',
    eventRef: { current: (event) => events.push(event) },
  }, harness.ctx);
  let finishCount = 0;

  const response = await Promise.race([
    runtime.sendPrompt('hello', {
      version: 2,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'auto',
      service_tier: 'priority',
    }).then((value) => {
      finishCount += 1;
      return value;
    }),
    new Promise((resolve) => setTimeout(() => resolve({ error: 'test timed out' }), 100)),
  ]);

  assert.deepStrictEqual(response, { result: 'same chunk result' });
  assert.strictEqual(finishCount, 1);
  const requests = child.stdin.writes.map((line) => JSON.parse(line));
  assert.strictEqual(requests.filter((message) => message.method === 'thread/resume').length, 1);
  assert.strictEqual(harness.calls.logs.filter((entry) => entry.event === 'agent.codex_runtime_applied').length, 1);
  assert.strictEqual(events.filter((event) => event.type === 'turn_end').length, 1);
});

test('codex persistent adapter returns an actionable protocol timeout', async () => {
  const child = fakeCodexChild();
  const harness = buildPersistentHarness({
    PROTOCOL_TIMEOUT_MS: 10,
    spawn: () => child,
  });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-timeout',
    conversationId: 'conv-timeout',
    userId: 'user-timeout',
  }, harness.ctx);

  const response = await Promise.race([
    runtime.sendPrompt('hello'),
    new Promise((resolve) => setTimeout(() => resolve({ error: 'test timed out' }), 100)),
  ]);

  assert.match(response.error, /initialize.*超时/);
  assert.strictEqual(child.exitCode, 0);
});

test('codex persistent adapter settles startup when the child emits an error', async () => {
  const child = fakeCodexChild();
  const harness = buildPersistentHarness({ spawn: () => child });
  const runtime = createCodexCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-error',
    conversationId: 'conv-error',
    userId: 'user-error',
  }, harness.ctx);

  const responsePromise = runtime.sendPrompt('hello');
  queueMicrotask(() => child.emit('error', new Error('desktop executable disappeared')));
  const response = await Promise.race([
    responsePromise,
    new Promise((resolve) => setTimeout(() => resolve({ error: 'test timed out' }), 100)),
  ]);

  assert.match(response.error, /desktop executable disappeared/);
  assert.ok(harness.calls.logs.some((entry) => entry.event === 'agent.process_error'));
});

test('codex.resolveCommand falls back through candidates', () => {
  delete process.env.DI_AGENT_CODEX_COMMAND;
  const ctx = buildMockCtx({
    codexLocalInstallPaths: () => ['/home/.local/bin/codex'],
    codexExtensionPath: () => null,
    commandVersion: (cmd) => (cmd === '/home/.local/bin/codex' ? '1.0.0' : null),
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.resolveCommand(), '/home/.local/bin/codex');
});

test('codex.resolveCommand prefers standalone CLI before Desktop when both are runnable', () => {
  delete process.env.DI_AGENT_CODEX_COMMAND;
  const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const ctx = buildMockCtx({
    codexDesktopRuntimePaths: () => [desktop],
    commandVersion: (cmd) => (cmd === 'codex' || cmd === desktop ? '1.0.0' : null),
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.resolveCommand(), 'codex');
  assert.strictEqual(spec.variantForCommand('codex'), 'cli');
});

test('codex exposes both runnable variants and resolves an explicitly requested Desktop runtime', () => {
  delete process.env.DI_AGENT_CODEX_COMMAND;
  const desktop = '/Applications/Codex.app/Contents/Resources/codex';
  const ctx = buildMockCtx({
    codexDesktopRuntimePaths: () => [desktop],
    existingFile: (candidate) => candidate === desktop,
    commandVersion: (command) => (command === 'codex' ? 'codex-cli 1.0.0' : 'codex-cli 2.0.0'),
  });
  const spec = createCodexCliSpec(ctx);

  assert.deepStrictEqual(spec.resolveCommands(), [
    { command: 'codex', variant: 'cli', version: 'codex-cli 1.0.0' },
    { command: desktop, variant: 'desktop', version: 'codex-cli 2.0.0' },
  ]);
  assert.strictEqual(spec.resolveCommand({ runtimeVariant: 'desktop' }), desktop);
});

test('codex exact runtime selection fails actionably when the requested variant is unavailable', () => {
  const ctx = buildMockCtx({
    codexDesktopRuntimePaths: () => [],
    commandVersion: (command) => (command === 'codex' ? 'codex-cli 1.0.0' : null),
  });
  const spec = createCodexCliSpec(ctx);

  assert.throws(
    () => spec.resolveCommand({ runtimeVariant: 'desktop' }),
    /Codex Desktop.*not available/i,
  );
});

test('codex.resolveCommand uses the Desktop bundled runtime as fallback', () => {
  delete process.env.DI_AGENT_CODEX_COMMAND;
  const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const ctx = buildMockCtx({
    codexDesktopRuntimePaths: () => [desktop],
    existingFile: (candidate) => candidate === desktop,
    commandVersion: (cmd) => (cmd === desktop ? 'codex-cli 2.0.0' : null),
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.resolveCommand(), desktop);
  assert.strictEqual(spec.variantForCommand(desktop), 'desktop');
});

test('codex.resolveCommand returns "codex" literal when nothing matches', () => {
  delete process.env.DI_AGENT_CODEX_COMMAND;
  const ctx = buildMockCtx({
    codexLocalInstallPaths: () => [],
    codexExtensionPath: () => null,
    commandVersion: () => null,
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.resolveCommand(), 'codex');
});

test('codex.buildCommand passes task id to MCP config and context env', () => {
  const calls = [];
  const ctx = buildMockCtx({
    ensureDiAgentCodexMcpConfig: (...args) => { calls.push(args); },
    buildDiAgentContextEnv: (conv, user, agent, taskId) => ({
      DI_AGENT_CONVERSATION_ID: conv,
      DI_AGENT_USER_ID: user,
      DI_AGENT_AGENT_ID: agent,
      DI_AGENT_TASK_ID: taskId,
    }),
  });
  const spec = createCodexCliSpec(ctx);
  const command = spec.buildCommand({
    id: 'task-from-payload',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    agent_id: 'agent-1',
  }, {
    command: 'codex',
    systemPrompt: '',
    userPrompt: 'hello',
    taskId: 'task-from-context',
  });

  assert.deepStrictEqual(calls[0], [
    '/tmp/codex-home',
    'conv-1',
    'user-1',
    'agent-1',
    'task-from-context',
  ]);
  assert.strictEqual(command.env.DI_AGENT_TASK_ID, 'task-from-context');
});

test('codex.parseResult prefers outputFile when present and non-empty', () => {
  const ctx = buildMockCtx({
    fs: {
      existsSync: (p) => p === '/tmp/out.txt',
      readFileSync: () => 'file content',
      rmSync: () => {},
    },
  });
  const spec = createCodexCliSpec(ctx);
  const result = spec.parseResult({
    stdout: 'stdio content',
    outputFile: '/tmp/out.txt',
  });
  assert.strictEqual(result, 'file content');
});

test('codex.parseResult ignores unstructured stdout when outputFile missing', () => {
  const ctx = buildMockCtx({
    fs: {
      existsSync: () => false,
      readFileSync: () => '',
      rmSync: () => {},
    },
  });
  const spec = createCodexCliSpec(ctx);
  const result = spec.parseResult({ stdout: 'stdio only', stderr: '' });
  assert.strictEqual(result, '(Agent CLI 没有返回内容)');
});

test('codex.parseResult does not return raw stdout or stderr logs', () => {
  const ctx = buildMockCtx({
    fs: { existsSync: () => false, readFileSync: () => '', rmSync: () => {} },
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.parseResult({ stdout: 'out', stderr: 'err' }), '(Agent CLI 没有返回内容)');
});

test('codex.parseResult returns fallback message when empty', () => {
  const ctx = buildMockCtx({
    fs: { existsSync: () => false, readFileSync: () => '', rmSync: () => {} },
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.parseResult({}), '(Agent CLI 没有返回内容)');
});

test('Codex native MCP completion preserves ID, server, input and failure', () => {
  const spec = createCodexCliSpec(buildMockCtx());
  const events = spec.parseStreamEvent(JSON.stringify({ type: 'item.completed', item: { id: 'native-mcp-1', type: 'mcp_tool_call', server: 'di_agent', tool: 'get_agent_skill', arguments: { name: 'review' }, status: 'failed', error: { message: 'not found' } } }));
  assert.equal(events[0].toolUseID, 'native-mcp-1');
  assert.equal(events[0].server_name, 'di_agent');
  assert.deepEqual(events[0].input, { name: 'review' });
  assert.equal(events[1].toolUseID, 'native-mcp-1');
  assert.equal(events[1].isError, true);
});

test('Codex missing final file extracts only last assistant event, never native skill output or stderr', () => {
 const spec = createCodexCliSpec(buildMockCtx());
 const stdout = [
  {type:'item.completed',item:{type:'agent_message',text:'checking'}},
  {type:'item.completed',item:{type:'mcp_tool_call',tool:'get_agent_skill',output:'PRIVATE BODY'}},
  {type:'item.completed',item:{type:'agent_message',text:'Final answer'}},
  {type:'turn.completed',usage:{total:42}},
 ].map(JSON.stringify).join('\n');
 assert.equal(spec.parseResult({stdout,stderr:'PRIVATE STDERR'}), 'Final answer');
 assert.equal(spec.parseResult({stdout:JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',output:'PRIVATE BODY'}})}), '(Agent CLI 没有返回内容)');
});

test('Codex CLI emits native starts once and matches interleaved completions by ID', () => {
 const spec = createCodexCliSpec(buildMockCtx());
 const context = {};
 const parse = (type, id) => spec.parseStreamEvent(JSON.stringify({type,item:{type:'command_execution',id,command:'pwd',status:type === 'item.started' ? 'in_progress' : 'completed',aggregated_output:'done'}}),context);
 assert.equal(parse('item.started','a')[0].type, 'tool_use');
 assert.equal(parse('item.started','b')[0].type, 'tool_use');
 const resultB = parse('item.completed','b');
 assert.equal(resultB.length, 1);
 assert.equal(resultB[0].toolUseID, 'b');
 assert.equal(resultB[0].type, 'tool_result');
 assert.equal(parse('item.completed','a').length, 1);
 const missingStart = parse('item.completed','unknown');
 assert.equal(missingStart[0].timing_incomplete, true);
 // A different invocation cannot inherit a reused native ID.
 assert.equal(spec.parseStreamEvent(JSON.stringify({type:'item.completed',item:{type:'command_execution',id:'a'}}),{})[0].timing_incomplete,true);
});

test('Codex app-server commands preserve start/completion boundaries without duplicate calls', async () => {
 const harness = buildPersistentHarness();
 const events = [];
 const spec = createCodexCliSpec(harness.ctx);
 const slot = spec.spawnPersistent({ agentId: 'a', conversationId: 'c', eventRef: {current: ev => events.push(ev)} },harness.ctx);
 await slot.sendPrompt('hello');
 harness.child.stdout.emit('data', JSON.stringify({method:'item/started',params:{item:{type:'commandExecution',id:'shell-1',command:'pwd'}}})+'\n');
 harness.child.stdout.emit('data', JSON.stringify({method:'item/completed',params:{item:{type:'commandExecution',id:'shell-1',command:'pwd',status:'completed',aggregatedOutput:'done'}}})+'\n');
 assert.equal(events.filter(ev => ev.toolUseID === 'shell-1' && ev.type === 'tool_use').length,1);
 assert.equal(events.filter(ev => ev.toolUseID === 'shell-1' && ev.type === 'tool_result').length,1);
});
