import type { Message, MessageBlock, MessageStatus } from '@/types/message';
import { executionTrace } from './executionTrace';

export type TraceLane = 'input' | 'model' | 'skill' | 'tool';
export type TraceView = 'time' | 'sequence';
export interface TraceInput { text: string; createdAt?: string }
export interface TraceTimelineEvent {
  id: string;
  order: number;
  lane: TraceLane;
  label: string;
  phase: 'input' | 'output' | 'call' | 'result' | 'error';
  state: 'recorded' | 'running' | 'success' | 'error' | 'unconfirmed';
  text: string;
  call?: MessageBlock;
  result?: MessageBlock;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}
export const TRACE_LANES: { id: TraceLane; label: string }[] = [
  { id: 'input', label: '用户输入' }, { id: 'model', label: '模型输出' },
  { id: 'skill', label: 'Skill' }, { id: 'tool', label: 'MCP / 工具' },
];
function time(value?: string): number | undefined {
  if (!value) return undefined;
  const result = Date.parse(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}
function duration(start?: string, end?: string): number | undefined {
  const a = time(start); const b = time(end);
  return a !== undefined && b !== undefined && b >= a ? b - a : undefined;
}
export function traceTimeline(blocks: MessageBlock[], status?: MessageStatus, input?: TraceInput): TraceTimelineEvent[] {
  const calls = executionTrace(blocks, status);
  const events: TraceTimelineEvent[] = [];
  if (input?.text.trim()) events.push({ id: 'input', order: 0, lane: 'input', label: '用户输入', phase: 'input', state: 'recorded', text: input.text, startedAt: input.createdAt, endedAt: input.createdAt });
  blocks.forEach((block, index) => {
    // 只呈现可见输出和工具证据，thinking 不进入轨迹。
    if (!['text', 'tool_use', 'tool_result', 'error'].includes(block.kind)) return;
    const entry = block.kind === 'tool_result' ? calls.find((item) => item.result === block) : calls.find((item) => item.call.index === block.index);
    const call = entry?.call;
    const result = entry?.result;
    const isTool = block.kind === 'tool_use' || block.kind === 'tool_result';
    const name = call?.skill_name || call?.tool_name || block.tool_name || '未关联工具';
    const start = block.started_at;
    const end = block.kind === 'tool_use' ? result?.ended_at ?? result?.started_at ?? block.ended_at : block.ended_at;
    events.push({
      id: `event-${block.index}-${index}`, order: events.length,
      lane: block.kind === 'text' ? 'model' : call?.tool_kind === 'skill' ? 'skill' : 'tool',
      label: block.kind === 'text' ? '模型输出' : block.kind === 'error' ? '执行错误' : `${name}${block.kind === 'tool_result' ? ' · 返回' : ''}`,
      phase: block.kind === 'text' ? 'output' : block.kind === 'tool_use' ? 'call' : block.kind === 'tool_result' ? 'result' : 'error',
      state: isTool ? entry?.state ?? 'unconfirmed' : block.kind === 'error' ? 'error' : 'recorded',
      text: block.text || '', call: isTool ? call : undefined, result: isTool ? result : undefined,
      startedAt: start, endedAt: end, durationMs: block.kind === 'tool_use' || block.kind === 'text' ? duration(start, end) : undefined,
    });
  });
  return events;
}
export function filterTraceEvents(events: TraceTimelineEvent[], lane: TraceLane | 'all', query: string): TraceTimelineEvent[] {
  const normalized = query.trim().toLowerCase();
  return events.filter((event) => (lane === 'all' || event.lane === lane) && (!normalized || [event.label, event.text, event.call?.server_name, event.call?.source_path, event.call?.tool_use_id, event.result?.text].some((value) => value?.toLowerCase().includes(normalized))));
}
export function traceGeometry(events: TraceTimelineEvent[], requested: TraceView) {
  const starts = events.map((event) => time(event.startedAt));
  const valid = starts.filter((value): value is number => value !== undefined);
  const origin = valid.length ? Math.min(...valid) : 0;
  const end = Math.max(origin, ...events.map((event) => time(event.endedAt) ?? time(event.startedAt) ?? origin));
  const canTime = events.length > 0 && valid.length > 0 && end > origin;
  const mode: TraceView = requested === 'time' && canTime ? 'time' : 'sequence';
  const slot = 1000 / Math.max(1, events.length);
  return { mode, canTime, spanMs: canTime ? end - origin : undefined, segments: events.map((event, index) => {
    const untimed = time(event.startedAt) === undefined;
    const x = mode === 'time' && !untimed ? ((time(event.startedAt)! - origin) / (end - origin)) * 1000 : index * slot;
    const width = mode === 'time' && !untimed ? Math.max(6, (((time(event.endedAt) ?? time(event.startedAt)!) - time(event.startedAt)!) / (end - origin)) * 1000) : Math.max(2, slot - 3);
    return { event, untimed, x: Math.min(994, x), width: Math.min(width, 1000 - Math.min(994, x)) };
  }) };
}
export function traceDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function traceInputFromSource(source?: Pick<Message, 'role' | 'content' | 'created_at'>, deleted = false): TraceInput | undefined {
  // reply_to_message 是截断预览且可能引用 Agent；只信任已加载源消息的角色和完整正文。
  return source?.role === 'user' && !deleted && source.content.trim() ? { text: source.content, createdAt: source.created_at } : undefined;
}
