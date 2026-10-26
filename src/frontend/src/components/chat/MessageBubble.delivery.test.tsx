// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/message';
import { MessageBubble } from './MessageBubble';

const userMessage: Message = {
  id: 'follow-up', conversation_id: 'group', role: 'user', content: '@Codex 按城市分组',
  artifacts_json: null, created_at: '2026-10-19T08:10:38Z',
};

describe('follow-up delivery in chat history', () => {
  it.each([
    ['sending', '引导中'], ['steered', '已引导'], ['queued', '排队中'],
    ['running', '已发送'], ['unconfirmed', '未确认'],
  ])('shows persisted %s status without changing the sent text', (status, label) => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<MessageBubble isOwn message={{
      ...userMessage,
      artifacts_json: JSON.stringify({ delivery: { status, agent_id: 'codex', updated_at: 1 } }),
    }} />);
    expect(container.querySelector('[aria-label="指令状态"]')?.textContent).toBe(label);
    expect(container.textContent).toContain('@Codex 按城市分组');
    expect(container.querySelector('[aria-label="停止生成"]')).toBeNull();
  });

  it.each([null, '{broken', JSON.stringify({ delivery: { status: 'unknown' } })])('leaves ordinary or unsupported metadata unobtrusive', artifacts_json => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<MessageBubble message={{ ...userMessage, artifacts_json }} />);
    expect(container.querySelector('[aria-label="指令状态"]')).toBeNull();
  });
});
