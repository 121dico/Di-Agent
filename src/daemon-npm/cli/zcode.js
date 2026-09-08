'use strict';

const {
  textEvent,
  thinkingEvent,
  toolUseEvent,
  toolResultEvent,
  errorEvent,
  turnEndEvent,
  sessionEndEvent,
  createAsyncQueue,
} = require('./events');
const { readDiAgentEnvironment } = require('./environment');
const { resolveRuntimeCandidates, resolveRuntimeCandidate, runtimeVariant } = require('./runtime');
const {
  loadZcodeRuntimeModel,
  runtimeModelSecrets,
  redactSecrets,
} = require('./zcode_runtime');

const ZCODE_DESKTOP_FALLBACK = [
  '[ZCode Desktop 适配]',
  '你正在执行 Di Agent 平台派发的聊天任务。',
  '如需操作 Di Agent 平台对象，请使用 di-agent-platform MCP 工具完成真实操作。',
  '',
].join('\n');

function resultText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value.output === 'string') return value.output;
  if (typeof value.content === 'string') return value.content;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function eventEnvelope(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.method === 'session/event') {
    return message.params && message.params.event ? message.params.event : message.params;
  }
  if (typeof message.type === 'string') return message;
  return null;
}

function redactEventValue(value, secrets) {
  if (typeof value === 'string') return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactEventValue(item, secrets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, redactEventValue(item, secrets)]));
}

function platformMcpLaunch(mcpArgs, nodeCommand) {
  if (mcpArgs.length === 0) return { mcpServers: [] };
  const args = [];
  const env = [];
  const secretFlags = new Map([
    ['--api-key', 'DI_AGENT_API_KEY'],
    ['--daemon-token', 'DI_AGENT_DAEMON_TOKEN'],
  ]);
  for (let index = 0; index < mcpArgs.length; index += 1) {
    const value = mcpArgs[index];
    const envName = secretFlags.get(value);
    if (envName && index + 1 < mcpArgs.length) {
      env.push({ name: envName, value: mcpArgs[index + 1] });
      index += 1;
      continue;
    }
    args.push(value);
  }
  return {
    mcpServers: [{
      name: 'di-agent-platform',
      command: nodeCommand,
      args,
      env,
      isolation: 'session',
    }],
  };
}

function eventsForEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return [];
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  if (envelope.type === 'model.streaming') {
    if (payload.kind === 'text_delta' && typeof payload.delta === 'string') return [textEvent(payload.delta)];
    if (payload.kind === 'reasoning_delta' && typeof payload.delta === 'string') return [thinkingEvent(payload.delta)];
    if (payload.kind === 'error') return [errorEvent(payload.delta || 'ZCode 模型流失败')];
    return [];
  }
  if (envelope.type === 'tool.updated') {
    const tool = payload.toolName || payload.description || 'tool';
    if (payload.kind === 'scheduled') return [toolUseEvent(tool, payload.input, payload.toolCallId)];
    if (payload.kind === 'result') return [{ ...toolResultEvent(tool, resultText(payload.result), false), ...(payload.toolCallId ? { toolUseID: payload.toolCallId } : {}) }];
    if (payload.kind === 'error') {
      const message = payload.error?.message || payload.error || 'ZCode 工具执行失败';
      return [{ ...toolResultEvent(tool, String(message), true), ...(payload.toolCallId ? { toolUseID: payload.toolCallId } : {}) }];
    }
    return [];
  }
  if (envelope.type === 'turn.completed') {
    const hasResponse = typeof payload.response === 'string';
    const response = hasResponse ? payload.response : undefined;
    const failed = typeof payload.resultType === 'string' && payload.resultType.startsWith('error_');
    if (failed) return [turnEndEvent({ result: response, error: response || payload.resultType })];
    return [turnEndEvent(hasResponse ? { result: response } : {})];
  }
  if (envelope.type === 'turn.failed') {
    const message = payload.error?.message || payload.error?.detail || payload.error || 'ZCode turn failed';
    return [errorEvent(String(message)), turnEndEvent({ error: String(message) })];
  }
  return [];
}

function createZcodeCliSpec(ctx) {
  const desktopPaths = () => (typeof ctx.zcodeDesktopRuntimePaths === 'function'
    ? ctx.zcodeDesktopRuntimePaths()
    : []);
  const resolveCommands = () => resolveRuntimeCandidates({
    override: readDiAgentEnvironment(process.env, 'ZCODE_COMMAND'),
    cliCommand: 'zcode',
    desktopPaths: desktopPaths(),
    existingFile: ctx.existingFile,
    commandVersion: ctx.commandVersion,
    canonicalCommand: ctx.canonicalCommand,
  });
  return {
    cliTool: 'zcode',
    name: 'ZCode',
    defaultCapabilities: ctx.defaultSkills(['coding', 'review', 'orchestration']),

    resolveCommands,

    resolveCommand(taskOrCtx = {}) {
      const requestedVariant = taskOrCtx && taskOrCtx.runtimeVariant;
      const candidates = resolveCommands();
      if (requestedVariant === 'cli' || requestedVariant === 'desktop') {
        const selected = candidates.find((candidate) => candidate.variant === requestedVariant);
        if (!selected) {
          const label = requestedVariant === 'desktop' ? 'Desktop' : 'CLI';
          throw new Error(`ZCode ${label} runtime is not available on this computer. Reconnect the computer to rescan installed runtimes.`);
        }
        return selected.command;
      }
      if (candidates.length > 0) return candidates[0].command;
      return resolveRuntimeCandidate({
        override: readDiAgentEnvironment(process.env, 'ZCODE_COMMAND'),
        cliCommand: 'zcode',
        desktopPaths: desktopPaths(),
        existingFile: ctx.existingFile,
        commandVersion: ctx.commandVersion,
      }).command;
    },

    variantForCommand(command) {
      return runtimeVariant(command, desktopPaths());
    },

    buildCommand() {
      return { error: 'ZCode 任务需要 persistent app-server 模式；请更新 Di Agent daemon 后重试。' };
    },

    skillRoots(cwd, home) {
      const roots = [];
      const includeProjectRoots = !ctx.isDiAgentWorkspace(cwd);
      if (includeProjectRoots) ctx.addRoot(roots, ctx.pathJoin(cwd, '.zcode', 'skills'));
      if (home) ctx.addRoot(roots, ctx.pathJoin(home, '.zcode', 'skills'));
      return roots;
    },

    installSkillRoot(home) {
      return ctx.pathJoin(home, '.zcode', 'skills');
    },

    spawnPersistent({
      agentId,
      systemPrompt,
      conversationId,
      userId,
      taskCtx,
      eventRef,
      runtimeVariant,
    } = {}, daemonCtx = ctx) {
      const command = daemonCtx.resolveCommand('zcode', runtimeVariant);
      const taskId = (taskCtx && taskCtx.taskId) || null;
      const cwd = daemonCtx.ensureTaskWorkdir({
        id: taskId || `zcode-${agentId}`,
        conversation_id: conversationId,
        user_id: userId,
        agent_id: agentId,
      });
      const runtimeModel = loadZcodeRuntimeModel({
        fsImpl: daemonCtx.fs,
        home: typeof daemonCtx.homedir === 'function' ? daemonCtx.homedir() : process.env.HOME,
        pathJoin: daemonCtx.pathJoin,
        env: process.env,
      });
      const secrets = runtimeModelSecrets(runtimeModel);
      const mcpArgs = daemonCtx.buildPlatformMcpServerArgs(conversationId, userId, agentId, taskId);
      const { mcpServers } = platformMcpLaunch(
        mcpArgs,
        daemonCtx.nodeCommand || process.execPath,
      );
      const launch = daemonCtx.processSpec(command, ['app-server', '--surface', 'desktop']);
      const child = daemonCtx.spawn(launch.command, launch.args, {
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd,
        env: {
          ...process.env,
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
        session_mode: 'zcode_app_server',
        pid: child.pid,
      });

      const queue = daemonCtx.createAsyncQueue ? daemonCtx.createAsyncQueue() : createAsyncQueue();
      const pendingCalls = new Map();
      let nextRequestId = 1;
      let protocolSessionId = null;
      let currentTurn = null;
      let firstTurn = true;
      let closing = false;
      let processSettled = false;

      const writeMessage = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const rpcCall = (method, params) => new Promise((resolve) => {
        const id = nextRequestId++;
        const timeoutMs = Math.min(daemonCtx.EXEC_TIMEOUT_MS, 15000);
        const timer = setTimeout(() => {
          pendingCalls.delete(id);
          resolve({ error: { message: `ZCode 协议 ${method} 超时，桌面运行时可能不兼容。` } });
        }, timeoutMs);
        timer.unref();
        pendingCalls.set(id, {
          resolve: (response) => {
            clearTimeout(timer);
            resolve(response);
          },
        });
        try {
          writeMessage({ id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pendingCalls.delete(id);
          resolve({ error: { message: error.message } });
        }
      });

      const dispatchEvent = (event) => {
        const onEvent = eventRef && eventRef.current;
        if (typeof onEvent === 'function') {
          try { onEvent(event); } catch { /* 展示回调不能阻断协议 */ }
        }
        if (event.type === 'text' || event.type === 'thinking' || event.type === 'tool_use') {
          daemonCtx.agentTurnStates.set(agentId, 'active');
        }
        queue.push(event);
      };

      const finishTurn = (outcome) => {
        const turn = currentTurn;
        if (!turn) return;
        currentTurn = null;
        if (turn.timer) clearTimeout(turn.timer);
        daemonCtx.agentTurnStates.set(agentId, 'idle');
        turn.resolve(outcome);
      };

      const handleServerRequest = (message) => {
        if (message.method === 'session/requestRuntimePreferences') {
          writeMessage({
            id: message.id,
            result: {
              nativeSearchEnhancementsEnabled: true,
              memoryEnabled: false,
              askUserQuestionAutoResolutionEnabled: true,
              modelContextBudgetStrategy: 'preflight-v1',
            },
          });
          return;
        }
        writeMessage({ id: message.id, error: { code: -32601, message: `Di Agent 不支持 ZCode 回调: ${message.method}` } });
      };

      const handleNotification = (message) => {
        const envelope = eventEnvelope(message);
        if (!envelope) return;
        if (protocolSessionId && envelope.sessionId && envelope.sessionId !== protocolSessionId) return;
        for (const rawEvent of eventsForEnvelope(envelope)) {
          // Protocol errors and tool results are forwarded through task.progress;
          // redact provider credentials before they can leave the daemon process.
          const event = redactEventValue(rawEvent, secrets);
          if (currentTurn && event.type === 'text') currentTurn.text += event.content;
          dispatchEvent(event);
          if (event.type === 'turn_end') {
            const finalText = event.result !== undefined ? event.result : currentTurn?.text || '';
            daemonCtx.logFlow(event.error !== undefined ? 'warn' : 'info', 'agent.turn_result', {
              agent_id: agentId,
              conversation_id: conversationId,
              session_id: protocolSessionId,
              is_error: event.error !== undefined,
              result_len: typeof (event.error || finalText) === 'string' ? (event.error || finalText).length : 0,
            });
            finishTurn(event.error !== undefined
              ? { error: redactSecrets(event.error, secrets) }
              : { result: finalText });
          }
        }
      };

      let stdoutBuffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.method && message.id !== undefined) {
            handleServerRequest(message);
          } else if (message.id !== undefined && pendingCalls.has(message.id)) {
            const pending = pendingCalls.get(message.id);
            pendingCalls.delete(message.id);
            pending.resolve(message);
          } else if (message.method) {
            handleNotification(message);
          }
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        daemonCtx.logFlow('warn', 'agent.stderr', {
          agent_id: agentId,
          conversation_id: conversationId,
          message: daemonCtx.truncateStr(redactSecrets(chunk.trim(), secrets), 300),
        });
      });

      const settleProcess = (exitMessage, { code, signal, error } = {}) => {
        if (processSettled) return;
        processSettled = true;
        for (const pending of pendingCalls.values()) pending.resolve({ error: { message: exitMessage } });
        pendingCalls.clear();
        if (currentTurn) {
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
        queue.push(sessionEndEvent({ code, signal }));
        queue.done();
      };

      child.on('error', (error) => {
        const message = redactSecrets(error?.message || error || 'unknown error', secrets);
        settleProcess(`ZCode Desktop 运行时启动失败: ${message}`, { error: message });
      });
      child.on('close', (code, signal) => {
        settleProcess(`ZCode Desktop 运行时已退出 (code=${code}${signal ? `, signal=${signal}` : ''})`, { code, signal });
      });

      const boot = (async () => {
        const createParams = {
          workspace: { workspacePath: cwd, workspaceKey: cwd },
          mode: 'yolo',
          titleGenerationEnabled: false,
          mcpServers,
        };
        if (runtimeModel) {
          createParams.model = runtimeModel.model;
          createParams.runtimeModel = runtimeModel;
        }
        const created = await rpcCall('session/create', createParams);
        if (created.error) throw new Error(`ZCode Desktop session/create 失败: ${redactSecrets(created.error.message, secrets)}`);
        protocolSessionId = created.result?.sessionId || created.result?.session?.id || created.result?.session?.sessionId;
        if (!protocolSessionId) throw new Error('ZCode Desktop 协议不兼容：session/create 未返回 sessionId。');
        const subscribed = await rpcCall('session/subscribe', {
          sessionId: protocolSessionId,
          deliveryKind: 'desktop-continuous',
          includeSnapshot: false,
        });
        if (subscribed.error) throw new Error(`ZCode Desktop session/subscribe 失败: ${redactSecrets(subscribed.error.message, secrets)}`);
        daemonCtx.logFlow('info', 'agent.zcode_session_ready', {
          agent_id: agentId,
          conversation_id: conversationId,
          session_id: protocolSessionId,
        });
      })();
      boot.catch((error) => {
        daemonCtx.logFlow('error', 'agent.zcode_boot_failed', {
          agent_id: agentId,
          conversation_id: conversationId,
          error: redactSecrets(error.message, secrets),
        });
        try { child.kill(); } catch { /* ignore */ }
      });

      let queueTail = Promise.resolve();
      const sendPromptRaw = (prompt) => new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve({ error: 'ZCode Desktop 运行时未运行。' });
          return;
        }
        boot.then(async () => {
          let content = String(prompt || '');
          if (firstTurn) {
            content = systemPrompt
              ? `${ZCODE_DESKTOP_FALLBACK}[系统指令]\n${systemPrompt}\n\n${content}`
              : `${ZCODE_DESKTOP_FALLBACK}${content}`;
            firstTurn = false;
          }
          currentTurn = { resolve, timer: null, text: '' };
          const params = { sessionId: protocolSessionId, content };
          if (runtimeModel) params.runtimeModel = runtimeModel;
          const sent = await rpcCall('session/send', params);
          if (sent.error) {
            currentTurn = null;
            resolve({ error: `ZCode Desktop session/send 失败: ${redactSecrets(sent.error.message, secrets)}` });
            return;
          }
          daemonCtx.logFlow('info', 'agent.prompt_sent', {
            agent_id: agentId,
            conversation_id: conversationId,
            session_id: protocolSessionId,
            prompt_len: typeof prompt === 'string' ? prompt.length : 0,
          });
          if (!currentTurn) return;
          currentTurn.timer = setTimeout(() => {
            if (!currentTurn) return;
            const timeoutMessage = `ZCode Desktop 任务超时 (${Math.round(daemonCtx.EXEC_TIMEOUT_MS / 1000)}s)`;
            dispatchEvent(turnEndEvent({ error: timeoutMessage }));
            finishTurn({ error: timeoutMessage });
          }, daemonCtx.EXEC_TIMEOUT_MS);
          currentTurn.timer.unref();
        }).catch((error) => resolve({ error: redactSecrets(error.message, secrets) }));
      });
      const sendPrompt = (prompt) => {
        const run = () => sendPromptRaw(prompt);
        queueTail = queueTail.then(run, run);
        return queueTail;
      };

      const terminate = () => {
        try { child.kill(); } catch { /* already stopped */ }
      };
      const close = () => {
        if (closing) return Promise.resolve();
        closing = true;
        if (!protocolSessionId || child.exitCode !== null) {
          terminate();
          return Promise.resolve();
        }
        const result = rpcCall('session/close', { sessionId: protocolSessionId });
        const fallback = setTimeout(terminate, 250);
        fallback.unref();
        return result.finally(() => {
          clearTimeout(fallback);
          terminate();
        });
      };
      child.diAgentClose = close;

      return {
        child,
        sessionId: daemonCtx.crypto.randomUUID(),
        sendPrompt,
        close,
        events: queue.iter,
      };
    },

    parseResult({ stdout, stderr } = {}) {
      const text = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
      return text || '(ZCode 没有返回内容)';
    },

    parseStreamEvent(line) {
      const events = this.parseStreamEventAll(line);
      return events.length <= 1 ? (events[0] || null) : events;
    },

    parseStreamEventAll(line) {
      if (!line || !line.trim()) return [];
      let message;
      try { message = JSON.parse(line); } catch { return []; }
      return eventsForEnvelope(eventEnvelope(message));
    },
  };
}

module.exports = { createZcodeCliSpec, eventsForEnvelope, redactEventValue };
