import { describe, expect, it } from 'vitest';
import { executionTrace } from './executionTrace';
import { reduceEvents } from '@/store/streamingReducer';

describe('execution trace evidence', () => {
  it('preserves metadata, input and result association through streaming and history JSON', () => {
    const { blocks } = reduceEvents([
      { type: 'tool_use', tool: 'load_skill', input: { name: 'review' }, tool_use_id: 's', tool_kind: 'skill', skill_name: 'review', source_path: '/skills/review/SKILL.md' },
      { type: 'tool_use', tool: 'search', input: { q: 'hello' }, tool_use_id: 'm', tool_kind: 'mcp', server_name: 'docs' },
      { type: 'tool_result', tool_use_id: 'm', output: 'unavailable', is_error: true },
      { type: 'tool_result', tool_use_id: 's', output: 'loaded' },
    ]);
    const entries = executionTrace(JSON.parse(JSON.stringify(blocks)), 'complete');
    expect(entries.map((entry) => entry.state)).toEqual(['success', 'error']);
    expect(entries[0]?.call).toMatchObject({ tool_kind: 'skill', skill_name: 'review', source_path: '/skills/review/SKILL.md', text: '{"name":"review"}' });
    expect(entries[1]?.call.server_name).toBe('docs');
  });
  it('does not manufacture success from session end or prose about a skill', () => {
    const { blocks } = reduceEvents([
      { type: 'text', content: 'I used the review skill' },
      { type: 'tool_use', tool: 'Read', tool_use_id: '1' },
      { type: 'session_end' },
    ]);
    expect(executionTrace(blocks, 'complete')).toMatchObject([{ state: 'unconfirmed', call: { tool_name: 'Read' } }]);
    expect(executionTrace(blocks, 'streaming')[0]?.state).toBe('running');
  });
  it('does not attach an uncorrelated legacy result to another call', () => {
    const { blocks } = reduceEvents([{ type: 'tool_use', tool: 'Read', tool_use_id: '1' }, { type: 'tool_result', output: 'ok' }]);
    expect(executionTrace(blocks).map((entry) => entry.state)).toEqual(['unconfirmed', 'success']);
  });
});

it('routes actual camelCase daemon IDs and interleaved Claude input to the right trace calls', () => {
  const { blocks } = reduceEvents([
    { type: 'tool_use', tool: 'Read', input: {}, toolUseID: 'a', tool_kind: 'skill', skill_name: 'review' },
    { type: 'tool_use', tool: 'search', input: {}, toolUseID: 'b', tool_kind: 'mcp', server_name: 'docs' },
    { type: 'tool_use', tool: '', input: '{"path":"review/SKILL.md"}', toolUseID: 'a' },
    { type: 'tool_use', tool: '', input: '{"q":"docs"}', toolUseID: 'b' },
    { type: 'tool_result', toolUseID: 'b', output: 'denied', isError: true },
    { type: 'tool_result', toolUseID: 'a', output: '{"loaded":true}' },
  ]);
  const live = executionTrace(blocks, 'streaming');
  expect(live.map(({ call, state }) => ({ id: call.tool_use_id, input: call.text, state }))).toEqual([
    { id: 'a', input: '{"path":"review/SKILL.md"}', state: 'success' },
    { id: 'b', input: '{"q":"docs"}', state: 'error' },
  ]);
  expect(executionTrace(JSON.parse(JSON.stringify(blocks)), 'complete')).toEqual(live);
});

it('never routes an unknown explicit invocation ID into another call', () => {
  const { blocks } = reduceEvents([
    { type: 'tool_use', tool: 'Read', toolUseID: 'a' },
    { type: 'tool_use', tool: '', input: 'wrong', toolUseID: 'unknown' },
  ]);
  expect(blocks[0]?.text).toBe('');
});
