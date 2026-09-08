const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_AGENT_TIMEOUT_MS,
  commandForTask,
  conversationSessions,
  detectCapabilities,
  daemonConn,
  dispatchToPersistentSlot,
  ensureDiAgentCodexMcpConfig,
  updateDiAgentCodexTaskContext,
  ensureGitRepoForTask,
  executeTaskOnce,
  ensureOpenCodeMcpConfig,
  onWebSocket,
  installSkillFromDirectory,
  MCP_TOOLS,
  parseGitHubSkillSource,
  readMcpRuntimeContext,
  resolveAllowedTools,
  resolveAgentTimeoutMs,
  runtimeAgentKey,
  runningAgents,
  scanAgents,
} = require('./di-agent-daemon.js');
const cliTools = require('../cli');

test('daemon scan reports CLI and Desktop variants without duplicating physical paths', () => {
  const originalSpecs = cliTools.allCliTools();
  try {
    cliTools.registerCliTool({
      cliTool: 'desktop-scan-test',
      name: 'Desktop Scan Test',
      defaultCapabilities: [],
      resolveCommands: () => [
        { command: process.execPath, variant: 'cli', version: 'cli 1.0.0' },
        { command: process.execPath, variant: 'desktop', version: 'desktop duplicate' },
        { command: '/bin/sh', variant: 'desktop', version: 'desktop 2.0.0' },
      ],
    });
    const matches = scanAgents().filter((candidate) => candidate.cli_tool === 'desktop-scan-test');
    assert.deepEqual(matches.map(({ variant, version }) => ({ variant, version })), [
      { variant: 'cli', version: 'cli 1.0.0' },
      { variant: 'desktop', version: 'desktop 2.0.0' },
    ]);
  } finally {
    cliTools.clearCliTools();
    for (const spec of originalSpecs) cliTools.registerCliTool(spec);
  }
});

test('daemon advertises runtime controls only when the persistent approval broker is enabled', () => {
  const previous = process.env.DI_AGENT_DAEMON_DISABLE_STREAM_SLOT;
  try {
    delete process.env.DI_AGENT_DAEMON_DISABLE_STREAM_SLOT;
    assert.equal(detectCapabilities().includes('agent_runtime_controls_v1'), true);
    assert.equal(detectCapabilities().includes('agent_runtime_controls_v2'), true);
    process.env.DI_AGENT_DAEMON_DISABLE_STREAM_SLOT = '1';
    assert.equal(detectCapabilities().includes('agent_runtime_controls_v1'), false);
    assert.equal(detectCapabilities().includes('agent_runtime_controls_v2'), false);
  } finally {
    if (previous === undefined) delete process.env.DI_AGENT_DAEMON_DISABLE_STREAM_SLOT;
    else process.env.DI_AGENT_DAEMON_DISABLE_STREAM_SLOT = previous;
  }
});

test('commandForTask asks an adapter for the selected exact runtime variant', () => {
  const originalSpecs = cliTools.allCliTools();
  const selections = [];
  try {
    cliTools.registerCliTool({
      cliTool: 'variant-dispatch-test',
      name: 'Variant Dispatch Test',
      defaultCapabilities: [],
      resolveCommand: ({ runtimeVariant }) => {
        selections.push(runtimeVariant);
        return runtimeVariant === 'desktop' ? '/desktop/runtime' : '/cli/runtime';
      },
      buildCommand: (_task, deps) => ({ command: deps.command, args: [] }),
    });
    const command = commandForTask({
      id: 'task-variant',
      cli_tool: 'variant-dispatch-test',
      runtime_variant: 'desktop',
      prompt: 'hello',
    });

    assert.equal(command.command, '/desktop/runtime');
    assert.deepEqual(selections, ['desktop']);
  } finally {
    cliTools.clearCliTools();
    for (const spec of originalSpecs) cliTools.registerCliTool(spec);
  }
});

test('governed report hooks are built in for existing agents', async () => {
  const names = MCP_TOOLS.map((tool) => tool.name);
  for (const name of ['discover_report_data', 'query_report_data', 'save_personal_report']) {
    assert.equal(names.includes(name), true, `${name} should be registered`);
  }
  const allowed = await resolveAllowedTools({
    agentId: 'agent-1',
    allowedTools: null,
    currentAgent: { id: 'agent-1', tools_config: '{"toolset":"none","allowed_tools":[]}' },
  });
  assert.deepEqual(
    allowed.filter((name) => name.includes('report')),
    ['discover_report_data', 'query_report_data', 'save_personal_report'],
  );
});

test('personal report save requires a real query proof and emits a report card', async () => {
  const queryTool = MCP_TOOLS.find((tool) => tool.name === 'query_report_data');
  const saveTool = MCP_TOOLS.find((tool) => tool.name === 'save_personal_report');
  const calls = [];
  const cards = [];
  const ctx = {
    conversationId: 'conv-1',
    callMcpApi: async (method, pathname, options = {}) => {
      calls.push({ method, pathname, body: options.body });
      if (pathname === '/mcp/report-data/query') {
        return { data: { source_id: 'source-1', source_name: '价敏数据', query_id: 'query-1', source_partition: '2026-08-27', duration_ms: 12, rows: [{ users: 10 }] } };
      }
      if (pathname === '/mcp/personal-reports') {
        return { data: { id: 'report-1', title: options.body.title, description: options.body.description } };
      }
      throw new Error(`unexpected path ${pathname}`);
    },
    emitCard: async (card) => cards.push(card),
  };

  await assert.rejects(
    () => saveTool.run({ title: '报表', data_source_id: 'source-1', query_id: 'missing', document: { sections: [] } }, ctx),
    /必须先在本轮调用 query_report_data/,
  );
  await queryTool.run({ source_id: 'source-1', fields: [{ name: 'duid', aggregation: 'COUNT DISTINCT' }] }, ctx);
  const saved = await saveTool.run({
    title: '价敏用户概览',
    description: '真实查询生成',
    data_source_id: 'source-1',
    query_id: 'query-1',
    document: { sections: [{ id: 'users', type: 'metric', data: { value: 10 } }] },
  }, ctx);

  assert.equal(saved.id, 'report-1');
  assert.equal(calls.at(-1).body.provenance.query_id, 'query-1');
  assert.equal(calls.at(-1).body.conversation_id, 'conv-1');
  assert.deepEqual(cards, [{
    type: 'personal_report',
    id: 'personal-report-report-1',
    report_id: 'report-1',
    title: '价敏用户概览',
    summary: '真实查询生成',
    source_partition: '2026-08-27',
  }]);
});

test('GitHub Skill source accepts only a public HTTPS GitHub repository', () => {
  assert.deepEqual(parseGitHubSkillSource(JSON.stringify({
    source_url: 'https://github.com/mattpocock/skills',
    ref: 'main',
    subpath: 'skills/ask-matt',
  })), {
    sourceURL: 'https://github.com/mattpocock/skills',
    ref: 'main',
    subpath: 'skills/ask-matt',
    cliTool: '',
  });
  assert.throws(() => parseGitHubSkillSource(JSON.stringify({ source_url: 'https://example.com/skill' })), /GitHub/);
  assert.throws(() => parseGitHubSkillSource(JSON.stringify({ source_url: 'https://github.com/a/b', subpath: '../escape' })), /subpath/);
});

test('Skill deployment validates manifest, is atomic, and never overwrites', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-skill-install-'));
  const sourceDir = path.join(tempDir, 'checkout', 'ask-matt');
  const installRoot = path.join(tempDir, 'installed');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: ask-matt\ndescription: Route engineering work\n---\n# Ask Matt\n');
  fs.mkdirSync(path.join(sourceDir, 'scripts'));
  fs.writeFileSync(path.join(sourceDir, 'scripts', 'setup.sh'), 'exit 99\n');
  try {
    const result = installSkillFromDirectory(sourceDir, installRoot);
    assert.equal(result.name, 'ask-matt');
    assert.equal(fs.existsSync(path.join(result.installed_path, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(result.installed_path, 'scripts', 'setup.sh')), true);
    assert.throws(() => installSkillFromDirectory(sourceDir, installRoot), /already exists/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Agent task timeout defaults to 30 minutes and accepts a positive env override', () => {
  assert.equal(DEFAULT_AGENT_TIMEOUT_MS, 1800000);
  assert.equal(resolveAgentTimeoutMs(undefined), 1800000);
  assert.equal(resolveAgentTimeoutMs('2400000'), 2400000);
  assert.equal(resolveAgentTimeoutMs('0'), 1800000);
  assert.equal(resolveAgentTimeoutMs('invalid'), 1800000);
});

test('persistent runtime slots are isolated by conversation', () => {
  runningAgents.clear();
  const firstKey = runtimeAgentKey('agent-1', 'conv-1');
  const secondKey = runtimeAgentKey('agent-1', 'conv-2');
  runningAgents.set(firstKey, { sessionId: 'session-1' });
  runningAgents.set(secondKey, { sessionId: 'session-2' });

  assert.notEqual(firstKey, secondKey);
  assert.equal(runningAgents.get(firstKey).sessionId, 'session-1');
  assert.equal(runningAgents.get(secondKey).sessionId, 'session-2');
});

test('MCP runtime context follows the latest user and task in a shared conversation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-mcp-context-'));
  const contextFile = path.join(tempDir, 'context.json');
  try {
    fs.writeFileSync(contextFile, JSON.stringify({
      conversation_id: 'conversation-1', user_id: 'user-a',
      agent_id: 'agent-1', task_id: 'task-a',
    }));
    assert.deepEqual(readMcpRuntimeContext(contextFile, {}), {
      conversationId: 'conversation-1', userId: 'user-a',
      agentId: 'agent-1', taskId: 'task-a',
    });

    fs.writeFileSync(contextFile, JSON.stringify({
      conversation_id: 'conversation-1', user_id: 'user-b',
      agent_id: 'agent-1', task_id: 'task-b',
    }));
    assert.deepEqual(readMcpRuntimeContext(contextFile, {}), {
      conversationId: 'conversation-1', userId: 'user-b',
      agentId: 'agent-1', taskId: 'task-b',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('persistent slot is rebuilt when the runtime config fingerprint changes', async () => {
  const originalSpecs = cliTools.allCliTools();
  runningAgents.clear();
  let closed = false;
  let spawned = 0;
  const key = runtimeAgentKey('agent-fingerprint', 'conv-fingerprint');
  runningAgents.set(key, {
    agentId: 'agent-fingerprint',
    process: { pid: 12, exitCode: null },
    currentConversationId: 'conv-fingerprint',
    runtimeVariant: 'cli',
    runtimeConfigFingerprint: 'old',
    sendPrompt: async () => ({ result: 'old-result' }),
    close: () => { closed = true; },
  });
  try {
    cliTools.registerCliTool({
      cliTool: 'fingerprint-test',
      name: 'Fingerprint Test',
      defaultCapabilities: [],
      runtimeConfigFingerprint: (value) => JSON.stringify(value),
      spawnPersistent: () => {
        spawned += 1;
        const child = new EventEmitter();
        child.pid = 13;
        child.exitCode = null;
        return {
          child,
          sessionId: '33333333-3333-4333-8333-333333333333',
          sendPrompt: async () => ({ result: 'new-result' }),
          close: () => {},
        };
      },
    });
    const result = await dispatchToPersistentSlot(
      null, 'agent-fingerprint', 'conv-fingerprint', 'user-1', 'hello', '',
      { taskId: 'task-1' }, 'fingerprint-test', null, false, 'cli', { version: 1 },
    );
    assert.equal(result, 'new-result');
    assert.equal(closed, true);
    assert.equal(spawned, 1);
  } finally {
    runningAgents.clear();
    conversationSessions.delete('agent-fingerprint:conv-fingerprint');
    cliTools.clearCliTools();
    for (const spec of originalSpecs) cliTools.registerCliTool(spec);
  }
});

test('persistent slot serializes concurrent turns and keeps stream callbacks task-local', async () => {
  const originalSpecs = cliTools.allCliTools();
  runningAgents.clear();
  const prompts = [];
  const pending = [];
  try {
    cliTools.registerCliTool({
      cliTool: 'serialized-slot-test',
      name: 'Serialized Slot Test',
      defaultCapabilities: [],
      runtimeConfigFingerprint: () => 'same',
      spawnPersistent: ({ eventRef }) => {
        const child = new EventEmitter();
        child.pid = 14;
        child.exitCode = null;
        return {
          child,
          sessionId: '44444444-4444-4444-8444-444444444444',
          sendPrompt: (prompt) => new Promise((resolve) => {
            prompts.push(prompt);
            eventRef.current?.({ kind: 'text', text: prompt });
            pending.push(() => resolve({ result: `${prompt}-done` }));
          }),
          close: () => {},
        };
      },
    });
    const firstEvents = [];
    const secondEvents = [];
    const first = dispatchToPersistentSlot(
      null, 'agent-serialized', 'conv-serialized', 'user-1', 'first', '',
      { taskId: 'task-first' }, 'serialized-slot-test', (event) => firstEvents.push(event),
      false, 'cli', { version: 1 },
    );
    const second = dispatchToPersistentSlot(
      null, 'agent-serialized', 'conv-serialized', 'user-2', 'second', '',
      { taskId: 'task-second' }, 'serialized-slot-test', (event) => secondEvents.push(event),
      false, 'cli', { version: 1 },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(prompts, ['first']);
    pending.shift()();
    assert.equal(await first, 'first-done');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(prompts, ['first', 'second']);
    pending.shift()();
    assert.equal(await second, 'second-done');
    assert.deepEqual(firstEvents.map((event) => event.text), ['first']);
    assert.deepEqual(secondEvents.map((event) => event.text), ['second']);
  } finally {
    runningAgents.clear();
    conversationSessions.delete('agent-serialized:conv-serialized');
    cliTools.clearCliTools();
    for (const spec of originalSpecs) cliTools.registerCliTool(spec);
  }
});

test('commandForTask still reuses a legacy prewarmed Claude slot', () => {
  runningAgents.clear();
  runningAgents.set('agent-legacy', { sessionId: 'legacy-session' });

  const spec = commandForTask({
    id: 'task-legacy',
    cli_tool: 'claude',
    agent_id: 'agent-legacy',
    conversation_id: 'conv-1',
    prompt: 'hello',
  });

  assert.equal(spec.sessionId, 'legacy-session');
  assert.equal(spec.args.includes('--dangerously-skip-permissions'), true);
  runningAgents.clear();
});

test('onWebSocket supports ws EventEmitter clients', () => {
  const ws = new EventEmitter();
  let called = false;

  onWebSocket(ws, 'open', () => {
    called = true;
  });
  ws.emit('open');

  assert.equal(called, true);
});

test('onWebSocket adapts WHATWG message events', () => {
  const listeners = new Map();
  const ws = {
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
  };
  let message = '';

  onWebSocket(ws, 'message', (data) => {
    message = data;
  });
  listeners.get('message')({ data: '{"type":"ping"}' });

  assert.equal(message, '{"type":"ping"}');
});

test('onWebSocket adapts WHATWG close events', () => {
  const listeners = new Map();
  const ws = {
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
  };
  let closeCode = 0;
  let closeReason = '';

  onWebSocket(ws, 'close', (code, reason) => {
    closeCode = code;
    closeReason = reason;
  });
  listeners.get('close')({ code: 1006, reason: 'network' });

  assert.equal(closeCode, 1006);
  assert.equal(closeReason, 'network');
});

test('commandForTask runs opencode with conversation session when available', () => {
  conversationSessions.clear();
  conversationSessions.set('agent-1:conv-1', 'session-1');

  const spec = commandForTask({
    id: 'task-1',
    cli_tool: 'opencode',
    agent_id: 'agent-1',
    conversation_id: 'conv-1',
    prompt: 'hello',
    tools_config: '{"allowed_tools":["create_agent"]}',
    context_messages: '[系统指令]\nBe concise.',
  });

  assert.match(path.basename(spec.command).toLowerCase(), /^opencode(?:\.exe)?$/);
  assert.equal(spec.resultFormat, 'opencode-json');
  assert.equal(spec.persistSessionKey, 'agent-1:conv-1');
  assert.deepEqual(spec.env, {
    DI_AGENT_CONVERSATION_ID: 'conv-1',
    DI_AGENT_AGENT_ID: 'agent-1',
    DI_AGENT_TASK_ID: 'task-1',
  });
  assert.deepEqual(spec.args.slice(0, 7), [
    'run',
    '--format',
    'json',
    '--no-replay',
    '--dangerously-skip-permissions',
    '--session',
    'session-1',
  ]);
  assert.equal(spec.args.includes('--fork'), true);
  assert.match(spec.args.at(-1), /Be concise/);
  assert.match(spec.args.at(-1), /hello/);
});

test('commandForTask starts opencode without session on first conversation turn', () => {
  conversationSessions.clear();

  const spec = commandForTask({
    id: 'task-1',
    cli_tool: 'opencode',
    agent_id: 'agent-1',
    conversation_id: 'conv-1',
    prompt: 'hello',
  });

  assert.equal(spec.persistSessionKey, 'agent-1:conv-1');
  assert.equal(spec.args.includes('--session'), false);
});

test('commandForTask runs codex with safe non-interactive MCP-capable execution', () => {
  const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-codex-home-'));
  const originalCodexHome = process.env.DI_AGENT_CODEX_HOME;
  process.env.DI_AGENT_CODEX_HOME = tempCodexHome;
  try {
    const spec = commandForTask({
      id: 'codex-task-1',
      cli_tool: 'codex',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      prompt: 'create an agent',
    });

    assert.equal(spec.args[0], 'exec');
    assert.equal(spec.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
    assert.equal(spec.args.includes('--ephemeral'), true);
    assert.equal(spec.args.includes('--sandbox'), true);
    assert.equal(spec.args.includes('workspace-write'), true);
    assert.equal(spec.args.includes('approval_policy="never"'), true);
    assert.equal(spec.args.includes('model_reasoning_effort="medium"'), true);
    assert.equal(spec.env.CODEX_HOME, tempCodexHome);
    assert.equal(spec.env.DI_AGENT_CONVERSATION_ID, 'conv-1');
    assert.equal(spec.env.DI_AGENT_USER_ID, 'user-1');
    assert.equal(spec.env.DI_AGENT_AGENT_ID, 'agent-1');
    assert.equal(spec.env.DI_AGENT_TASK_ID, 'codex-task-1');
    const proxyValues = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']
      .map((key) => spec.env[key])
      .filter(Boolean);
    if (proxyValues.length > 0) {
      assert.equal(proxyValues.length, 4);
      assert.equal(new Set(proxyValues).size, 1);
    }
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.DI_AGENT_CODEX_HOME;
    } else {
      process.env.DI_AGENT_CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(tempCodexHome, { recursive: true, force: true });
  }
});

test('daemon rejects unsupported runtime policy instead of changing its meaning', async () => {
  assert.throws(() => commandForTask({
    id: 'codex-invalid-runtime', cli_tool: 'codex', prompt: 'hello',
    runtime_config: { version: 9, model: '', reasoning_effort: 'medium', approval_mode: 'auto' },
  }), /unsupported version/);
  await assert.rejects(() => executeTaskOnce({
    id: 'claude-invalid-runtime', cli_tool: 'claude', prompt: 'hello',
    runtime_config: { version: 1, model: 'gpt-5.6-sol', reasoning_effort: 'high', approval_mode: 'full' },
  }), /does not support runtime_config/);
});

test('ensureDiAgentCodexMcpConfig writes task context and auto-approved platform tools', () => {
  const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-codex-home-'));
  const original = {
    serverURL: daemonConn.serverURL,
    apiKey: daemonConn.apiKey,
    daemonToken: daemonConn.daemonToken,
  };
  daemonConn.serverURL = 'http://di-agent.test';
  daemonConn.apiKey = 'api-key';
  daemonConn.daemonToken = 'daemon-token';
  try {
    const configFile = ensureDiAgentCodexMcpConfig(
      tempCodexHome,
      'conv-1',
      'user-1',
      'agent-1',
      'task-1',
    );
    const config = fs.readFileSync(configFile, 'utf8');
    assert.match(config, /\[mcp_servers\.di-agent-platform\]/);
    assert.match(config, /--conversation-id", "conv-1"/);
    assert.match(config, /--user-id", "user-1"/);
    assert.match(config, /--agent-id", "agent-1"/);
    assert.match(config, /--task-id", "task-1"/);
    assert.match(config, /--task-context-file"/);
    assert.match(config, /default_tools_approval_mode = "approve"/);

    const contextFile = updateDiAgentCodexTaskContext(tempCodexHome, 'conv-1', 'user-1', 'agent-1', 'task-2');
    assert.equal(JSON.parse(fs.readFileSync(contextFile, 'utf8')).task_id, 'task-2');
  } finally {
    daemonConn.serverURL = original.serverURL;
    daemonConn.apiKey = original.apiKey;
    daemonConn.daemonToken = original.daemonToken;
    fs.rmSync(tempCodexHome, { recursive: true, force: true });
  }
});

test('ensureDiAgentCodexMcpConfig removes the retired MCP section during upgrade', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-codex-mcp-migration-'));
  const original = { ...daemonConn };
  daemonConn.serverURL = 'http://di-agent.test';
  daemonConn.apiKey = 'api-key';
  try {
    const configFile = path.join(tempRoot, 'config.toml');
    fs.writeFileSync(configFile, '[mcp_servers.agenthub-platform]\ncommand = "old"\n\n[notice]\nhide = true\n'); // [brand-compat]
    ensureDiAgentCodexMcpConfig(tempRoot, 'conv-1', 'user-1', 'agent-1', 'task-1');
    const config = fs.readFileSync(configFile, 'utf8');
    assert.doesNotMatch(config, /mcp_servers\.agenthub-platform/); // [brand-compat]
    assert.match(config, /\[mcp_servers\.di-agent-platform\]/);
    assert.match(config, /\[notice\]/);
  } finally {
    Object.assign(daemonConn, original);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('parseOpenCodeOutput tests removed — superseded by cli/__tests__/opencode.test.js (Switch 7)', () => {
  // parseOpenCodeOutput was deleted from daemon.js; its logic lives in
  // OpenCodeCliSpec.parseResult, fully covered by cli/__tests__/opencode.test.js
  // (text extraction, sessionId extraction, part.updated handling, multi-line stream).
  assert.ok(true);
});

test('ensureOpenCodeMcpConfig preserves existing config and writes Di Agent server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-opencode-config-'));
  const configPath = path.join(tempDir, 'opencode.json');
  const originalConfigPath = process.env.DI_AGENT_OPENCODE_CONFIG;
  process.env.DI_AGENT_OPENCODE_CONFIG = configPath;
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: 'provider/model',
      provider: { example: { options: { apiKey: 'secret' } } },
    }, null, 2));

    const writtenPath = ensureOpenCodeMcpConfig(['node', 'daemon.js', '--mcp']);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.equal(writtenPath, configPath);
    assert.equal(config.model, 'provider/model');
    assert.equal(config.provider.example.options.apiKey, 'secret');
    assert.deepEqual(config.mcp['di-agent-platform'], {
      type: 'local',
      command: ['node', 'daemon.js', '--mcp'],
      enabled: true,
    });
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.DI_AGENT_OPENCODE_CONFIG;
    } else {
      process.env.DI_AGENT_OPENCODE_CONFIG = originalConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ensureOpenCodeMcpConfig removes the retired MCP server during upgrade', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-opencode-migration-'));
  const previous = process.env.DI_AGENT_OPENCODE_CONFIG;
  try {
    const configPath = path.join(tempRoot, 'opencode.json');
    process.env.DI_AGENT_OPENCODE_CONFIG = configPath;
    fs.writeFileSync(configPath, JSON.stringify({
      mcp: {
        'agenthub-platform': { type: 'local', command: ['node', 'old.js'] }, // [brand-compat]
        keep: { type: 'remote', url: 'https://example.test' },
      },
    }));
    ensureOpenCodeMcpConfig(['node', 'daemon.js', '--mcp']);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(Object.hasOwn(config.mcp, 'agenthub-platform'), false); // [brand-compat]
    assert.ok(config.mcp['di-agent-platform']);
    assert.ok(config.mcp.keep);
  } finally {
    if (previous === undefined) delete process.env.DI_AGENT_OPENCODE_CONFIG;
    else process.env.DI_AGENT_OPENCODE_CONFIG = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('executeTaskOnce ignores duplicate completed task ids', async () => {
  const task = {
    id: 'duplicate-task-1',
    cli_tool: 'echo',
    prompt: 'hello',
  };

  assert.equal(typeof await executeTaskOnce(task), 'string');
  assert.equal(await executeTaskOnce(task), null);
});

test('ensureGitRepoForTask auto-inits non-git workdir with baseline commit', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-git-init-'));
  try {
    // 写一个文件，模拟 agent 修改前的 workdir 内容
    fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'hello\n');
    // 确认还不是 git 仓库
    assert.throws(() => execFileSync('git', ['-C', tempDir, 'rev-parse', '--git-dir'], { encoding: 'utf8' }));

    ensureGitRepoForTask(tempDir, { task_id: 't-init', cli_tool: 'claude' });

    // 现在应该是 git 仓库，且有 baseline commit
    const gitDir = execFileSync('git', ['-C', tempDir, 'rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
    assert.ok(gitDir, 'git rev-parse --git-dir should succeed after init');
    const log = execFileSync('git', ['-C', tempDir, 'log', '--oneline'], { encoding: 'utf8' }).trim();
    assert.match(log, /baseline \(auto\)/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ensureGitRepoForTask is no-op on existing git repo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-git-skip-'));
  try {
    execFileSync('git', ['-C', tempDir, 'init'], { encoding: 'utf8' });
    execFileSync('git', ['-C', tempDir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
    execFileSync('git', ['-C', tempDir, 'config', 'user.name', 'Test'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'a\n');
    execFileSync('git', ['-C', tempDir, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', tempDir, 'commit', '-m', 'manual'], { encoding: 'utf8' });

    ensureGitRepoForTask(tempDir, { task_id: 't-skip' });

    const log = execFileSync('git', ['-C', tempDir, 'log', '--oneline'], { encoding: 'utf8' }).trim();
    // 不应有 baseline (auto) 提交
    assert.doesNotMatch(log, /baseline \(auto\)/);
    assert.match(log, /manual/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('local skill catalog excludes bodies and loader reads complete local skill by indexed name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-skill-metadata-'));
  const specName = 'local-skill-fixture';
  const file = path.join(dir, 'SKILL.md');
  const secret = 'LOCAL PRIVATE BODY '.repeat(90);
  fs.writeFileSync(file, `---\nname: local-fixture\ndescription: Review local changes with focused checks\n---\n${secret}`);
  cliTools.registerCliTool({ cliTool: specName, skillRoots: () => [dir] });
  try {
    const { scanSkills } = require('./di-agent-daemon');
    const catalog = scanSkills(specName);
    assert.equal(catalog.length, 1);
    assert.ok(catalog[0].usage.includes('get_agent_skill'));
    assert.ok(!JSON.stringify(catalog).includes('LOCAL PRIVATE BODY'));
    const loader = MCP_TOOLS.find(t => t.name === 'get_agent_skill');
    const ctx = { agentId: 'fixture', currentAgent: { id: 'fixture', cli_tool: specName, custom_skills: '[]' } };
    const result = await loader.run({ name: 'local-fixture' }, ctx);
    assert.ok(result.detail.endsWith(secret));
    await assert.rejects(loader.run({ name: file }, ctx), /skill not found/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Codex local and enabled plugin skills keep distinct names and load exact namespaced bodies', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-plugin-namespace-'));
  const previous = process.env.DI_AGENT_CODEX_HOME;
  process.env.DI_AGENT_CODEX_HOME = home;
  try {
    const local = path.join(home, 'skills/shared');
    const plugin = path.join(home, 'plugins/cache/market/writer/1');
    fs.mkdirSync(local, { recursive: true });
    fs.mkdirSync(path.join(plugin, '.codex-plugin'), { recursive: true });
    fs.mkdirSync(path.join(plugin, 'skills/shared'), { recursive: true });
    fs.writeFileSync(path.join(local, 'SKILL.md'), '---\nname: shared\ndescription: Local review instructions\n---\nLOCAL CONTENT');
    fs.writeFileSync(path.join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({name:'writer',version:'1',skills:'./skills'}));
    fs.writeFileSync(path.join(plugin, 'skills/shared/SKILL.md'), '---\nname: shared\ndescription: Plugin review instructions\n---\nPLUGIN CONTENT');
    fs.writeFileSync(path.join(home, 'config.toml'), '[plugins."writer@market"]\nenabled = true\n');
    const catalog = require('./di-agent-daemon').scanSkills('codex');
    assert.ok(catalog.some(s => s.name === 'shared'));
    assert.ok(catalog.some(s => s.name === 'writer:shared'));
    assert.ok(!JSON.stringify(catalog).includes('PLUGIN CONTENT'));
    const result = await MCP_TOOLS.find(t => t.name === 'get_agent_skill').run({name:'writer:shared'}, {agentId:'fixture', currentAgent:{id:'fixture',cli_tool:'codex'}});
    assert.ok(result.detail.endsWith('PLUGIN CONTENT'));
  } finally {
    if (previous === undefined) delete process.env.DI_AGENT_CODEX_HOME; else process.env.DI_AGENT_CODEX_HOME = previous;
    fs.rmSync(home, {recursive:true,force:true});
  }
});
test('native CLI failure does not upload raw stdout/stderr containing skill bodies', async () => {
 const {runProcess} = require('./di-agent-daemon');
 await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("PRIVATE BODY"); process.stderr.write("PRIVATE STDERR"); process.exit(1)'], '', undefined, undefined, undefined, {cli_tool:'codex'}), error => {
  assert.match(error.message, /CLI exited with code 1/);
  assert.ok(!error.message.includes('PRIVATE'));
  return true;
 });
});
