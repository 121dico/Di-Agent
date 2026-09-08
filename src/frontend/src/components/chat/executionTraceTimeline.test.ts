import { expect, it } from 'vitest';
import { traceTimeline, traceGeometry, filterTraceEvents } from './executionTraceTimeline';
import type { MessageBlock } from '@/types/message';
const blocks: MessageBlock[] = [
  { index: 0, kind: 'thinking', text: 'PRIVATE REASONING' },
  { index: 1, kind: 'text', text: 'Checking docs', started_at: '2026-09-08T09:00:00Z', ended_at: '2026-09-08T09:00:01Z' },
  { index: 2, kind: 'tool_use', tool_name: 'search', tool_kind: 'mcp', server_name: 'docs', tool_use_id: 'm', text: '{}', started_at: '2026-09-08T09:00:02Z' },
  { index: 3, kind: 'tool_result', tool_use_id: 'm', text: 'found', started_at: '2026-09-08T09:00:04Z', ended_at: '2026-09-08T09:00:04Z' },
];
it('builds only observed public input/output and actual ordered tool events', () => {
  const events = traceTimeline(blocks, 'complete', { text: 'Find docs', createdAt: '2026-09-08T08:59:59Z' });
  expect(events.map((event) => event.lane)).toEqual(['input', 'model', 'tool', 'tool']);
  expect(JSON.stringify(events)).not.toContain('PRIVATE REASONING');
  expect(events[2]?.durationMs).toBe(2000);
  expect(events[2]?.label).toBe('search');
  expect(events[3]?.label).toBe('search · 返回');
  expect(filterTraceEvents(events, 'tool', 'docs')).toHaveLength(2);
});
it('never invents input or duration for older history; sequence bars stay equal', () => {
  const events = traceTimeline([{ index: 0, kind: 'text', text: 'done' }, { index: 1, kind: 'tool_use', tool_name: 'Read', text: '' }], 'complete');
  expect(events).toHaveLength(2);
  expect(events.every((event) => event.durationMs === undefined)).toBe(true);
  const chart = traceGeometry(events, 'time');
  expect(chart.mode).toBe('sequence');
  expect(chart.segments[0]?.width).toBe(chart.segments[1]?.width);
  expect(chart.segments[1]?.event.state).toBe('unconfirmed');
});

it('separates untimed input from a real timed call instead of giving it an invented timestamp', () => {
  const events = traceTimeline(blocks, 'complete', { text: 'Input without recorded time' });
  const chart = traceGeometry(events, 'time');
  expect(chart.mode).toBe('time');
  expect(chart.segments[0]?.untimed).toBe(true);
  expect(chart.segments[0]?.event.startedAt).toBeUndefined();
});
it('rejects zero timestamps and negative durations', () => {
  const events = traceTimeline([
    { index: 0, kind: 'tool_use', tool_name: 'search', tool_use_id: 'z', text: '', started_at: '0001-01-01T00:00:00Z' },
    { index: 1, kind: 'tool_result', tool_use_id: 'z', text: '', ended_at: '2026-09-08T09:00:01Z' },
    { index: 2, kind: 'text', text: 'done', started_at: '2026-09-08T09:00:04Z', ended_at: '2026-09-08T09:00:02Z' },
  ]);
  expect(events[0]?.durationMs).toBeUndefined();
  expect(events[2]?.durationMs).toBeUndefined();
});

it('uses only a full verified user reply source, never a truncated preview or an agent dispatch', async () => {
  const { traceInputFromSource } = await import('./executionTraceTimeline');
  expect(traceInputFromSource(undefined)).toBeUndefined();
  expect(traceInputFromSource({ role: 'assistant', content: 'Delegate this task', created_at: '2026-09-08T09:00:00Z' })).toBeUndefined();
  const content = 'Full user request '.repeat(20);
  expect(traceInputFromSource({ role: 'user', content, created_at: '2026-09-08T09:00:00Z' })).toEqual({ text: content, createdAt: '2026-09-08T09:00:00Z' });
  expect(traceInputFromSource({ role: 'user', content, created_at: '2026-09-08T09:00:00Z' }, true)).toBeUndefined();
});
