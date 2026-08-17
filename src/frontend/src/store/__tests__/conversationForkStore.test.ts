// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/conversation';
import type { ConversationForkResult } from '@/types/context';

vi.mock('@/api/conversation', () => ({
  getConversations: vi.fn(),
}));
vi.mock('@/api/context', () => ({
  forkConversation: vi.fn(),
}));

import * as conversationApi from '@/api/conversation';
import * as contextApi from '@/api/context';
import { resetConversationStore, useConversationStore } from '../conversationStore';

const child: Conversation = {
  id: 'child-1',
  user_id: 'user-1',
  type: 'agent',
  title: '任务 · Fork',
  pinned: false,
  created_at: '2026-07-17T00:00:00Z',
  updated_at: '2026-07-17T00:00:00Z',
};

describe('conversation fork store', () => {
  beforeEach(() => {
    resetConversationStore();
    vi.clearAllMocks();
  });

  it('opens the child conversation and rejects an older list response', async () => {
    let resolveOldList: (items: Conversation[]) => void = () => {};
    vi.mocked(conversationApi.getConversations).mockImplementationOnce(
      () => new Promise<Conversation[]>((resolve) => { resolveOldList = resolve; }),
    );
    vi.mocked(contextApi.forkConversation).mockResolvedValue({
      conversation: child,
      fork: {
        child_conversation_id: child.id,
        parent_conversation_id: 'parent-1',
        checkpoint_id: 'checkpoint-1',
        forked_from_message_id: 'message-1',
        source_agent_id: 'agent-1',
        target_agent_id: 'agent-1',
        created_by: 'user-1',
        created_at: child.created_at,
      },
      session: {
        conversation_id: child.id,
        agent_id: 'agent-1',
        generation: 1,
        active_context_tokens: 100,
        context_window_tokens: 128000,
        usage_ratio: 0.001,
        status: 'normal',
        source: 'estimated',
        compaction_count: 0,
      },
    } satisfies ConversationForkResult);

    const oldFetch = useConversationStore.getState().fetchConversations();
    await useConversationStore.getState().forkConversation('parent-1', {
      checkpoint_id: 'checkpoint-1',
      agent_id: 'agent-1',
    });
    resolveOldList([]);
    await oldFetch;

    expect(useConversationStore.getState().activeConversationId).toBe(child.id);
    expect(useConversationStore.getState().conversations.map((item) => item.id)).toEqual([child.id]);
    expect(localStorage.getItem('agenthub_active_conv')).toBe(child.id);
  });
});
