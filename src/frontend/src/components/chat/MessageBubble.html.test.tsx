// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Message } from '@/types/message';
import { MessageBubble } from './MessageBubble';
import { useMessageStore } from '@/store/messageStore';

vi.mock('./FilesDrawer', () => ({
  FilesDrawer: (props: { open: boolean; agentId: string; workDir: string; initialPath?: string }) =>
    props.open ? <div data-testid="html-preview">{JSON.stringify(props)}</div> : null,
}));
const path = '/tmp/claude-task/pelican-car.html';
const card = { id: 'files', type: 'diff', workDir: '/tmp/claude-task', files: ['pelican-car.html'] };
function makeMessage(text: string, blocks: boolean, agent = 'claude'): Message {
  return {
    id: agent, conversation_id: 'html-chat', role: 'assistant', content: text,
    artifacts_json: JSON.stringify({ agent_id: agent }), created_at: '2026-10-20T01:00:00Z',
    status: 'complete', ...(blocks ? { blocks_json: JSON.stringify([{ index: 0, kind: 'text', text }]) } : {}),
  };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { useMessageStore.setState({ messages: {} }); vi.unstubAllGlobals(); });

it.each([true, false])('opens local HTML Markdown links without raw HTTP navigation (blocks=%s)', async blocks => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MessageBubble message={makeMessage(`[打开动画](${path})`, blocks)} />));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === '打开动画');
    expect(button).toBeDefined();
    expect(container.querySelector(`a[href="${path}"]`)).toBeNull();
    await act(async () => button!.click());
    expect(container.querySelector('[data-testid="html-preview"]')?.textContent).toContain('"agentId":"claude"');
    expect(container.querySelector('[data-testid="html-preview"]')?.textContent).toContain(path);
  } finally { act(() => root.unmount()); container.remove(); }
});

it.each([true, false])('opens Claude inline-code HTML paths (blocks=%s)', async blocks => {
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<MessageBubble message={makeMessage(`交付文件：\`${path}\``, blocks)} />));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === path);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(container.querySelector('[data-testid="html-preview"]')).not.toBeNull();
  } finally { act(() => root.unmount()); }
});

it('routes an orchestrator summary to the exact originating agent, not the orchestrator machine', async () => {
  const source = { ...makeMessage('', false), cards: [card] } as Message;
  useMessageStore.setState({ messages: { 'html-chat': [source] } });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<MessageBubble message={makeMessage(`[打开动画](${path})`, true, 'codex')} />));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === '打开动画');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(container.querySelector('[data-testid="html-preview"]')?.textContent).toContain('"agentId":"claude"');
  } finally { act(() => root.unmount()); }
});
