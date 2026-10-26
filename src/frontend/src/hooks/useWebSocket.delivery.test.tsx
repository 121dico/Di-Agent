// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '@/store/authStore';
import { useConversationStore } from '@/store/conversationStore';
import { useMessageStore } from '@/store/messageStore';
import { useWsStore } from '@/store/wsStore';
import { MessageBubble } from '@/components/chat/MessageBubble';

it('shows a live delivery receipt that arrived before the message without affecting another chat', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  let socket: FakeSocket | undefined;
  class FakeSocket {
    onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; }
    close() {}
    send() {}
    emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  useAuthStore.setState({ isAuthenticated: true, token: 'test-token' });
  useConversationStore.setState({ activeConversationId: 'group' });
  useMessageStore.setState({ messages: {}, pendingDeliveries: {} });
  function Chat() {
    useWebSocket();
    const message = useMessageStore(state => state.messages.group?.[0]);
    return message ? <MessageBubble isOwn message={message} /> : null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Chat />));
    await act(async () => socket!.emit({ type: 'message.delivery', data: {
      conversation_id: 'group', message_id: 'follow-up',
      delivery: { status: 'steered', agent_id: 'codex', updated_at: 2 },
    } }));
    await act(async () => socket!.emit({ type: 'message.complete', data: {
      id: 'follow-up', conversation_id: 'group', role: 'user', content: '@Codex 按城市分组',
      artifacts_json: JSON.stringify({ delivery: { status: 'sending', agent_id: 'codex', updated_at: 1 } }),
    } }));
    expect(container.querySelector('[aria-label="指令状态"]')?.textContent).toBe('已引导');
    await act(async () => socket!.emit({ type: 'message.delivery', data: {
      conversation_id: 'other', message_id: 'follow-up',
      delivery: { status: 'unconfirmed', agent_id: 'codex', updated_at: 3 },
    } }));
    expect(container.querySelector('[aria-label="指令状态"]')?.textContent).toBe('已引导');
    expect(container.textContent).toContain('@Codex 按城市分组');
  } finally {
    await act(async () => root.unmount());
    useWsStore.getState().disconnect();
    useAuthStore.setState({ isAuthenticated: false, token: null });
    container.remove(); vi.unstubAllGlobals();
  }
});
