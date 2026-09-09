'use strict';
const { createCodexUsageMeter, codexExecUsage, usageEvent } = require('./token-usage');
const { codexToolEvents } = require('./codex-tool-events');

// CodexCliSpec: OpenAI Codex CLI 的 spec 实现。
// 对应：
// - commandForTask codex 分支（约 :987-1022）：args / CODEX_HOME / outputFile / cwd
// - registerCodexMcp（约 :272-287）：启动期全局 MCP 注册
// - skillRoots codex 分支（约 :648-650）：cwd .agents/skills + home .codex/skills
// - scanAgents 中 `if (candidate.cli_tool === 'codex' && !isCodexAuthenticated(...))` 特殊化
//
// 行为等价要点：
// - codexMcpFallback 文本拼接顺序：fallback + (systemPrompt ? `[系统指令]\n${sp}\n\n` : '') + userPrompt
// - execArgs 顺序：--skip-git-repo-check → --dangerously-bypass-approvals-and-sandbox → --ephemeral → --json → --color never → --output-last-message <file>
// - 最终 args: ['exec', ...execArgs, effectivePrompt]
// - env: { CODEX_HOME, ...DI_AGENT_* context env, ...代理 env }
//
// === 流式（exec --json）与代理加速 ===
// - --json 让 codex 以 NDJSON 事件流输出（thread/turn/item/turn.completed），
//   parseStreamEvent 解析为统一 AgentEvent：agent_message→text、reasoning→thinking、
//   command_execution/function_call→tool_use+tool_result、error item→error。
//   0.145 无 token 级增量，但消息在产生时即推送（早于进程退出），后续版本
//   出现 delta 事件时只需在 parseStreamEvent 里补分支。
// - 代理：codex 每次任务先尝试 wss://chatgpt.com（长连接通道），公司网络下
//   连接黑洞导致 5 次超时重试（实测一次简单任务 14 分钟）。走本地代理后
//   13 秒完成。proxyEnv() 优先 DI_AGENT_CODEX_PROXY / DI_AGENT_PROXY /
//   HTTPS_PROXY，否则懒探测常见本地代理端口（Clash 7897/7890、1087）并缓存。

const { execSync } = require('child_process');
const {
  textEvent,
  thinkingEvent,
  errorEvent,
  turnEndEvent,
  sessionEndEvent,
  createAsyncQueue,
} = require('./events');
const { readDiAgentEnvironment } = require('./environment');
const { resolveRuntimeCandidates, resolveRuntimeCandidate, runtimeVariant } = require('./runtime');

const LOCAL_PROXY_PORTS = [7897, 7890, 1087];
const CODEX_MODELS = new Set([
  '', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
]);
const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const APPROVAL_MODES = new Set(['request', 'auto', 'full']);
const SERVICE_TIERS = new Set(['default', 'priority']);
const PRIORITY_UNSUPPORTED_MODELS = new Set(['gpt-5.4-mini', 'gpt-5.3-codex-spark']);
let cachedLocalProxy = undefined; // undefined=未探测 null=无 string=代理地址

const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  version: 2,
  model: '',
  reasoning_effort: 'medium',
  approval_mode: 'auto',
  service_tier: 'default',
});

function normalizeRuntimeConfig(value) {
  if (value === undefined || value === null) {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Codex runtime config: expected an object');
  }
  const input = value;
  if (Object.keys(input).length === 0) {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
  if (input.version !== 1 && input.version !== 2) {
    throw new Error('Invalid Codex runtime config: unsupported version');
  }
  if (input.version === 1 && input.service_tier) {
    throw new Error('Invalid Codex runtime config: service tier requires version 2');
  }
  if (!CODEX_MODELS.has(input.model)) {
    throw new Error('Invalid Codex runtime config: unsupported model');
  }
  if (!REASONING_EFFORTS.has(input.reasoning_effort)) {
    throw new Error('Invalid Codex runtime config: unsupported reasoning effort');
  }
  if (!APPROVAL_MODES.has(input.approval_mode)) {
    throw new Error('Invalid Codex runtime config: unsupported approval mode');
  }
  const serviceTier = input.version === 1 ? 'default' : input.service_tier;
  if (!SERVICE_TIERS.has(serviceTier)) {
    throw new Error('Invalid Codex runtime config: unsupported service tier');
  }
  if (serviceTier === 'priority' && PRIORITY_UNSUPPORTED_MODELS.has(input.model)) {
    throw new Error('Invalid Codex runtime config: model does not support priority service tier');
  }
  return {
    version: 2,
    model: input.model,
    reasoning_effort: input.reasoning_effort,
    approval_mode: input.approval_mode,
    service_tier: serviceTier,
  };
}

function runtimeConfigFingerprint(value) {
  const config = normalizeRuntimeConfig(value);
  return JSON.stringify(config);
}

function codexTurnControls(value) {
  const config = normalizeRuntimeConfig(value);
  const params = {};
  if (config.model) params.model = config.model;
  params.effort = config.reasoning_effort;
  params.serviceTier = config.service_tier === 'priority' ? 'priority' : null;
  if (config.approval_mode === 'full') {
    params.approvalPolicy = 'never';
    params.sandboxPolicy = { type: 'dangerFullAccess' };
  } else {
    params.approvalPolicy = config.approval_mode === 'request' ? 'untrusted' : 'on-request';
    params.approvalsReviewer = config.approval_mode === 'request' ? 'user' : 'auto_review';
    params.sandboxPolicy = {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: false,
      excludeSlashTmp: false,
      excludeTmpdirEnvVar: false,
    };
  }
  return { config, params };
}

function detectLocalProxy() {
  const explicit = readDiAgentEnvironment(process.env, 'CODEX_PROXY')
    || readDiAgentEnvironment(process.env, 'PROXY')
    || process.env.HTTPS_PROXY
    || process.env.https_proxy;
  if (explicit) return explicit;
  if (cachedLocalProxy !== undefined) return cachedLocalProxy;
  cachedLocalProxy = null;
  for (const port of LOCAL_PROXY_PORTS) {
    try {
      execSync(`nc -z -G 1 127.0.0.1 ${port}`, { stdio: 'ignore', timeout: 2000 });
      cachedLocalProxy = `http://127.0.0.1:${port}`;
      break;
    } catch { /* 端口不通，继续 */ }
  }
  return cachedLocalProxy;
}

function proxyEnv() {
  const proxy = detectLocalProxy();
  if (!proxy) return {};
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy };
}

const CODEX_MCP_FALLBACK = [
  '[Codex MCP 适配]',
  '你正在执行 Di Agent 平台派发的聊天任务，不是在当前文件夹内做代码开发或项目诊断。',
  '不要读取或遵循当前工作目录的 AGENTS.md/项目说明来改写用户意图；只把下面的 Di Agent prompt 当作任务来源。',
  '如果用户要求创建、更新、删除、查询、启动或停止 Di Agent 平台对象，请使用 di-agent-platform MCP 工具完成真实操作。',
  '如果 di-agent-platform MCP 工具不可用，请明确说明不可用的具体工具名和原因，不要声称只有临时子代理工具。',
  '本次任务的 Di Agent 上下文已经包含在 prompt 中，请直接基于这些上下文继续完成任务。',
  '',
].join('\n');

function createCodexCliSpec(ctx) {
  const desktopPaths = () => [
    ...ctx.codexLocalInstallPaths(),
    ctx.codexExtensionPath(),
    ...(typeof ctx.codexDesktopRuntimePaths === 'function' ? ctx.codexDesktopRuntimePaths() : []),
  ].filter(Boolean);
  const resolveCommands = () => resolveRuntimeCandidates({
    override: readDiAgentEnvironment(process.env, 'CODEX_COMMAND'),
    cliCommand: 'codex',
    desktopPaths: desktopPaths(),
    existingFile: ctx.existingFile,
    commandVersion: ctx.commandVersion,
    canonicalCommand: ctx.canonicalCommand,
  });
  return {
    cliTool: 'codex',
    name: 'Codex',
    defaultCapabilities: ctx.defaultSkills(['coding', 'review']),

    runtimeConfigFingerprint,

    // buildCommand 等价于原 commandForTask codex 分支。
    buildCommand(task, deps) {
      const { command, systemPrompt, userPrompt } = deps;
      const codexHome = ctx.ensureDiAgentCodexHome();
      const taskId = deps.taskId || task.id || null;
      ctx.ensureDiAgentCodexMcpConfig(codexHome, task.conversation_id, task.user_id, task.agent_id, taskId);
      const outputFile = ctx.pathJoin(ctx.tmpdir(), `di-agent-task-${task.id}.txt`);
      const effectivePrompt = systemPrompt
        ? `${CODEX_MCP_FALLBACK}[系统指令]\n${systemPrompt}\n\n${userPrompt}`
        : `${CODEX_MCP_FALLBACK}${userPrompt}`;
      const runtime = normalizeRuntimeConfig(task.runtime_config);
      const accessArgs = runtime.approval_mode === 'full'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', 'workspace-write', '-c', `approval_policy=${runtime.approval_mode === 'request' ? '"untrusted"' : '"never"'}`];
      const modelArgs = runtime.model ? ['--model', runtime.model] : [];
      const serviceTierArgs = runtime.service_tier === 'priority'
        ? ['-c', 'service_tier="priority"']
        : [];
      const execArgs = [
        '--skip-git-repo-check',
        ...accessArgs,
        ...modelArgs,
        '-c', `model_reasoning_effort="${runtime.reasoning_effort}"`,
        ...serviceTierArgs,
        '--ephemeral',
        '--json',
        '--color',
        'never',
        '--output-last-message',
        outputFile,
      ];
      return {
        command,
        args: ['exec', ...execArgs, effectivePrompt],
        outputFile,
        cwd: ctx.ensureTaskWorkdir(task),
        env: {
          CODEX_HOME: codexHome,
          ...proxyEnv(),
          ...ctx.buildDiAgentContextEnv(task.conversation_id, task.user_id, task.agent_id, taskId),
        },
      };
    },

    // ensureMcp 对应原 registerCodexMcp（启动期幂等注册全局 MCP）。
    // mcpArgs 已包含 daemonConn.daemonToken（由 ensureGlobalMcpConfigs 拼装）。
    ensureMcp(mcpArgs) {
      const command = ctx.resolveCommand('codex');
      if (ctx.commandVersion(command) === null) return;
      // 幂等：先移除旧条目（忽略不存在的报错），再新增。
      for (const serverName of ['agenthub-platform', 'di-agent-platform']) { // [brand-compat]
        const remove = ctx.processSpec(command, ['mcp', 'remove', serverName]);
        ctx.spawnSync(remove.command, remove.args, { timeout: 15000, windowsHide: true, stdio: 'ignore' });
      }
      const add = ctx.processSpec(command, ['mcp', 'add', 'di-agent-platform', '--', 'node', ...mcpArgs]);
      const result = ctx.spawnSync(add.command, add.args, {
        encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status === 0) {
        ctx.logFlow('info', 'mcp_config.codex_configured', { server: 'di-agent-platform' });
      } else {
        ctx.logFlow('warn', 'mcp_config.codex_failed', { error: ctx.firstLine(result.stderr || result.stdout) });
      }
    },

    skillRoots(cwd, home) {
      const roots = [];
      const includeProjectRoots = !ctx.isDiAgentWorkspace(cwd);
      if (includeProjectRoots) ctx.addRoot(roots, ctx.pathJoin(cwd, '.agents', 'skills'));
      const configured = readDiAgentEnvironment(process.env, 'CODEX_HOME') || process.env.CODEX_HOME;
      if (configured) ctx.addRoot(roots, ctx.pathJoin(configured, 'skills'));
      else if (home) ctx.addRoot(roots, ctx.pathJoin(home, '.codex', 'skills'));
      return roots;
    },

    installSkillRoot(home) {
      return ctx.pathJoin(home, '.codex', 'skills');
    },

    // isAuthenticated 对应原 isCodexAuthenticated / codexLoginStatus 特殊化。
    // 在 scanAgents 中，codex 需登录态才被视为可用 agent。
    isAuthenticated(command) {
      const status = ctx.codexLoginStatus(command);
      return status !== null && /\blogged in\b/i.test(status);
    },

    // scanAgents 中 codex 分支额外打印一行 resolve 结果（保留原行为）。
    onResolvedCommand(command) {
      console.log(`Codex command resolved: ${command}`);
    },

    // === Step 2 扩展（agent-adapter 重构） ===

    // resolveCommand：把 daemon.js 中 resolveCodexCommand 的多路径 fallback 搬进来。
    // 依赖 ctx 暴露的 existingFile / codexLocalInstallPaths / codexExtensionPath /
    // commandVersion 辅助函数（由 initCliToolsCtx 注入）。
    // 等价原行为：
    //   - DI_AGENT_CODEX_COMMAND 环境变量优先
    //   - 本地安装路径（codexLocalInstallPaths）
    //   - Windows VSCode 扩展路径
    //   - 'codex' 字面量兜底
    resolveCommands,

    resolveCommand(taskOrCtx = {}) {
      const requestedVariant = taskOrCtx && taskOrCtx.runtimeVariant;
      const candidates = resolveCommands();
      if (requestedVariant === 'cli' || requestedVariant === 'desktop') {
        const selected = candidates.find((candidate) => candidate.variant === requestedVariant);
        if (!selected) {
          const label = requestedVariant === 'desktop' ? 'Desktop' : 'CLI';
          throw new Error(`Codex ${label} runtime is not available on this computer. Reconnect the computer to rescan installed runtimes.`);
        }
        return selected.command;
      }
      if (candidates.length > 0) return candidates[0].command;
      return resolveRuntimeCandidate({
        override: readDiAgentEnvironment(process.env, 'CODEX_COMMAND'),
        cliCommand: 'codex',
        desktopPaths: desktopPaths(),
        existingFile: ctx.existingFile,
        commandVersion: ctx.commandVersion,
      }).command;
    },

    variantForCommand(command) {
      return runtimeVariant(command, desktopPaths());
    },

    // parseResult：codex 优先读 outputFile（--output-last-message 已经把 last message
    // 写入文件）。缺少文件时仅提取已完成的 assistant 消息，禁止回传原始工具日志。
    parseResult({ stdout, stderr, outputFile } = {}, _daemonCtx) {
      if (outputFile && ctx.fs.existsSync(outputFile)) {
        const text = ctx.fs.readFileSync(outputFile, 'utf8').trim();
        ctx.fs.rmSync(outputFile, { force: true });
        if (text) return text;
      }
      let finalText = '';
      for (const line of String(stdout || '').split(/\r?\n/)) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') finalText = event.item.text;
        if (event?.type === 'turn.completed' && typeof event.result === 'string') finalText = event.result;
      }
      return finalText.trim() || '(Agent CLI 没有返回内容)';
    },

    // parseStreamEvent：解析 codex exec --json 的 NDJSON 事件行（0.145 格式）。
    //   thread.started / turn.started —— 忽略（无展示价值）
    //   顶层 {"type":"error","message":"Reconnecting..."} —— 瞬态重试提示，忽略
    //   item.completed:
    //     agent_message → text（消息产生即推送，早于进程退出）
    //     reasoning     → thinking（模型思考摘要；0.145 常不输出，出现即兼容）
    //     command_execution / function_call / mcp_tool_call → tool_use + tool_result
    //     error         → error（真正的执行错误）
    //   turn.completed → turn_end（结果取本 turn 累积的 agent_message 文本）
    // ------------------------------------------------------------------
    // spawnPersistent：codex app-server 持久会话（JSON-RPC over stdio，NDJSON 行）。
    //
    // 协议（0.145 实测）：
    //   initialize {clientInfo} → ok
    //   thread/start {cwd} → result.thread.id
    //   turn/start {threadId, cwd, input:[{type:'text',text}]} → result.turn.id（异步执行）
    // 通知：
    //   item/agentMessage/delta {delta} —— token 级文本流（真流式）
    //   item/started|item/completed {item:{type:'reasoning'|'agentMessage'|'commandExecution'...}}
    //   turn/completed {threadId, turn}
    //
    // 同一 thread 上的多次 turn/start 天然共享上下文（持久会话）；
    // 契约与 ClaudeCliSpec.spawnPersistent 一致：{child, sessionId, sendPrompt, events}。
    // ------------------------------------------------------------------
    spawnPersistent({
      agentId,
      systemPrompt,
      conversationId,
      userId,
      taskCtx,
      eventRef,
      runtimeVariant,
    } = {}, daemonCtx = ctx) {
      const command = daemonCtx.resolveCommand('codex', runtimeVariant);
      const taskId = (taskCtx && taskCtx.taskId) || null;
      const codexHome = daemonCtx.ensureDiAgentCodexHome();
      daemonCtx.ensureDiAgentCodexMcpConfig(codexHome, conversationId, userId, agentId, taskId);
      const cwd = daemonCtx.ensureTaskWorkdir({
        id: taskId || `codex-${agentId}`,
        conversation_id: conversationId,
        user_id: userId,
        agent_id: agentId,
      });

      const appServerArgs = ['app-server', '-c', 'model_reasoning_summary=detailed'];
      const launch = daemonCtx.processSpec(command, appServerArgs);
      const child = daemonCtx.spawn(launch.command, launch.args, {
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ...proxyEnv(),
          ...daemonCtx.buildDiAgentContextEnv(conversationId, userId, agentId, taskId),
        },
      });
      daemonCtx.logFlow('info', 'agent.process_spawn', {
        agent_id: agentId,
        conversation_id: conversationId,
        user_id: userId,
        command: launch.command,
        args: launch.args,
        cwd,
        session_mode: 'codex_app_server',
        pid: child.pid,
      });

      const queue = daemonCtx.createAsyncQueue
        ? daemonCtx.createAsyncQueue()
        : createAsyncQueue();

      // --- JSON-RPC 状态 ---
      let nextRpcId = 1;
      const pendingCalls = new Map(); // rpc id -> { resolve }
      let threadId = null;
      const usageMeter = createCodexUsageMeter();
      let currentTurn = null; // {turnId, resolve, timer, text}
      let pendingTurnApprovalContext = null;
      let pendingRuntimeVerification = null;
      let firstTurn = true;
      let processSettled = false;

      const rpcCall = (method, params) => new Promise((resolve) => {
        const id = nextRpcId++;
        const configuredTimeout = Number.isFinite(daemonCtx.PROTOCOL_TIMEOUT_MS)
          ? daemonCtx.PROTOCOL_TIMEOUT_MS
          : 15000;
        const timeoutMs = Math.min(daemonCtx.EXEC_TIMEOUT_MS, configuredTimeout);
        const timer = setTimeout(() => {
          pendingCalls.delete(id);
          resolve({ error: { message: `Codex 协议 ${method} 超时，桌面运行时可能不兼容。` } });
        }, timeoutMs);
        timer.unref();
        pendingCalls.set(id, {
          resolve: (response) => {
            clearTimeout(timer);
            resolve(response);
          },
        });
        try {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        } catch (err) {
          clearTimeout(timer);
          pendingCalls.delete(id);
          resolve({ error: { message: err.message } });
        }
      });

      const finishTurn = (outcome) => {
        const turn = currentTurn;
        if (!turn) return null;
        currentTurn = null;
        if (turn.timer) clearTimeout(turn.timer);
        daemonCtx.agentTurnStates.set(agentId, 'idle');
        return turn.resolve(outcome);
      };

      const logRuntimeUnverified = (verification) => {
        if (!verification || verification.verified || verification.unverifiedLogged) return;
        verification.unverifiedLogged = true;
        const expected = verification.config;
        daemonCtx.logFlow('warn', 'agent.codex_runtime_unverified', {
          agent_id: agentId,
          conversation_id: conversationId,
          task_id: verification.taskId,
          thread_id: threadId,
          requested_model: expected.model || 'default',
          requested_effort: expected.reasoning_effort,
          requested_service_tier: expected.service_tier,
          runtime_status: 'unverified',
        });
      };

      const logRuntimeApplied = (verification, settings) => {
        if (!verification || verification.verified || verification.unverifiedLogged) return;
        const appliedModel = typeof settings.model === 'string'
          && settings.model !== ''
          && CODEX_MODELS.has(settings.model)
          ? settings.model
          : 'unknown';
        const rawEffort = settings.effort ?? settings.reasoningEffort;
        const appliedEffort = typeof rawEffort === 'string' && REASONING_EFFORTS.has(rawEffort)
          ? rawEffort
          : 'unknown';
        const hasServiceTier = Object.prototype.hasOwnProperty.call(settings, 'serviceTier');
        const appliedServiceTier = hasServiceTier && settings.serviceTier === null
          ? 'default'
          : (hasServiceTier
            && typeof settings.serviceTier === 'string'
            && SERVICE_TIERS.has(settings.serviceTier)
            ? settings.serviceTier
            : 'unknown');
        const expected = verification.config;
        const modelMatches = expected.model ? appliedModel === expected.model : appliedModel !== 'unknown';
        const runtimeMatch = modelMatches
          && appliedEffort === expected.reasoning_effort
          && appliedServiceTier === expected.service_tier;
        verification.verified = true;
        daemonCtx.logFlow(runtimeMatch ? 'info' : 'warn', 'agent.codex_runtime_applied', {
          agent_id: agentId,
          conversation_id: conversationId,
          task_id: verification.taskId,
          thread_id: threadId,
          requested_model: expected.model || 'default',
          applied_model: appliedModel,
          requested_effort: expected.reasoning_effort,
          applied_effort: appliedEffort,
          requested_service_tier: expected.service_tier,
          applied_service_tier: appliedServiceTier,
          runtime_match: runtimeMatch,
          runtime_status: runtimeMatch ? 'matched' : 'mismatch',
        });
      };

      const verifyRuntimeAfterTurn = async (verification) => {
        if (!verification || verification.verificationStarted) return;
        verification.verificationStarted = true;
        const resumed = await rpcCall('thread/resume', { threadId, excludeTurns: true });
        const settings = resumed && resumed.result;
        if (resumed?.error
          || !settings
          || typeof settings !== 'object'
          || Array.isArray(settings)
          || !Object.prototype.hasOwnProperty.call(settings, 'model')) {
          logRuntimeUnverified(verification);
          return;
        }
        logRuntimeApplied(verification, settings);
      };

      const dispatchEvent = (ev) => {
        const onEvent = eventRef && eventRef.current;
        if (typeof onEvent === 'function') {
          try { onEvent(ev); } catch { /* 回调异常不阻断事件流 */ }
        }
        if (ev.type === 'text' || ev.type === 'thinking' || ev.type === 'tool_use') {
          daemonCtx.agentTurnStates.set(agentId, 'active');
        }
        if (ev.type === 'turn_end') {
          daemonCtx.logFlow(ev.error !== undefined ? 'warn' : 'info', 'agent.turn_result', {
            agent_id: agentId,
            conversation_id: conversationId,
            thread_id: threadId,
            is_error: ev.error !== undefined,
            result_len: typeof (ev.result || ev.error) === 'string' ? (ev.result || ev.error).length : 0,
          });
        }
        queue.push(ev);
      };

      const nativeToolStarts = new Set();
      const handleNotification = (msg) => {
        const method = msg.method;
        const p = msg.params || {};
        if (method === 'thread/tokenUsage/updated' && currentTurn && (!p.threadId || p.threadId === threadId)) {
          const event = usageEvent(usageMeter.observe(p.tokenUsage));
          if (event) dispatchEvent(event);
          return;
        }
        if (method === 'thread/compacted' || (method === 'item/completed' && p.item?.type === 'contextCompaction')) {
          const event = usageEvent(usageMeter.compact());
          if (event) dispatchEvent(event);
        }
        if (method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string') {
          dispatchEvent(thinkingEvent(p.delta));
          return;
        }
        if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
          if (currentTurn) currentTurn.text += p.delta;
          dispatchEvent(textEvent(p.delta));
          return;
        }
        if (method === 'item/started' || method === 'item/completed') {
          const events = codexToolEvents(p.item || {}, method === 'item/started' ? 'started' : 'completed', nativeToolStarts);
          if (events) { for (const event of events) dispatchEvent(event); return; }
        }
        if (method === 'item/completed') {
          const item = p.item || {};
          if (item.type === 'agentMessage') {
            // delta 通道已发过增量；completed 的全文仅用于校正累积结果，不重复推送。
            if (currentTurn && typeof item.text === 'string') currentTurn.text = item.text;
          } else if (item.type === 'reasoning') {
            const summaryText = (Array.isArray(item.summary)
              ? item.summary.map((s) => (s && typeof s.text === 'string' ? s.text : '')).filter(Boolean).join('\n')
              : '');
            if (summaryText) dispatchEvent(thinkingEvent(summaryText));
          }
          return;
        }
        if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/error') {
          const turnObj = p.turn || {};
          if (!currentTurn
            || currentTurn.terminalReceived
            || (turnObj.id && turnObj.id !== currentTurn.turnId)) return;
          const turn = currentTurn;
          turn.terminalReceived = true;
          if (turn.timer) {
            clearTimeout(turn.timer);
            turn.timer = null;
          }
          const turnError = method !== 'turn/completed' || turnObj.status === 'error' || turnObj.error
            ? (turnObj.error?.message || turnObj.error || 'codex turn failed')
            : undefined;
          void (async () => {
            await verifyRuntimeAfterTurn(turn.runtimeVerification);
            if (currentTurn !== turn) return;
            const resultText = turn.text || '';
            const usage = usageEvent(usageMeter.finish(!turnError));
            if (usage) dispatchEvent(usage);
            dispatchEvent(turnEndEvent({ result: resultText, error: turnError }));
            finishTurn(turnError ? { error: String(turnError) } : { result: resultText });
          })();
        }
      };

      const handleServerRequest = async (msg) => {
        const method = String(msg.method || '');
        const kind = method.includes('commandExecution')
          ? 'command'
          : method.includes('fileChange')
            ? 'file_change'
            : method.includes('permissions')
              ? 'permissions'
              : '';
        if (!kind) return false;
        let decision = 'decline';
        let approvalResolution = null;
        if (typeof daemonCtx.requestApproval === 'function') {
          try {
            // The app-server may place the turn/start response and an approval request
            // in the same stdout chunk. Keep the next turn's context synchronously
            // available before awaiting the turn/start response so the request cannot
            // fall back to the slot's first task identity.
            const approvalContext = currentTurn?.approvalContext || pendingTurnApprovalContext || {};
            const response = await daemonCtx.requestApproval({
              kind,
              method,
              params: msg.params || {},
              agent_id: approvalContext.agent_id || agentId,
              conversation_id: approvalContext.conversation_id || conversationId,
              user_id: approvalContext.user_id || userId,
              task_id: approvalContext.task_id || taskId,
            });
            if (response && typeof response === 'object') {
              approvalResolution = response;
              decision = response.decision;
            } else {
              decision = response;
            }
          } catch (error) {
            daemonCtx.logFlow('warn', 'agent.approval_failed', {
              agent_id: agentId,
              conversation_id: conversationId,
              error: error?.message || String(error),
            });
          }
        }
        const allowed = decision === 'accept' || decision === 'acceptForSession';
        const result = kind === 'permissions'
          ? { permissions: allowed ? (msg.params?.permissions || {}) : {}, scope: 'turn' }
          : { decision: allowed ? decision : 'decline' };
        try {
          await new Promise((resolve, reject) => {
            if (!child.stdin || child.stdin.destroyed || child.exitCode !== null) {
              reject(new Error('codex app-server stdin is not writable'));
              return;
            }
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`,
              (error) => error ? reject(error) : resolve(),
            );
          });
          if (approvalResolution && typeof daemonCtx.acknowledgeApproval === 'function') {
            daemonCtx.acknowledgeApproval({
              approval_id: approvalResolution.approval_id,
              task_id: approvalResolution.task_id,
            });
          }
        } catch (error) {
          // Keep the server-side approval pending when the app-server did not
          // receive the decision, then explicitly fail it so the prompt does not
          // linger after this app-server request has become unrecoverable.
          daemonCtx.logFlow('warn', 'agent.approval_write_failed', {
            agent_id: agentId,
            conversation_id: conversationId,
            error: error?.message || String(error),
          });
          if (approvalResolution && typeof daemonCtx.failApproval === 'function') {
            daemonCtx.failApproval({
              approval_id: approvalResolution.approval_id,
              task_id: approvalResolution.task_id,
              error: error?.message || String(error),
            });
          }
        }
        return true;
      };

      // --- stdio 行解析 ---
      let stdoutBuf = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        let rpcResponseSeen = false;
        const deferredNotifications = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg && msg.id !== undefined && pendingCalls.has(msg.id)) {
            const pending = pendingCalls.get(msg.id);
            pendingCalls.delete(msg.id);
            pending.resolve(msg);
            rpcResponseSeen = true;
          } else if (msg && msg.method && msg.id !== undefined) {
            void handleServerRequest(msg);
          } else if (msg && msg.method) {
            if (rpcResponseSeen) deferredNotifications.push(msg);
            else handleNotification(msg);
          }
        }
        if (deferredNotifications.length > 0) {
          // Resolving turn/start schedules its Promise continuation. Delivering later
          // notifications in a following microtask lets that continuation install
          // currentTurn first, while preserving notification order within the chunk.
          queueMicrotask(() => {
            for (const notification of deferredNotifications) handleNotification(notification);
          });
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        daemonCtx.logFlow('warn', 'agent.stderr', {
          agent_id: agentId,
          conversation_id: conversationId,
          message: daemonCtx.truncateStr(chunk.trim(), 300),
        });
      });

      const settleProcess = (exitMessage, { code, error } = {}) => {
        if (processSettled) return;
        processSettled = true;
        for (const pending of pendingCalls.values()) pending.resolve({ error: { message: exitMessage } });
        pendingCalls.clear();
        if (currentTurn) {
          logRuntimeUnverified(currentTurn.runtimeVerification);
          dispatchEvent(turnEndEvent({ error: exitMessage }));
          finishTurn({ error: exitMessage });
        }
        daemonCtx.agentTurnStates.delete(agentId);
        daemonCtx.logFlow(error ? 'error' : (code === 0 ? 'info' : 'warn'), error ? 'agent.process_error' : 'agent.process_close', {
          agent_id: agentId,
          conversation_id: conversationId,
          pid: child.pid,
          exit_code: code,
          error,
        });
        queue.push(sessionEndEvent({ code }));
        queue.done();
      };

      child.on('error', (error) => {
        const message = error?.message || String(error || 'unknown error');
        settleProcess(`Codex Desktop 运行时启动失败: ${message}`, { error: message });
      });
      child.on('close', (code) => {
        settleProcess(`Agent process exited (code=${code})`, { code });
      });

      // --- 启动序列：initialize → thread/start ---
      const boot = (async () => {
        const init = await rpcCall('initialize', {
          clientInfo: { name: 'di-agent-daemon', title: 'Di Agent', version: '0.4.4' },
        });
        if (init.error) throw new Error(`codex app-server initialize 失败: ${init.error.message}`);
        const thread = await rpcCall('thread/start', { cwd });
        threadId = thread && thread.result && thread.result.thread && thread.result.thread.id;
        if (!threadId) {
          throw new Error(`codex app-server thread/start 失败: ${JSON.stringify(thread && thread.error || {}).slice(0, 120)}`);
        }
        daemonCtx.logFlow('info', 'agent.codex_thread_ready', {
          agent_id: agentId,
          conversation_id: conversationId,
          thread_id: threadId,
        });
        return threadId;
      })();
      boot.catch((err) => {
        daemonCtx.logFlow('error', 'agent.codex_boot_failed', {
          agent_id: agentId,
          conversation_id: conversationId,
          error: err.message,
        });
        try { child.kill(); } catch { /* ignore */ }
      });

      // --- sendPrompt：串行化 + turn/start + 等 turn 终态 ---
      let queueTail = Promise.resolve();
      const sendPromptRaw = (prompt, runtimeConfig, approvalContext) => new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve({ error: 'Agent process not running' });
          return;
        }
        boot.then(async () => {
          let text = prompt;
          if (firstTurn) {
            // 首轮注入平台适配说明与系统指令（后续轮次走 thread 原生上下文）
            text = systemPrompt
              ? `${CODEX_MCP_FALLBACK}[系统指令]\n${systemPrompt}\n\n${prompt}`
              : `${CODEX_MCP_FALLBACK}${prompt}`;
            firstTurn = false;
          }
          usageMeter.beginTurn();
          const controls = codexTurnControls(runtimeConfig);
          pendingTurnApprovalContext = approvalContext || {};
          pendingRuntimeVerification = {
            config: controls.config,
            taskId: approvalContext?.task_id || taskId,
            verified: false,
          };
          if (typeof daemonCtx.updateDiAgentCodexTaskContext === 'function') {
            daemonCtx.updateDiAgentCodexTaskContext(
              codexHome,
              approvalContext?.conversation_id || conversationId,
              approvalContext?.user_id || userId,
              approvalContext?.agent_id || agentId,
              approvalContext?.task_id || null,
            );
          }
          const res = await rpcCall('turn/start', {
            threadId,
            cwd,
            input: [{ type: 'text', text }],
            ...controls.params,
          });
          const turnId = res && res.result && res.result.turn && res.result.turn.id;
          if (!turnId) {
            pendingTurnApprovalContext = null;
            logRuntimeUnverified(pendingRuntimeVerification);
            pendingRuntimeVerification = null;
            resolve({ error: `turn/start 失败: ${JSON.stringify((res && res.error) || {}).slice(0, 120)}` });
            return;
          }
          daemonCtx.logFlow('info', 'agent.prompt_sent', {
            agent_id: agentId,
            conversation_id: conversationId,
            thread_id: threadId,
            turn_id: turnId,
            prompt_len: typeof prompt === 'string' ? prompt.length : 0,
          });
          currentTurn = {
            turnId,
            resolve,
            timer: null,
            text: '',
            approvalContext,
            runtimeVerification: pendingRuntimeVerification,
          };
          pendingTurnApprovalContext = null;
          pendingRuntimeVerification = null;
          currentTurn.timer = setTimeout(() => {
            if (currentTurn && currentTurn.turnId === turnId) {
              daemonCtx.logFlow('error', 'agent.turn_timeout', {
                agent_id: agentId,
                conversation_id: conversationId,
                thread_id: threadId,
                turn_id: turnId,
                timeout_ms: daemonCtx.EXEC_TIMEOUT_MS,
              });
              const turn = currentTurn;
              currentTurn = null;
              logRuntimeUnverified(turn.runtimeVerification);
              turn.resolve({ error: `Agent task timed out (${Math.round(daemonCtx.EXEC_TIMEOUT_MS / 1000)}s)` });
            }
          }, daemonCtx.EXEC_TIMEOUT_MS);
          if (currentTurn) currentTurn.timer.unref();
        }).catch((err) => {
          pendingTurnApprovalContext = null;
          logRuntimeUnverified(pendingRuntimeVerification);
          pendingRuntimeVerification = null;
          resolve({ error: err.message });
        });
      });
      const sendPrompt = (prompt, runtimeConfig, approvalContext) => {
        const run = () => sendPromptRaw(prompt, runtimeConfig, approvalContext);
        queueTail = queueTail.then(run, run);
        return queueTail;
      };

      return {
        child,
        sessionId: daemonCtx.crypto.randomUUID(), // 存储兼容用；codex 上下文由 thread 承载
        sendPrompt,
        events: queue.iter,
      };
    },

    parseStreamEvent(line, streamContext = {}) {
      if (!line || !line.trim()) return null;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return null;
      }
      if (!event || typeof event !== 'object') return null;

      if ((event.type === 'item.started' || event.type === 'item.completed') && event.item) {
        streamContext.nativeToolStarts ||= new Set();
        const tools = codexToolEvents(event.item, event.type === 'item.started' ? 'started' : 'completed', streamContext.nativeToolStarts);
        if (tools) return tools;
      }
      if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
        const item = event.item;
        switch (item.type) {
          case 'agent_message':
            return [textEvent(typeof item.text === 'string' ? item.text : '')];
          case 'reasoning':
            return [thinkingEvent(typeof item.text === 'string' ? item.text : '')];
          case 'error':
            return [errorEvent(typeof item.message === 'string' ? item.message : 'codex 执行出错')];
          default:
            return null;
        }
      }

      if (event.type === 'turn.completed') {
        return [usageEvent(codexExecUsage(event.usage)), turnEndEvent({ result: '' })].filter(Boolean);
      }
      return null;
    },

    parseStreamEventAll(line, daemonCtx) {
      const ev = this.parseStreamEvent(line, daemonCtx);
      if (ev === null) return [];
      return Array.isArray(ev) ? ev : [ev];
    },
  };
}

module.exports = { createCodexCliSpec, normalizeRuntimeConfig, runtimeConfigFingerprint, codexTurnControls };
