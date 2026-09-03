'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createZcodeCliSpec, redactEventValue } = require('../zcode');
const { buildLegacyRuntimeModel, loadZcodeRuntimeModel } = require('../zcode_runtime');
const { EVENT_TYPES } = require('../events');

const SECRET = 'zcode-test-secret-never-log';

function legacyConfig() {
  return {
    config: {
      provider: {
        'builtin:bigmodel-coding-plan': {
          name: 'BigModel - Coding Plan',
          kind: 'anthropic',
          source: 'custom',
          enabled: true,
          options: { baseURL: 'https://example.invalid/anthropic', apiKey: SECRET },
          models: {
            'GLM-5.2': { limit: { context: 1000000, output: 128000 }, zcode: { priority: 100 } },
            'GLM-5.3': { limit: { context: 1000000 }, zcode: { priority: 99 } },
          },
        },
      },
    },
    settings: {
      providerFamilyDomain: 'bigmodel',
      modelProviderFamilySelectedKeys: {
        bigmodel: 'coding-plan:builtin:bigmodel-coding-plan',
      },
    },
  };
}

test('legacy ZCode provider is converted to a strict in-memory runtimeModel', () => {
  const fixture = legacyConfig();
  const runtimeModel = buildLegacyRuntimeModel({
    config: fixture.config,
    settings: fixture.settings,
    now: 1700000000000,
  });

  assert.deepEqual(runtimeModel.model, {
    providerId: 'builtin:bigmodel-coding-plan',
    modelId: 'GLM-5.3',
  });
  assert.equal(runtimeModel.provider.kind, 'anthropic');
  assert.equal(runtimeModel.provider.baseURL, 'https://example.invalid/anthropic');
  assert.deepEqual(runtimeModel.provider.apiKey, { source: 'inline', value: SECRET });
  assert.equal(runtimeModel.provider.models[0].contextWindow, 1000000);
  assert.equal(runtimeModel.generatedAt, 1700000000000);
});

test('legacy ZCode provider reports an actionable missing-model error', () => {
  assert.throws(
    () => buildLegacyRuntimeModel({ config: { provider: {} }, settings: {} }),
    /ZCode Desktop.*模型|provider/i,
  );
});

test('native ZCode CLI config wins without copying or rewriting desktop credentials', () => {
  const reads = [];
  const runtimeModel = loadZcodeRuntimeModel({
    fsImpl: {
      existsSync: (file) => file === '/Users/tester/.zcode/cli/config.json',
      readFileSync: (file) => { reads.push(file); return '{}'; },
    },
    home: '/Users/tester',
    pathJoin: (...parts) => parts.join('/'),
  });
  assert.equal(runtimeModel, null);
  assert.deepEqual(reads, []);
});

function fakeChild(onRequest) {
  const child = new EventEmitter();
  child.pid = 4321;
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

function emitLine(child, message) {
  queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(message)}\n`));
}

function buildMockCtx(overrides = {}) {
  const calls = { spawn: [], logs: [] };
  let child;
  const ctx = {
    defaultSkills: (caps) => caps.map((name) => ({ name })),
    resolveCommand: () => '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
    commandVersion: (command) => (command === 'zcode' ? null : 'zcode 0.16.3'),
    existingFile: (command) => command.startsWith('/Applications/'),
    zcodeDesktopRuntimePaths: () => ['/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'],
    processSpec: (command, args) => ({ command: '/node', args: [command, ...args] }),
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options });
      child = fakeChild((message, activeChild) => {
        if (message.method === 'session/create') {
          emitLine(activeChild, {
            id: 'server-1',
            method: 'session/requestRuntimePreferences',
            params: { sessionId: 'sess-zcode', scope: 'runtime-materialization' },
          });
          emitLine(activeChild, { id: message.id, result: { sessionId: 'sess-zcode' } });
        } else if (message.method === 'session/subscribe') {
          emitLine(activeChild, { id: message.id, result: { sessionId: 'sess-zcode', eventSeq: 0, events: [] } });
        } else if (message.method === 'session/send') {
          emitLine(activeChild, { id: message.id, result: { sessionId: 'sess-zcode', accepted: true, stateRevision: 1 } });
          emitLine(activeChild, {
            method: 'session/event',
            params: {
              type: 'model.streaming',
              sessionId: 'sess-zcode',
              payload: { kind: 'reasoning_delta', delta: 'think' },
            },
          });
          emitLine(activeChild, {
            method: 'session/event',
            params: {
              type: 'model.streaming',
              sessionId: 'sess-zcode',
              payload: { kind: 'text_delta', delta: 'hello' },
            },
          });
          emitLine(activeChild, {
            method: 'session/event',
            params: {
              type: 'turn.completed',
              sessionId: 'sess-zcode',
              payload: { response: 'hello', resultType: 'success' },
            },
          });
        } else if (message.method === 'session/close') {
          emitLine(activeChild, { id: message.id, result: {} });
        }
      });
      return child;
    },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fs: {
      existsSync: (file) => file.endsWith('/v2/config.json') || file.endsWith('/v2/setting.json'),
      readFileSync: (file) => JSON.stringify(file.endsWith('/config.json') ? legacyConfig().config : legacyConfig().settings),
    },
    homedir: () => '/Users/tester',
    pathJoin: (...parts) => parts.join('/'),
    ensureTaskWorkdir: () => '/tmp/zcode-work',
    buildPlatformMcpServerArgs: () => [
      '/daemon.js',
      '--server-url',
      'http://di-agent.invalid',
      '--api-key',
      'platform-key',
      '--daemon-token',
      'daemon-token',
      '--mcp',
    ],
    buildDiAgentContextEnv: () => ({ DI_AGENT_TASK_ID: 'task-1' }),
    logFlow: (level, event, payload) => calls.logs.push({ level, event, payload }),
    truncateStr: (value) => value,
    EXEC_TIMEOUT_MS: 1000,
    agentTurnStates: new Map(),
    createAsyncQueue: undefined,
    nodeCommand: '/node',
    ...overrides,
  };
  return { ctx, calls, get child() { return child; } };
}

test('zcode resolves Desktop runtime only after standalone CLI and reports dynamic variant', () => {
  const { ctx } = buildMockCtx();
  const spec = createZcodeCliSpec(ctx);
  assert.equal(spec.resolveCommand(), '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs');
  assert.equal(spec.variantForCommand('/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'), 'desktop');

  ctx.commandVersion = () => 'zcode 1.0.0';
  assert.equal(createZcodeCliSpec(ctx).resolveCommand(), 'zcode');
  assert.equal(createZcodeCliSpec(ctx).variantForCommand('zcode'), 'cli');
});

test('zcode exposes both runtime variants and honors an exact Desktop selection', () => {
  const desktop = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
  const { ctx } = buildMockCtx({
    existingFile: (candidate) => candidate === desktop,
    commandVersion: (command) => (command === 'zcode' ? 'zcode 1.0.0' : 'zcode 2.0.0'),
  });
  const spec = createZcodeCliSpec(ctx);

  assert.deepEqual(spec.resolveCommands(), [
    { command: 'zcode', variant: 'cli', version: 'zcode 1.0.0' },
    { command: desktop, variant: 'desktop', version: 'zcode 2.0.0' },
  ]);
  assert.equal(spec.resolveCommand({ runtimeVariant: 'desktop' }), desktop);
});

test('zcode streaming envelopes translate into normalized Agent events', () => {
  const { ctx } = buildMockCtx();
  const spec = createZcodeCliSpec(ctx);

  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: { type: 'model.streaming', payload: { kind: 'text_delta', delta: 'hi' } },
  })), [{ type: EVENT_TYPES.TEXT, content: 'hi' }]);
  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: { type: 'model.streaming', payload: { kind: 'reasoning_delta', delta: 'why' } },
  })), [{ type: EVENT_TYPES.THINKING, content: 'why' }]);
  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: { type: 'turn.completed', payload: { response: 'done', resultType: 'success' } },
  })), [{ type: EVENT_TYPES.TURN_END, result: 'done' }]);
});

test('zcode tool and failure envelopes keep actionable normalized details', () => {
  const { ctx } = buildMockCtx();
  const spec = createZcodeCliSpec(ctx);
  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: {
      type: 'tool.updated',
      payload: { kind: 'scheduled', toolCallId: 'tool-1', toolName: 'shell', input: { cmd: 'pwd' } },
    },
  })), [{ type: EVENT_TYPES.TOOL_USE, tool: 'shell', input: { cmd: 'pwd' }, toolUseID: 'tool-1' }]);
  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: {
      type: 'tool.updated',
      payload: { kind: 'result', toolName: 'shell', result: { output: '/tmp' } },
    },
  })), [{ type: EVENT_TYPES.TOOL_RESULT, tool: 'shell', output: '/tmp', isError: false }]);
  assert.deepEqual(spec.parseStreamEventAll(JSON.stringify({
    method: 'session/event',
    params: { type: 'turn.failed', payload: { error: { message: 'model unavailable' } } },
  })), [
    { type: EVENT_TYPES.ERROR, message: 'model unavailable' },
    { type: EVENT_TYPES.TURN_END, error: 'model unavailable' },
  ]);
});

test('zcode protocol errors and progress payloads redact provider credentials', () => {
  const event = redactEventValue({
    type: EVENT_TYPES.ERROR,
    message: `provider rejected ${SECRET}`,
    detail: { output: `request used ${SECRET}` },
  }, [SECRET]);
  assert.equal(JSON.stringify(event).includes(SECRET), false);
  assert.match(event.message, /\[REDACTED\]/);
});

test('zcode persistent adapter creates, subscribes, sends, and closes without leaking provider secrets', async () => {
  const harness = buildMockCtx();
  const selections = [];
  harness.ctx.resolveCommand = (cliTool, runtimeVariant) => {
    selections.push({ cliTool, runtimeVariant });
    return '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
  };
  const spec = createZcodeCliSpec(harness.ctx);
  const seenEvents = [];
  const runtime = spec.spawnPersistent({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    systemPrompt: 'Be concise',
    taskCtx: { taskId: 'task-1' },
    eventRef: { current: (event) => seenEvents.push(event) },
    runtimeVariant: 'desktop',
  }, harness.ctx);

  const response = await runtime.sendPrompt('hello');
  assert.deepEqual(response, { result: 'hello' });
  const secondResponse = await runtime.sendPrompt('second turn');
  assert.deepEqual(secondResponse, { result: 'hello' });
  assert.equal(runtime.sessionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(selections, [{ cliTool: 'zcode', runtimeVariant: 'desktop' }]);

  const messages = harness.child.stdin.writes.map((line) => JSON.parse(line));
  assert.equal(messages[0].method, 'session/create');
  assert.equal(messages[1].id, 'server-1');
  assert.equal(messages[1].result.nativeSearchEnhancementsEnabled, true);
  assert.equal(messages[2].method, 'session/subscribe');
  assert.ok(messages.some((message) => message.method === 'session/send'));
  assert.equal(messages.filter((message) => message.method === 'session/create').length, 1);
  assert.equal(messages.filter((message) => message.method === 'session/send').length, 2);
  assert.equal(messages.filter((message) => message.method === 'session/send')[1].params.content, 'second turn');
  const create = messages.find((message) => message.method === 'session/create');
  assert.equal(create.params.mode, 'yolo');
  assert.equal(create.params.mcpServers[0].name, 'di-agent-platform');
  assert.equal(create.params.mcpServers[0].isolation, 'session');
  assert.equal(create.params.runtimeModel.provider.apiKey.value, SECRET);
  assert.equal(create.params.mcpServers[0].args.includes('platform-key'), false);
  assert.deepEqual(create.params.mcpServers[0].env, [
    { name: 'DI_AGENT_API_KEY', value: 'platform-key' },
    { name: 'DI_AGENT_DAEMON_TOKEN', value: 'daemon-token' },
  ]);
  assert.equal(JSON.stringify(create.params.mcpServers[0].args).includes('daemon-token'), false);
  assert.equal(JSON.stringify(harness.calls.spawn).includes(SECRET), false);
  assert.equal(JSON.stringify(harness.calls.logs).includes(SECRET), false);
  assert.deepEqual(seenEvents.map((event) => event.type), [
    EVENT_TYPES.THINKING,
    EVENT_TYPES.TEXT,
    EVENT_TYPES.TURN_END,
    EVENT_TYPES.THINKING,
    EVENT_TYPES.TEXT,
    EVENT_TYPES.TURN_END,
  ]);

  harness.child.stderr.emit('data', `provider failed: ${SECRET}`);
  assert.equal(JSON.stringify(harness.calls.logs).includes(SECRET), false);
  await runtime.close();
  assert.ok(harness.child.stdin.writes.map((line) => JSON.parse(line))
    .some((message) => message.method === 'session/close'));
});

test('zcode process errors fail the active turn without leaking provider secrets', async () => {
  const child = fakeChild(() => {});
  const harness = buildMockCtx({ spawn: () => child });
  const runtime = createZcodeCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-error',
    conversationId: 'conv-error',
    userId: 'user-error',
  }, harness.ctx);

  const responsePromise = runtime.sendPrompt('hello');
  queueMicrotask(() => child.emit('error', new Error(`spawn failed: ${SECRET}`)));
  const response = await Promise.race([
    responsePromise,
    new Promise((resolve) => setTimeout(() => resolve({ error: 'test timed out' }), 100)),
  ]);

  assert.match(response.error, /spawn failed/);
  assert.equal(response.error.includes(SECRET), false);
  assert.equal(JSON.stringify(harness.calls.logs).includes(SECRET), false);
});

test('zcode completed event without repeated response falls back to streamed text', async () => {
  const harness = buildMockCtx({
    spawn: () => fakeChild((message, child) => {
      if (message.method === 'session/create') {
        emitLine(child, { id: message.id, result: { sessionId: 'sess-zcode' } });
      } else if (message.method === 'session/subscribe') {
        emitLine(child, { id: message.id, result: { sessionId: 'sess-zcode', eventSeq: 0, events: [] } });
      } else if (message.method === 'session/send') {
        emitLine(child, { id: message.id, result: { accepted: true } });
        emitLine(child, {
          method: 'session/event',
          params: {
            type: 'model.streaming',
            sessionId: 'sess-zcode',
            payload: { kind: 'text_delta', delta: 'streamed answer' },
          },
        });
        emitLine(child, {
          method: 'session/event',
          params: {
            type: 'turn.completed',
            sessionId: 'sess-zcode',
            payload: { resultType: 'success' },
          },
        });
      }
    }),
  });
  const runtime = createZcodeCliSpec(harness.ctx).spawnPersistent({
    agentId: 'agent-fallback',
    conversationId: 'conv-fallback',
    userId: 'user-fallback',
  }, harness.ctx);

  assert.deepEqual(await runtime.sendPrompt('hello'), { result: 'streamed answer' });
});
