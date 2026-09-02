// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/conversation';
import type { ConversationCheckpoint } from '@/types/context';
import type { Message } from '@/types/message';

const mocks = vi.hoisted(() => ({
  createCheckpoint: vi.fn(),
  readCheckpoint: vi.fn(),
  getMessages: vi.fn(),
  copyText: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/api/context', () => ({
  createConversationCheckpoint: mocks.createCheckpoint,
  getConversationCheckpoint: mocks.readCheckpoint,
}));
vi.mock('@/api/message', () => ({ getMessages: mocks.getMessages }));
vi.mock('@/utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('@/utils/message', () => ({
  message: { success: mocks.success, info: mocks.info, error: mocks.error },
}));

import { useConversationActions } from './useConversationActions';

const conversation: Conversation = {
  id: 'conversation-1',
  user_id: 'user-1',
  type: 'agent',
  title: '数据对话',
  pinned: false,
  peer_id: 'agent-1',
  created_at: '2026-08-28T08:00:00Z',
  updated_at: '2026-08-28T08:00:00Z',
};
const historyMessage: Message = {
  id: 'message-1',
  conversation_id: conversation.id,
  role: 'user',
  content: '分析这份数据',
  artifacts_json: null,
  created_at: '2026-08-28T08:01:00Z',
};
const readyCheckpoint: ConversationCheckpoint = {
  id: 'checkpoint-1',
  conversation_id: conversation.id,
  source_agent_id: 'agent-1',
  generation: 1,
  markdown_content: '# Context',
  scope: 'conversation_shared',
  status: 'ready',
  created_at: '2026-08-28T08:02:00Z',
};

type HookResult = ReturnType<typeof useConversationActions>;
let current: HookResult | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

function Harness({
  createFork,
  currentConversation = conversation,
}: {
  createFork: () => Promise<unknown>;
  currentConversation?: Conversation;
}) {
  current = useConversationActions({
    conversation: currentConversation,
    messages: [historyMessage],
    conversationAgents: [],
    isGenerating: false,
    createFork,
  });
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.getMessages.mockImplementation(async (_id: string, before?: string) => (
    before ? [] : [historyMessage]
  ));
  mocks.copyText.mockResolvedValue(undefined);
  mocks.createCheckpoint.mockResolvedValue(readyCheckpoint);
  mocks.readCheckpoint.mockResolvedValue(readyCheckpoint);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  current = undefined;
  vi.clearAllMocks();
});

describe('useConversationActions', () => {
  it('copies the full transcript and creates a real Fork through the supplied store action', async () => {
    const createFork = vi.fn().mockResolvedValue({});
    act(() => root?.render(<Harness createFork={createFork} />));

    await act(async () => current?.copyConversation());
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('分析这份数据'));
    expect(current?.copying).toBe(false);

    await act(async () => current?.forkConversation());
    expect(mocks.createCheckpoint).toHaveBeenCalledWith(conversation.id, {
      agent_id: 'agent-1',
      scope: 'conversation_shared',
    });
    expect(createFork).toHaveBeenCalledWith(conversation.id, {
      checkpoint_id: readyCheckpoint.id,
      agent_id: 'agent-1',
    });
    expect(current?.forking).toBe(false);
  });

  it('reports a Fork failure and restores the idle state', async () => {
    const createFork = vi.fn();
    mocks.createCheckpoint.mockRejectedValueOnce(new Error('checkpoint unavailable'));
    act(() => root?.render(<Harness createFork={createFork} />));

    await act(async () => current?.forkConversation());

    expect(mocks.error).toHaveBeenCalledWith('checkpoint unavailable');
    expect(createFork).not.toHaveBeenCalled();
    expect(current?.forking).toBe(false);
  });

  it('cancels a pending Fork if the user switches conversations', async () => {
    const createFork = vi.fn().mockResolvedValue({});
    let resolveCheckpoint: ((checkpoint: ConversationCheckpoint) => void) | undefined;
    mocks.createCheckpoint.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCheckpoint = resolve;
    }));
    act(() => root?.render(<Harness createFork={createFork} />));

    const pendingFork = current?.forkConversation();
    await act(async () => Promise.resolve());
    const nextConversation = {
      ...conversation,
      id: 'conversation-2',
      peer_id: 'agent-2',
      title: '另一个对话',
    };
    act(() => root?.render(
      <Harness createFork={createFork} currentConversation={nextConversation} />,
    ));
    await act(async () => {
      resolveCheckpoint?.(readyCheckpoint);
      await pendingFork;
    });

    expect(createFork).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('已切换对话，本次 Fork 已取消');
    expect(current?.forking).toBe(false);
  });
});
