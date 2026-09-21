// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Conversation } from '@/types/conversation';
vi.mock('./client', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
import { get, post } from './client';
import { getArchivedConversations, getConversations, getOrCreateAgentChat } from './conversation';
import { resetConversationStore, useConversationStore } from '@/store/conversationStore';

const conversation = (id: string, title: string, type: Conversation['type'] = 'agent', peer_name?: string): Conversation => ({ id, title, type, peer_name, user_id: 'user', pinned: false, created_at: '', updated_at: '' });
const report = conversation('report', '报表agent');
const delivery = conversation('delivery', '投放agent');
const ordinary = conversation('normal', '普通助手');
const list = [report, delivery, ordinary, conversation('renamed', '旧标题', 'agent', '报表agent'), conversation('failed', '投放agent（旧环境鉴权失败）'), conversation('legacy', '投放分析', 'group'), conversation('same-title-group', '报表agent', 'group'), conversation('similar', '投放agent助手')];
beforeEach(() => { vi.clearAllMocks(); resetConversationStore(); vi.mocked(get).mockResolvedValue(list); });

it('keeps page conversations out of active and archived lists while retaining ordinary chats', async () => {
  const expected = ['normal', 'same-title-group', 'similar'];
  expect((await getConversations()).map((item) => item.id)).toEqual(expected);
  expect((await getArchivedConversations()).map((item) => item.id)).toEqual(expected);
  expect(await getConversations({ includePageAgents: true })).toEqual(list);
});
it('continues to return the original page conversation for its history', async () => {
  vi.mocked(post).mockResolvedValue(report);
  expect(await getOrCreateAgentChat('report-agent-id')).toBe(report);
  expect(post).toHaveBeenCalledWith('/api/conversations/agent', { agent_id: 'report-agent-id' });
});
it('clears a restored page conversation and prevents selecting it in messages', async () => {
  useConversationStore.getState().setActive('report');
  await useConversationStore.getState().fetchConversations();
  expect(useConversationStore.getState().activeConversationId).toBeNull();
  expect(localStorage.getItem('di_agent_active_conv')).toBeNull();
  expect(useConversationStore.getState().conversations.map((item) => item.id)).toEqual(['normal', 'same-title-group', 'similar']);
  useConversationStore.getState().setActive('delivery');
  expect(useConversationStore.getState().activeConversationId).toBeNull();
  useConversationStore.getState().setActive('normal');
  await useConversationStore.getState().fetchConversations();
  expect(useConversationStore.getState().activeConversationId).toBe('normal');
});
it('normalizes empty active and archived responses', async () => {
  vi.mocked(get).mockResolvedValue(null);
  expect(await getConversations()).toEqual([]);
  expect(await getArchivedConversations()).toEqual([]);
});
it('registers newly created page sessions immediately and keeps them hidden across list refreshes', async () => {
  const ids: string[] = [];
  const register = (event: Event) => {
    const id = (event as CustomEvent<string>).detail;
    ids.push(id);
    useConversationStore.getState().registerPageConversation(id);
  };
  window.addEventListener('page-agent-conversation', register);
  try {
    vi.mocked(post).mockResolvedValue(report);
    await getOrCreateAgentChat('report-agent-id');
    expect(ids).toEqual(['report']);
    vi.mocked(get).mockResolvedValue([ordinary]);
    await useConversationStore.getState().fetchConversations();
    expect(useConversationStore.getState().pageConversationIds.report).toBe(true);
    useConversationStore.getState().setActive('report');
    expect(useConversationStore.getState().activeConversationId).toBeNull();
  } finally { window.removeEventListener('page-agent-conversation', register); }
});
