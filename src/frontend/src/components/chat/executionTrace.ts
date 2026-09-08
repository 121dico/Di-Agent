import type { MessageBlock, MessageStatus } from '@/types/message';
export interface TraceEntry { call: MessageBlock; result?: MessageBlock; state: 'running' | 'success' | 'error' | 'unconfirmed' }
export function executionTrace(blocks: MessageBlock[], status?: MessageStatus): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const block of blocks) {
    if (block.kind === 'tool_use') {
      entries.push({ call: block, state: status === 'streaming' ? 'running' : 'unconfirmed' });
    } else if (block.kind === 'tool_result') {
      // 缺少关联 ID 的旧结果不能猜测属于哪个并发工具。
      const entry = block.tool_use_id ? entries.find((item) => item.call.tool_use_id === block.tool_use_id && !item.result) : undefined;
      if (entry) {
        entry.result = block;
        entry.call = { ...entry.call, tool_kind: entry.call.tool_kind ?? block.tool_kind, skill_name: entry.call.skill_name ?? block.skill_name, server_name: entry.call.server_name ?? block.server_name, source_path: entry.call.source_path ?? block.source_path };
        entry.state = block.is_error ? 'error' : 'success';
      } else {
        entries.push({ call: block, result: block, state: block.is_error ? 'error' : 'success' });
      }
    }
  }
  return entries;
}
