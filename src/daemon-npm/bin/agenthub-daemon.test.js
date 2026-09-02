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
  daemonConn,
  ensureAgentHubCodexMcpConfig,
  ensureGitRepoForTask,
  executeTaskOnce,
  ensureOpenCodeMcpConfig,
  onWebSocket,
  installSkillFromDirectory,
  MCP_TOOLS,
  parseGitHubSkillSource,
  resolveAllowedTools,
  resolveAgentTimeoutMs,
  runtimeAgentKey,
  runningAgents,
} = require('./agenthub-daemon.js');

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-skill-install-'));
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
    AGENTHUB_CONVERSATION_ID: 'conv-1',
    AGENTHUB_AGENT_ID: 'agent-1',
    AGENTHUB_TASK_ID: 'task-1',
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

test('commandForTask runs codex with non-interactive MCP-capable execution', () => {
  const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-codex-home-'));
  const originalCodexHome = process.env.AGENTHUB_CODEX_HOME;
  process.env.AGENTHUB_CODEX_HOME = tempCodexHome;
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
    assert.equal(spec.args.includes('--dangerously-bypass-approvals-and-sandbox'), true);
    assert.equal(spec.args.includes('--ephemeral'), true);
    assert.equal(spec.args.includes('--sandbox'), false);
    assert.equal(spec.args.includes('read-only'), false);
    assert.deepEqual(spec.env, {
      CODEX_HOME: tempCodexHome,
      AGENTHUB_CONVERSATION_ID: 'conv-1',
      AGENTHUB_USER_ID: 'user-1',
      AGENTHUB_AGENT_ID: 'agent-1',
      AGENTHUB_TASK_ID: 'codex-task-1',
    });
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.AGENTHUB_CODEX_HOME;
    } else {
      process.env.AGENTHUB_CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(tempCodexHome, { recursive: true, force: true });
  }
});

test('ensureAgentHubCodexMcpConfig writes task context and auto-approved platform tools', () => {
  const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-codex-home-'));
  const original = {
    serverURL: daemonConn.serverURL,
    apiKey: daemonConn.apiKey,
    daemonToken: daemonConn.daemonToken,
  };
  daemonConn.serverURL = 'http://agenthub.test';
  daemonConn.apiKey = 'api-key';
  daemonConn.daemonToken = 'daemon-token';
  try {
    const configFile = ensureAgentHubCodexMcpConfig(
      tempCodexHome,
      'conv-1',
      'user-1',
      'agent-1',
      'task-1',
    );
    const config = fs.readFileSync(configFile, 'utf8');
    assert.match(config, /\[mcp_servers\.agenthub-platform\]/);
    assert.match(config, /--conversation-id", "conv-1"/);
    assert.match(config, /--user-id", "user-1"/);
    assert.match(config, /--agent-id", "agent-1"/);
    assert.match(config, /--task-id", "task-1"/);
    assert.match(config, /default_tools_approval_mode = "approve"/);
  } finally {
    daemonConn.serverURL = original.serverURL;
    daemonConn.apiKey = original.apiKey;
    daemonConn.daemonToken = original.daemonToken;
    fs.rmSync(tempCodexHome, { recursive: true, force: true });
  }
});

test('parseOpenCodeOutput tests removed — superseded by cli/__tests__/opencode.test.js (Switch 7)', () => {
  // parseOpenCodeOutput was deleted from daemon.js; its logic lives in
  // OpenCodeCliSpec.parseResult, fully covered by cli/__tests__/opencode.test.js
  // (text extraction, sessionId extraction, part.updated handling, multi-line stream).
  assert.ok(true);
});

test('ensureOpenCodeMcpConfig preserves existing config and writes AgentHub server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-opencode-config-'));
  const configPath = path.join(tempDir, 'opencode.json');
  const originalConfigPath = process.env.AGENTHUB_OPENCODE_CONFIG;
  process.env.AGENTHUB_OPENCODE_CONFIG = configPath;
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
    assert.deepEqual(config.mcp['agenthub-platform'], {
      type: 'local',
      command: ['node', 'daemon.js', '--mcp'],
      enabled: true,
    });
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.AGENTHUB_OPENCODE_CONFIG;
    } else {
      process.env.AGENTHUB_OPENCODE_CONFIG = originalConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-git-init-'));
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-git-skip-'));
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
