'use strict';
const fs = require('node:fs');

// 只读日志尾部、只接受完全匹配的 Agent/对话；不从正文或其他会话猜测。
function recoverCodexThread(logPath, agentId, conversationId) {
  let fd;
  try {
    fd = fs.openSync(logPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (size > length) lines.shift();
    for (const line of lines.reverse()) {
      const fields = Object.fromEntries(line.split(' ').map(x => x.split('=')));
      if (fields.stage === 'agent.codex_thread_ready' && fields.agent_id === agentId && fields.conversation_id === conversationId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(fields.thread_id || '')) return fields.thread_id;
    }
  } catch { /* 无可靠证据时保留旧映射并提示检查点续接。 */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}
module.exports = { recoverCodexThread };
