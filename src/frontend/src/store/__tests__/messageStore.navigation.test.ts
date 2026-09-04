// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types/message';

const mocks = vi.hoisted(() => ({
  getMessages: vi.fn(),
}));

vi.mock('@/api/message', () => ({
  getMessages: mocks.getMessages,
}));

import { useMessageStore } from '../messageStore';

const conversationId = 'conversation-1';
const streamingMessage: Message = {
  id: 'message-1',
  conversation_id: conversationId,
  role: 'assistant',
  content: '已经渲染到一半的回复',
  artifacts_json: '{"agent_name":"Codex"}',
  created_at: '2026-09-04T08:00:00Z',
  status: 'streaming',
  username: 'Codex',
  blocks: [{ index: 0, kind: 'text', text: '已经渲染到一半的回复' }],
};

function resetStore(messages: Message[]): void {
  useMessageStore.setState({
    messages: { [conversationId]: messages },
    streamingTaskIds: {},
    hasMore: {},
    loading: {},
    optimisticMessages: {},
    unreadCounts: {},
    readConversations: {},
  });
}

describe('messageStore navigation refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore([streamingMessage]);
  });

  it('preserves rendered deltas when the server still returns an empty streaming placeholder', async () => {
    mocks.getMessages.mockResolvedValueOnce([{
      ...streamingMessage,
      content: '',
      blocks: undefined,
      blocks_json: null,
      username: undefined,
    }]);

    await useMessageStore.getState().fetchMessages(conversationId);

    const refreshed = useMessageStore.getState().messages[conversationId]?.[0];
    expect(refreshed?.content).toBe(streamingMessage.content);
    expect(refreshed?.blocks).toEqual(streamingMessage.blocks);
    expect(refreshed?.username).toBe(streamingMessage.username);
    expect(useMessageStore.getState().loading[conversationId]).toBe(false);
  });

  it('keeps a local streaming message that is temporarily absent from the first server page', async () => {
    const earlierMessage: Message = {
      id: 'message-0',
      conversation_id: conversationId,
      role: 'user',
      content: '开始分析',
      artifacts_json: null,
      created_at: '2026-09-04T07:59:00Z',
      status: 'complete',
    };
    mocks.getMessages.mockResolvedValueOnce([earlierMessage]);

    await useMessageStore.getState().fetchMessages(conversationId);

    expect(useMessageStore.getState().messages[conversationId]).toEqual([
      earlierMessage,
      streamingMessage,
    ]);
  });

  it('uses the terminal server message instead of stale local streaming data', async () => {
    const finalBlocks = [{ index: 0, kind: 'text' as const, text: '完整回复' }];
    const completedMessage: Message = {
      ...streamingMessage,
      content: '完整回复',
      blocks: undefined,
      blocks_json: JSON.stringify(finalBlocks),
      status: 'complete',
    };
    mocks.getMessages.mockResolvedValueOnce([completedMessage]);

    await useMessageStore.getState().fetchMessages(conversationId);

    const refreshed = useMessageStore.getState().messages[conversationId]?.[0];
    expect(refreshed).toEqual(completedMessage);
    expect(refreshed?.content).not.toBe(streamingMessage.content);
    expect(refreshed?.blocks).toBeUndefined();
  });
});
