// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ContextUsage } from '@/types/context';

vi.mock('@/api/context', () => ({ getConversationContextUsage: vi.fn() }));
import { getConversationContextUsage } from '@/api/context';
import { ContextUsageFooter, ContextUsageFooterView } from './ContextUsageFooter';
import { notifyTaskChanged } from '@/store/wsStore';

const usage: ContextUsage = {
  conversation_id: 'chat-a', agent_id: 'agent-a', generation: 1,
  active_context_tokens: 25000, context_window_tokens: 100000,
  usage_ratio: .25, status: 'normal', source: 'estimated', compaction_count: 0,
};

describe('ContextUsageFooter', () => {
  it('shows token counts and a matching progress meter without opening details', () => {
    const html = renderToStaticMarkup(<ContextUsageFooterView usages={[usage]} onOpen={() => {}} />);
    expect(html).toContain('25.0K / 100K · 25%');
    expect(html).toContain('估算');
    expect(html).toContain('value="25"');
  });

  it('does not report unknown or failed usage as zero percent', () => {
    const unknown = renderToStaticMarkup(<ContextUsageFooterView usages={[{ ...usage, status: 'unknown' }]} onOpen={() => {}} />);
    expect(unknown).toContain('暂无用量记录');
    expect(unknown).not.toContain('25%');
    const failed = renderToStaticMarkup(<ContextUsageFooterView usages={[]} failed onOpen={() => {}} />);
    expect(failed).toContain('暂时无法获取');
    expect(failed).not.toContain('0%');
  });

  it('loads usage on entry, refreshes for task changes and ignores stale responses after navigation', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const api = vi.mocked(getConversationContextUsage);
    api.mockResolvedValueOnce([usage]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpen = vi.fn();
    try {
      await act(async () => root.render(<ContextUsageFooter key="a" conversationId="chat-a" onOpen={onOpen} />));
      expect(container.textContent).toContain('25%');
      let resolveOld: (value: ContextUsage[]) => void = () => {};
      api.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
      act(() => notifyTaskChanged('chat-a'));
      api.mockResolvedValueOnce([]);
      await act(async () => root.render(<ContextUsageFooter key="b" conversationId="chat-b" onOpen={onOpen} />));
      await act(async () => resolveOld([usage]));
      expect(container.textContent).toContain('暂无用量记录');
      expect(container.textContent).not.toContain('25%');
      act(() => container.querySelector('button')?.click());
      expect(onOpen).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.resetAllMocks();
    }
  });
});
