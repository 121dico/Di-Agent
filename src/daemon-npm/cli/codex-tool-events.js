'use strict';
const { toolUseEvent, toolResultEvent } = require('./events');

// Both Codex protocols expose item start/completion boundaries and stable IDs.
// Keep this state per execution; IDs may be reused by unrelated CLI sessions.
function codexToolEvents(item, phase, starts) {
  const kind = String(item.type || '').replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  if (!['command_execution', 'function_call', 'mcp_tool_call'].includes(kind)) return null;
  const shell = kind === 'command_execution';
  const tool = shell ? 'shell' : item.tool || item.name || item.tool_name || kind;
  const input = shell ? item.command || '' : item.arguments || item.input || {};
  const meta = { ...(item.id ? { toolUseID: item.id } : {}), ...(kind === 'mcp_tool_call' ? { tool_kind: 'mcp', server_name: item.server || item.server_name || '' } : {}) };
  const start = { ...toolUseEvent(tool, input, item.id), ...meta };
  if (phase === 'started') {
    if (item.id && starts.has(item.id)) return [];
    if (item.id) starts.add(item.id);
    return [start];
  }
  const sawStart = item.id && starts.delete(item.id);
  const exitCode = item.exitCode ?? item.exit_code;
  const failed = item.status === 'failed' || Boolean(item.error) || Boolean(item.result?.isError) || (shell && exitCode != null && Number(exitCode) !== 0);
  const output = shell ? item.aggregatedOutput || item.aggregated_output || item.output || '' : item.result || item.output || item.error || '';
  const result = { ...toolResultEvent(tool, output, failed), ...meta };
  return sawStart ? [result] : [{ ...start, timing_incomplete: true }, result];
}
module.exports = { codexToolEvents };
