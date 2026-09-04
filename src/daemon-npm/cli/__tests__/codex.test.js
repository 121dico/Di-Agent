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
    write(line) {
      this.writes.push(line);
      onRequest(JSON.parse(line), child);
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
          emitCodexLine(activeChild, { jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-1' } } });
          setImmediate(() => {
            activeChild.stdout.emit('data', `${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'hello' } })}\n`);
            activeChild.stdout.emit('data', `${JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })}\n`);
          });
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
    version: 1,
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    approval_mode: 'request',
  });

  const turnStart = harness.child.stdin.writes
    .map((line) => JSON.parse(line))
    .find((message) => message.method === 'turn/start');
  assert.strictEqual(turnStart.params.model, 'gpt-5.6-sol');
  assert.strictEqual(turnStart.params.effort, 'high');
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
    version: 2,
    model: '',
    reasoning_effort: 'medium',
    approval_mode: 'auto',
  }), /version/);
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

test('codex.parseResult falls back to stdio when outputFile missing', () => {
  const ctx = buildMockCtx({
    fs: {
      existsSync: () => false,
      readFileSync: () => '',
      rmSync: () => {},
    },
  });
  const spec = createCodexCliSpec(ctx);
  const result = spec.parseResult({ stdout: 'stdio only', stderr: '' });
  assert.strictEqual(result, 'stdio only');
});

test('codex.parseResult combines stdout and stderr with newline', () => {
  const ctx = buildMockCtx({
    fs: { existsSync: () => false, readFileSync: () => '', rmSync: () => {} },
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.parseResult({ stdout: 'out', stderr: 'err' }), 'out\nerr');
});

test('codex.parseResult returns fallback message when empty', () => {
  const ctx = buildMockCtx({
    fs: { existsSync: () => false, readFileSync: () => '', rmSync: () => {} },
  });
  const spec = createCodexCliSpec(ctx);
  assert.strictEqual(spec.parseResult({}), '(Agent CLI 没有返回内容)');
});
