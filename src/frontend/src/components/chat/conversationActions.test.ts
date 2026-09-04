import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/message';
import {
  conversationToMarkdown,
  isCompletedAssistantMessage,
  messageText,
  forkConversationFromMessage,
  forkConversationFromLatest,
  hasExportableMessage,
  loadCompleteConversation,
  waitForForkableCheckpoint,
} from './conversationActions';
import type { ConversationCheckpoint, CreateCheckpointRequest } from '@/types/context';

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-1',
    conversation_id: 'conversation-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? '',
    artifacts_json: overrides.artifacts_json ?? null,
    created_at: overrides.created_at ?? '2026-08-28T08:00:00Z',
    ...overrides,
  };
}

describe('message-level Agent actions', () => {
  it('reads displayed text blocks instead of stale message.content', () => {
    const message = createMessage({
      role: 'assistant',
      content: 'stale text',
      blocks: [
        { index: 0, kind: 'thinking', text: 'private reasoning' },
        { index: 1, kind: 'text', text: 'fresh answer' },
      ],
    });
    expect(messageText(message)).toBe('fresh answer');
  });

  it('allows footer actions only on completed assistant replies', () => {
    expect(isCompletedAssistantMessage(createMessage({ role: 'assistant', status: 'complete' }))).toBe(true);
    expect(isCompletedAssistantMessage(createMessage({ role: 'assistant', status: 'error' }))).toBe(false);
    expect(isCompletedAssistantMessage(createMessage({ role: 'user', status: 'complete' }))).toBe(false);
  });
});

describe('conversationToMarkdown', () => {
  it('exports completed messages in chronological order and omits streaming placeholders', () => {
    const markdown = conversationToMarkdown('价格分析', [
      createMessage({
        id: 'assistant',
        role: 'assistant',
        content: '这是分析结果。',
        artifacts_json: JSON.stringify({ agent_name: '数据分析 Agent' }),
        created_at: '2026-08-28T08:02:00Z',
        attachments: [{
          id: 'attachment-1',
          message_id: 'assistant',
          file_name: 'analysis.csv',
          mime_type: 'text/csv',
          file_size: 128,
          file_path: '/analysis.csv',
          thumbnail_path: null,
          width: null,
          height: null,
          created_at: '2026-08-28T08:02:00Z',
        }],
      }),
      createMessage({
        id: 'user',
        role: 'user',
        username: '小王',
        content: '帮我分析价格。 {{xiaowang/价格知识库}}',
        created_at: '2026-08-28T08:01:00Z',
      }),
      createMessage({
        id: 'streaming',
        role: 'assistant',
        content: '还在生成',
        status: 'streaming',
        created_at: '2026-08-28T08:03:00Z',
      }),
    ]);

    expect(markdown).toBe([
      '# 价格分析',
      '',
      '## 用户 · 小王',
      '',
      '帮我分析价格。',
      '',
      '## 助手 · 数据分析 Agent',
      '',
      '这是分析结果。',
      '',
      '附件：',
      '- analysis.csv',
    ].join('\n'));
  });

  it('keeps visible text from block-based assistant messages', () => {
    const markdown = conversationToMarkdown('Block 对话', [
      createMessage({
        role: 'assistant',
        content: '',
        blocks: [
          { index: 0, kind: 'thinking', text: '内部思考' },
          { index: 1, kind: 'text', text: '最终回答' },
        ],
      }),
    ]);

    expect(markdown).toContain('最终回答');
    expect(markdown).not.toContain('内部思考');
    expect(hasExportableMessage(createMessage({
      role: 'assistant',
      content: '',
      blocks: [{ index: 0, kind: 'text', text: '最终回答' }],
    }))).toBe(true);
  });

  it('uses block text when persisted content differs from the visible block rendering', () => {
    const markdown = conversationToMarkdown('Block 优先', [
      createMessage({
        role: 'assistant',
        content: '旧正文',
        blocks: [{ index: 0, kind: 'text', text: '页面可见正文' }],
      }),
    ]);

    expect(markdown).toContain('页面可见正文');
    expect(markdown).not.toContain('旧正文');
  });
});

describe('loadCompleteConversation', () => {
  it('loads older pages and returns a de-duplicated chronological transcript', async () => {
    const newest = createMessage({ id: 'newest', created_at: '2026-08-28T08:03:00Z' });
    const middle = createMessage({ id: 'middle', created_at: '2026-08-28T08:02:00Z' });
    const oldest = createMessage({ id: 'oldest', created_at: '2026-08-28T08:01:00Z' });
    const loadPage = async (_conversationId: string, before?: string) => {
      if (!before) return [newest, middle];
      return [middle, oldest];
    };

    const messages = await loadCompleteConversation('conversation-1', loadPage, 2);

    expect(messages.map((message) => message.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('keeps paging after a short filtered page until the server returns no messages', async () => {
    const newest = createMessage({ id: 'newest', created_at: '2026-08-28T08:03:00Z' });
    const middle = createMessage({ id: 'middle', created_at: '2026-08-28T08:02:00Z' });
    const oldest = createMessage({ id: 'oldest', created_at: '2026-08-28T08:01:00Z' });
    const loadPage = async (_conversationId: string, before?: string) => {
      if (!before) return [newest, middle];
      if (before === middle.created_at) return [oldest];
      return [];
    };

    const messages = await loadCompleteConversation('conversation-1', loadPage, 3);

    expect(messages.map((message) => message.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('preserves sub-millisecond RFC3339 ordering when selecting the next cursor', async () => {
    const later = createMessage({ id: 'later', created_at: '2026-08-28T08:00:00.000900Z' });
    const earlier = createMessage({ id: 'earlier', created_at: '2026-08-28T08:00:00.000100Z' });
    const cursors: Array<string | undefined> = [];
    const loadPage = async (_conversationId: string, before?: string) => {
      cursors.push(before);
      return before ? [] : [later, earlier];
    };

    const messages = await loadCompleteConversation('conversation-1', loadPage, 2);

    expect(cursors).toEqual([undefined, earlier.created_at]);
    expect(messages.map((message) => message.id)).toEqual(['earlier', 'later']);
  });
});

describe('waitForForkableCheckpoint', () => {
  it('polls a generating checkpoint until the backend marks it ready', async () => {
    const generating: ConversationCheckpoint = {
      id: 'checkpoint-1',
      conversation_id: 'conversation-1',
      source_agent_id: 'agent-1',
      generation: 1,
      markdown_content: '',
      scope: 'conversation_shared',
      status: 'generating',
      created_at: '2026-08-28T08:00:00Z',
    };
    const ready = { ...generating, status: 'ready' as const, markdown_content: '# Context' };
    let reads = 0;

    const result = await waitForForkableCheckpoint(
      'conversation-1',
      generating,
      async () => {
        reads += 1;
        return ready;
      },
      { intervalMs: 0, maxAttempts: 2 },
    );

    expect(result).toEqual(ready);
    expect(reads).toBe(1);
  });

  it('stops with a recoverable error when checkpoint generation times out', async () => {
    const generating: ConversationCheckpoint = {
      id: 'checkpoint-1',
      conversation_id: 'conversation-1',
      source_agent_id: 'agent-1',
      generation: 1,
      markdown_content: '',
      scope: 'conversation_shared',
      status: 'generating',
      created_at: '2026-08-28T08:00:00Z',
    };

    await expect(waitForForkableCheckpoint(
      'conversation-1',
      generating,
      async () => generating,
      { intervalMs: 0, maxAttempts: 1 },
    )).rejects.toThrow('检查点仍在生成，请稍后重试');
  });

  it('does not attempt to poll a terminal failed checkpoint', async () => {
    const readCheckpoint = async () => {
      throw new Error('should not read');
    };
    const failed: ConversationCheckpoint = {
      id: 'checkpoint-1',
      conversation_id: 'conversation-1',
      source_agent_id: 'agent-1',
      generation: 1,
      markdown_content: '',
      scope: 'conversation_shared',
      status: 'failed',
      created_at: '2026-08-28T08:00:00Z',
    };

    await expect(waitForForkableCheckpoint(
      'conversation-1',
      failed,
      readCheckpoint,
      { intervalMs: 0, maxAttempts: 1 },
    )).rejects.toThrow('检查点生成失败，无法创建 Fork');
  });
});

describe('forkConversationFromLatest', () => {
  it('creates a fresh checkpoint before creating the independent conversation', async () => {
    const generating: ConversationCheckpoint = {
      id: 'checkpoint-1',
      conversation_id: 'conversation-1',
      source_agent_id: 'agent-1',
      generation: 1,
      markdown_content: '',
      scope: 'conversation_shared',
      status: 'generating',
      created_at: '2026-08-28T08:00:00Z',
    };
    const ready = { ...generating, status: 'ready' as const, markdown_content: '# Context' };
    const calls: string[] = [];

    await forkConversationFromLatest(
      { conversationId: 'conversation-1', agentId: 'agent-1' },
      {
        createCheckpoint: async () => {
          calls.push('checkpoint:create');
          return generating;
        },
        readCheckpoint: async () => {
          calls.push('checkpoint:read');
          return ready;
        },
        createFork: async (_conversationId, request) => {
          calls.push(`fork:${request.checkpoint_id}`);
        },
      },
      { intervalMs: 0, maxAttempts: 2 },
    );

    expect(calls).toEqual(['checkpoint:create', 'checkpoint:read', 'fork:checkpoint-1']);
  });
});

describe('forkConversationFromMessage', () => {
  it('pins the checkpoint boundary to the selected agent response', async () => {
    const ready: ConversationCheckpoint = {
      id: 'checkpoint-message',
      conversation_id: 'conversation-1',
      source_agent_id: 'agent-1',
      generation: 1,
      source_to_message_id: 'message-9',
      markdown_content: '# Context',
      scope: 'conversation_shared',
      status: 'ready',
      created_at: '2026-09-04T08:00:00Z',
    };
    let checkpointRequest: CreateCheckpointRequest | undefined;

    await forkConversationFromMessage(
      { conversationId: 'conversation-1', messageId: 'message-9', agentId: 'agent-1' },
      {
        createCheckpoint: async (_conversationId, request) => {
          checkpointRequest = request;
          return ready;
        },
        readCheckpoint: async () => ready,
        createFork: async () => undefined,
      },
    );

    expect(checkpointRequest).toEqual({
      agent_id: 'agent-1',
      scope: 'conversation_shared',
      source_to_message_id: 'message-9',
    });
  });
});
