// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types/message';
import { MessageBubble } from './MessageBubble';

const failed: Message = {
  id: 'failed-reply', conversation_id: 'group', role: 'assistant', content: '',
  artifacts_json: JSON.stringify({ agent_name: 'Codex', cli_tool: 'codex' }),
  created_at: '2026-10-19T08:10:38Z', status: 'error',
};

function render(message: Message, streaming = false) {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<MessageBubble message={message} streaming={streaming} />);
  return element;
}

describe('failed Agent replies', () => {
  it('shows an honest failure for historical blank replies instead of an empty bubble', () => {
    const element = render(failed);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Codex 执行失败');
    expect(element.textContent).toContain('未保存具体失败原因');
    expect(element.textContent).not.toContain('workspace routing');
    expect(element.textContent).not.toContain('等待模型输出');
  });

  it.each(['live', 'history'] as const)('shows the real Codex timeout alongside prior output in %s messages', mode => {
    const blocks = [
      { index: 0, kind: 'text' as const, text: '已完成的部分仍然保留。' },
      { index: 1, kind: 'error' as const, text: 'workspace routing discovery timed out' },
    ];
    const element = render({ ...failed, ...(mode === 'live' ? { blocks } : { blocks_json: JSON.stringify(blocks) }) }, true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Codex 执行失败');
    expect(element.textContent).toContain('工作区路由发现超时');
    expect(element.textContent).toContain('workspace routing discovery timed out');
    expect(element.textContent).toContain('已完成的部分仍然保留。');
    expect(element.textContent).not.toContain('未保存具体失败原因');
    expect(element.querySelector('[aria-label="停止生成"]')).toBeNull();
    expect(element.querySelector('[class*="streamingCursor"]')).toBeNull();
  });

  it.each(['complete', 'canceled'] as const)('does not label a %s reply as failed', status => {
    const element = render({ ...failed, status, content: '已有内容' });
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.textContent).toContain('已有内容');
  });

  it('shows unknown errors as literal text without inventing a cause', () => {
    const element = render({ ...failed, blocks: [{ index: 0, kind: 'error', text: '<img src=x onerror=alert(1)> remote rejected' }] });
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('<img src=x onerror=alert(1)> remote rejected');
    expect(element.querySelector('[role="alert"] img')).toBeNull();
    expect(element.textContent).not.toMatch(/权限不足|账号失效|余额不足/);
  });

  it('keeps an error outside the collapsible body of a long partial response', () => {
    const element = render({ ...failed, content: '原有正文。'.repeat(200) });
    expect(element.textContent).toContain('收起内容');
    expect(element.querySelector('[role="alert"]')?.closest('[class*="collapsed"]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('replaces a waiting reply with its actual failure without a page reload', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<MessageBubble message={{ ...failed, status: 'streaming' }} />));
      expect(container.textContent).toContain('等待模型输出');
      await act(async () => root.render(<MessageBubble streaming message={{ ...failed, blocks: [{ index: 0, kind: 'error', text: 'workspace routing discovery timed out' }] }} />));
      expect(container.textContent).toContain('Codex 执行失败');
      expect(container.textContent).toContain('workspace routing discovery timed out');
      expect(container.textContent).not.toContain('等待模型输出');
      expect(container.querySelector('[class*="streamingCursor"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
