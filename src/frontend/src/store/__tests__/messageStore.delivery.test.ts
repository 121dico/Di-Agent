// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types/message';
import { useMessageStore } from '../messageStore';

const followUp: Message = { id: 'follow-up', conversation_id: 'group', role: 'user', content: '改成城市分组', artifacts_json: null, created_at: '2026-10-19T08:00:00Z' };
beforeEach(() => { useMessageStore.setState({ messages: {}, pendingDeliveries: {} }); vi.restoreAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe('follow-up delivery updates', () => {
  it('keeps a confirmed delivery when the original HTTP response arrives later', () => {
    const store = useMessageStore.getState();
    store.addMessage('group', followUp);
    store.updateDelivery('group', 'follow-up', { status: 'steered', agent_id: 'codex', updated_at: 2 });
    store.addMessage('group', { ...followUp, artifacts_json: JSON.stringify({ delivery: { status: 'sending', agent_id: 'codex', updated_at: 1 } }) });
    const received = useMessageStore.getState().messages.group![0]!;
    expect(JSON.parse(received.artifacts_json!).delivery.status).toBe('steered');
    expect(received.content).toBe('改成城市分组');
  });
  it('keeps the newer receipt across a history refresh and never copies it to another conversation', async () => {
    const store = useMessageStore.getState();
    store.addMessage('group', followUp);
    store.updateDelivery('group', 'follow-up', { status: 'steered', agent_id: 'codex', updated_at: 2 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: [followUp] }))));
    await store.fetchMessages('group');
    expect(JSON.parse(useMessageStore.getState().messages.group![0]!.artifacts_json!).delivery.status).toBe('steered');
    store.addMessage('other', { ...followUp, conversation_id: 'other' });
    expect(useMessageStore.getState().messages.other![0]!.artifacts_json).toBeNull();
    vi.unstubAllGlobals();
  });
});
