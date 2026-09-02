// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/conversation';
import { ConversationItem } from './ConversationItem';

const conversation: Conversation = {
  id: 'conversation-1',
  user_id: 'user-1',
  type: 'group',
  title: '项目对话',
  pinned: false,
  created_at: '2026-08-28T08:00:00Z',
  updated_at: '2026-08-28T08:00:00Z',
};

describe('ConversationItem', () => {
  it('keeps the complete conversation summary in the rendered interface', () => {
    const summary = '给你做一个完整的番茄钟，带环形进度、专注统计和可恢复的会话状态';
    const markup = renderToStaticMarkup(
      <ConversationItem
        conversation={conversation}
        active={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onArchive={vi.fn()}
        lastMessage={summary}
      />,
    );

    expect(markup).toContain(summary);
    expect(markup).not.toContain('...');
  });
});
