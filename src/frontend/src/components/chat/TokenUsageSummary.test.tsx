import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenUsageSummary } from './TokenUsageSummary';
import { ContextUsagePanel } from './ContextUsagePanel';
import { streamingReducer, initialStreamingState } from '@/store/streamingReducer';
import type { AgentEvent } from '@/types/agentEvent';
import type { TokenUsage } from '@/types/tokenUsage';

const usage: TokenUsage = { provider: 'codex', source: 'actual', input_tokens: 12000, output_tokens: 1000, cache_read_tokens: 10000, context_tokens: 12000, complete: true, observed_at: '2026-09-09T00:00:00Z' };
describe('native usage disclosure', () => {
  it('shows unknown cache separately from measured zero and never invents context capacity', () => {
    const html = renderToStaticMarkup(<TokenUsageSummary title="本轮" usage={{ ...usage, cache_read_tokens: 0 }} />);
    expect(html).toContain('12.0K');
    expect(html).toContain('<dd>0</dd>');
    expect(html).toContain('未上报');
    const context = renderToStaticMarkup(<ContextUsagePanel usage={{ conversation_id: 'c', agent_id: 'a', generation: 1, active_context_tokens: 12000, context_window_tokens: 0, usage_ratio: 0, status: 'unknown', source: 'actual', compaction_count: 0, native_usage: usage }} />);
    expect(context).toContain('容量未上报');
    expect(context).not.toContain('0%');
  });
  it('keeps one metadata snapshot after a terminal event', () => {
    let state = streamingReducer(initialStreamingState, { type: 'text', content: 'hello' });
    state = streamingReducer(state, { type: 'turn_end' });
    state = streamingReducer(state, { type: 'usage', usage });
    state = streamingReducer(state, { type: 'usage', usage });
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0]?.text).toBe('hello');
    expect(state.blocks[1]?.usage?.input_tokens).toBe(12000);
    expect(state.status).toBe('complete');
  });
  it('keeps Markdown contiguous around metadata and rejects malformed usage', () => {
    let state = streamingReducer(initialStreamingState, { type: 'text', content: '**hel' });
    state = streamingReducer(state, { type: 'usage', usage });
    state = streamingReducer(state, { type: 'text', content: 'lo**' });
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0]?.text).toBe('**hello**');
    expect(streamingReducer(state, { type: 'usage' } as AgentEvent)).toBe(state);
    expect(streamingReducer(state, { type: 'usage', usage: { ...usage, input_tokens: -1 } })).toBe(state);
  });

});
