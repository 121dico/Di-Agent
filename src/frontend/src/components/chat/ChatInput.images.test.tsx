// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';
import { useConversationStore } from '@/store/conversationStore';
import { useMessageStore } from '@/store/messageStore';
import { notifyConversationRoleChanged } from '@/store/wsStore';
import { invalidateMessageCache } from '@/hooks/useMessages';
import type { AttachmentPayload } from '@/types/attachment';
import { ChatWindow } from './ChatWindow';
import { MessageBubble } from './MessageBubble';
import { MemoryRouter } from 'react-router-dom';

const payload: AttachmentPayload = {
  file_name: 'image.png', mime_type: 'image/png', file_size: 3,
  file_path: 'uploads/image.png', thumbnail_path: null, width: 1, height: 1,
};
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
let container: HTMLDivElement;
let root: Root;
let uploads: File[];
let sends: Array<Record<string, unknown>>;
let uploadResponse: (file: File) => Promise<Response>;
let failSend: boolean;
let deferredSend: Promise<Response> | undefined;
let agentResponse: (url: string) => Promise<Response>;

async function render(conversationId = 'images-chat') {
  await act(async () => root.render(<ChatInput conversationId={conversationId} />));
}
function paste(files: File[], text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    getData: () => text,
  } });
  container.querySelector('textarea')!.dispatchEvent(event);
  return event;
}
const sendButton = () => container.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!;
async function typeText(content: string) {
  await act(async () => {
    const textarea = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, content);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  uploads = []; sends = []; failSend = false; deferredSend = undefined;
  agentResponse = async () => response([
    { agent_id: 'busy-agent', name: 'Codex', role: 'orchestrator' },
    { agent_id: 'other-agent', name: 'Claude', role: 'worker' },
  ]);
  uploadResponse = async () => response(payload);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/upload') {
      const file = (init?.body as FormData).get('file') as File;
      uploads.push(file);
      return uploadResponse(file);
    }
    if (url.endsWith('/messages') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      sends.push(body);
      if (deferredSend) return deferredSend;
      if (failSend) return new Response(JSON.stringify({ code: 1, message: 'Agent unavailable' }), { status: 400 });
      return response({ user_message: { id: 'sent-image', conversation_id: 'images-chat', role: 'user', content: body.content, created_at: new Date().toISOString() } });
    }
    if (url.endsWith('/agents') && init?.method === 'GET') return agentResponse(url);
    if (url.startsWith('/api/conversations?')) return response(useConversationStore.getState().conversations);
    return response([]);
  }));
  invalidateMessageCache();
  useMessageStore.setState({ messages: {}, optimisticMessages: {} });
  useConversationStore.setState({ directAgentChats: {}, conversations: ['images-chat', 'other-chat'].map(id => ({ id, user_id: 'user', type: 'agent', peer_id: 'vision-agent', title: id, pinned: false, created_at: '', updated_at: '' })) });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('ChatInput image input', () => {
  it('presents the group recipient selector before the message input', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    const selector = container.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]')!;
    const textarea = container.querySelector('textarea')!;
    expect(Boolean(selector.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
  it('keeps exactly one message list and composer through repeated group switches and updates', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    useConversationStore.setState(state => ({ activeConversationId: 'images-chat', conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await act(async () => root.render(<MemoryRouter><ChatWindow /></MemoryRouter>));
    for (const id of ['other-chat', 'images-chat', 'other-chat', 'images-chat']) {
      await act(async () => useConversationStore.setState({ activeConversationId: id }));
      await act(async () => notifyConversationRoleChanged({ conversationId: id, agentId: 'busy-agent', role: 'orchestrator', actorId: 'user' }));
      expect(container.querySelectorAll('[role="log"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-chat-composer="true"]')).toHaveLength(1);
      expect(container.querySelectorAll('textarea')).toHaveLength(1);
    }
    expect(errors.mock.calls.filter(call => call.some(value => String(value).includes('same key')))).toEqual([]);
  });
  it('keeps a newly selected recipient after A to B to A while the old A send finishes', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await act(async () => root.render(<ChatInput key="images-chat" conversationId="images-chat" />));
    let finish!: (result: Response) => void;
    deferredSend = new Promise(resolve => { finish = resolve; });
    await typeText('@Codex 开始');
    await act(async () => sendButton().click());
    await act(async () => root.render(<ChatInput key="other-chat" conversationId="other-chat" />));
    await act(async () => root.render(<ChatInput key="images-chat" conversationId="images-chat" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"][data-agent-id="other-agent"]')!.click());
    await act(async () => finish(response({ user_message: { id: 'done', conversation_id: 'images-chat', role: 'user', content: '@Codex 开始', created_at: '' } })));
    expect(container.textContent).toContain('正在和 Claude 对话');
    deferredSend = undefined;
    await typeText('继续当前对象');
    await act(async () => sendButton().click());
    expect(sends[1]?.content).toBe('@Claude 继续当前对象');
  });
  it('supports keyboard recipient options and returns focus to the picker on Escape', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]')!;
    await act(async () => trigger.click());
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    await act(async () => options[0]!.focus());
    await act(async () => options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(options[1]);
    await act(async () => options[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('uses the backend mention token boundary for a known Agent embedded in text', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    for (const content of ['请@Claude 看一下', '继续']) {
      await typeText(content);
      await act(async () => sendButton().click());
    }
    expect(sends.map(send => send.content)).toEqual(['请@Claude 看一下', '@Claude 继续']);
  });
  it('rejects a stale send-time membership response instead of routing to a removed Agent', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    let finish!: (result: Response) => void;
    agentResponse = async () => new Promise(resolve => { finish = resolve; });
    await typeText('保留原草稿');
    await act(async () => sendButton().click());
    agentResponse = async () => response([]);
    await act(async () => notifyConversationRoleChanged({ conversationId: 'images-chat', agentId: 'busy-agent', role: 'worker', actorId: 'user' }));
    await act(async () => finish(response([{ agent_id: 'busy-agent', name: 'Codex', role: 'worker' }])));
    expect(sends).toEqual([]);
    expect(container.querySelector('textarea')!.value).toBe('保留原草稿');
  });
  it('does not bind a first mentioned Agent after a newer membership response removes it', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    let finish!: (result: Response) => void;
    deferredSend = new Promise(resolve => { finish = resolve; });
    await typeText('@Codex 开始');
    await act(async () => sendButton().click());
    agentResponse = async () => response([]);
    await act(async () => notifyConversationRoleChanged({ conversationId: 'images-chat', agentId: 'busy-agent', role: 'worker', actorId: 'user' }));
    await act(async () => finish(response({ user_message: { id: 'done', conversation_id: 'images-chat', role: 'user', content: '@Codex 开始', created_at: '' } })));
    expect(container.querySelector('[aria-label="取消对话对象"]')).toBeNull();
  });
  it.each([
    ['同名', [{ agent_id: 'busy-agent', name: 'Codex', role: 'worker' }, { agent_id: 'other-agent', name: 'Co dex', role: 'worker' }], '群内存在同名 Agent'],
    ['特殊字符', [{ agent_id: 'busy-agent', name: 'Codex/test', role: 'worker' }], '名称包含暂不支持的字符'],
  ])('does not silently misroute a selected Agent with %s', async (_label, fixture, errorText) => {
    agentResponse = async () => response(fixture);
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    await typeText('不要发给错误的人');
    await act(async () => sendButton().click());
    expect(sends).toEqual([]);
    expect(container.querySelector('textarea')!.value).toBe('不要发给错误的人');
    expect(container.textContent).toContain(errorText);
  });
  it('tracks explicit punctuation-separated Agent mentions before the next plain message', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    for (const content of ['@Claude，请看看', '继续', '@Codex,@Claude 一起看看', '普通讨论']) {
      await typeText(content);
      await act(async () => sendButton().click());
    }
    expect(sends.map(send => send.content)).toEqual(['@Claude，请看看', '@Claude 继续', '@Codex,@Claude 一起看看', '普通讨论']);
  });
  it('continues the selected Agent when ordinary message text contains an email address', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    await typeText('请检查 test@example.com');
    await act(async () => sendButton().click());
    expect(sends[0]?.content).toBe('@Codex 请检查 test@example.com');
  });
  it('keeps each group recipient separate and ignores old membership responses', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent', 'other-chat': 'other-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    let completeOld!: (result: Response) => void;
    agentResponse = async url => url.includes('images-chat')
      ? new Promise(resolve => { completeOld = resolve; })
      : response([{ agent_id: 'other-agent', name: 'Claude', role: 'orchestrator' }]);
    await render();
    await render('other-chat');
    expect(container.textContent).toContain('正在和 Claude 对话');
    await act(async () => completeOld(response([{ agent_id: 'busy-agent', name: 'Codex', role: 'orchestrator' }])));
    expect(container.textContent).not.toContain('Codex');
    await typeText('继续第二群');
    await act(async () => sendButton().click());
    expect(sends[0]?.content).toBe('@Claude 继续第二群');
  });
  it('does not restore an old explicit recipient after the user clears it during a send', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    let complete!: (result: Response) => void;
    deferredSend = new Promise(resolve => { complete = resolve; });
    await typeText('@Claude 看看');
    await act(async () => sendButton().click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="取消对话对象"]')!.click());
    await act(async () => complete(response({ user_message: { id: 'done', conversation_id: 'images-chat', role: 'user', content: '@Claude 看看', created_at: '' } })));
    expect(container.textContent).not.toContain('正在和');
    deferredSend = undefined;
    await typeText('普通讨论');
    await act(async () => sendButton().click());
    expect(sends[1]?.content).toBe('普通讨论');
  });
  it('updates the Orcha heading and choices from a role event without confusing it with selected recipient', async () => {
    useConversationStore.setState(state => ({ activeConversationId: 'images-chat', directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await act(async () => root.render(<MemoryRouter><ChatWindow /></MemoryRouter>));
    agentResponse = async () => response([
      { agent_id: 'busy-agent', name: 'Codex', role: 'worker' },
      { agent_id: 'other-agent', name: 'Claude', role: 'orchestrator' },
    ]);
    await act(async () => notifyConversationRoleChanged({ conversationId: 'images-chat', agentId: 'other-agent', role: 'orchestrator', actorId: 'user' }));
    expect(container.querySelector('[data-testid="group-orcha"]')?.textContent).toBe('Orcha · Claude');
    expect(container.textContent).toContain('正在和 Codex 对话');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]')!.click());
    expect(container.querySelector('[role="option"][data-agent-id="busy-agent"]')?.textContent).not.toContain('Orcha');
    expect(container.querySelector('[role="option"][data-agent-id="other-agent"]')?.textContent).toContain('Orcha');
  });
  it('does not send to a removed selected member and keeps the draft', async () => {
    useConversationStore.setState(state => ({ directAgentChats: { 'images-chat': 'busy-agent' }, conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    expect(container.textContent).toContain('正在和 Codex 对话');
    agentResponse = async () => response([]);
    await typeText('给刚才的人');
    await act(async () => sendButton().click());
    expect(sends).toEqual([]);
    expect(container.querySelector('textarea')!.value).toBe('给刚才的人');
    expect(container.textContent).not.toContain('正在和 Codex 对话');
  });
  it('keeps explicit multi-Agent and human mentions independent of the sticky target', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    for (const content of ['@Codex 开始', '@Alice 你怎么看', '@Codex @Claude 一起处理', '大家继续']) {
      await typeText(content);
      await act(async () => sendButton().click());
    }
    expect(sends.map(send => send.content)).toEqual(['@Codex 开始', '@Alice 你怎么看', '@Codex @Claude 一起处理', '大家继续']);
    expect(container.textContent).not.toContain('正在和 Codex 对话');
  });
  it('labels the actual Orcha in the group heading and @ choices without changing inserted mention', async () => {
    useConversationStore.setState(state => ({ activeConversationId: 'images-chat', conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await act(async () => root.render(<MemoryRouter><ChatWindow /></MemoryRouter>));
    expect(container.querySelector('[data-testid="group-orcha"]')?.textContent).toBe('Orcha · Codex');
    await typeText('@');
    const codex = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('@Codex'))!;
    expect(codex.textContent).toContain('Orcha');
    await act(async () => codex.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(container.querySelector('textarea')!.value).toBe('@Codex ');
  });
  it('offers an independent group recipient selector with the real Orcha and clears to ordinary chat', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    const selector = container.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]');
    expect(selector).not.toBeNull();
    await act(async () => selector!.click());
    const codex = container.querySelector<HTMLButtonElement>('[role="option"][data-agent-id="busy-agent"]')!;
    expect(codex.textContent).toContain('Orcha');
    await act(async () => codex.click());
    expect(container.textContent).toContain('正在和 Codex 对话');
    await typeText('不需要手动提及');
    await act(async () => sendButton().click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="取消对话对象"]')!.click());
    await typeText('大家讨论');
    await act(async () => sendButton().click());
    expect(sends.map(send => send.content)).toEqual(['@Codex 不需要手动提及', '大家讨论']);
  });
  it('continues the selected group Agent through normal mention routing after one explicit mention', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(c => ({ ...c, type: 'group' })) }));
    await render();
    for (const content of ['@Codex 第一步', '补充要求']) {
      await act(async () => {
        const textarea = container.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, content);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => sendButton().click());
    }
    expect(sends.map(send => send.content)).toEqual(['@Codex 第一步', '@Codex 补充要求']);
    expect(sends.every(send => send.agent_id === undefined)).toBe(true);
  });
  it('lets the user send successive follow-ups while the Agent reply is streaming', async () => {
    await render();
    await act(async () => useMessageStore.setState({ messages: { 'images-chat': [{
      id: 'active-reply', conversation_id: 'images-chat', role: 'assistant', content: '',
      artifacts_json: null, created_at: '', status: 'streaming',
    }] } }));
    const type = (value: string) => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => type('先看单城市的数据'));
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    await act(async () => type('再按档位分组'));
    await act(async () => sendButton().click());
    expect(sends.map(send => send.content)).toEqual(['先看单城市的数据', '再按档位分组']);
    expect(container.querySelector('textarea')!.value).toBe('');
  });
  it('keeps ordinary group chat and @ another Agent available without changing mention text', async () => {
    useConversationStore.setState(state => ({ conversations: state.conversations.map(conversation => ({ ...conversation, type: 'group' })) }));
    await render();
    await act(async () => useMessageStore.setState({ messages: { 'images-chat': [{
      id: 'active-reply', conversation_id: 'images-chat', role: 'assistant', content: '',
      artifacts_json: JSON.stringify({ agent_id: 'busy-agent', agent_name: 'Codex' }), created_at: '', status: 'streaming',
    }] } }));
    const type = (value: string) => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (const content of ['大家先讨论一下', '@Claude 帮我核对一下', '@Codex 先停下这个方向']) {
      await act(async () => type(content));
      await act(async () => sendButton().click());
    }
    expect(sends.map(send => send.content)).toEqual(['大家先讨论一下', '@Claude 帮我核对一下', '@Codex 先停下这个方向']);
    expect(sends.every(send => send.agent_id === undefined)).toBe(true);
  });
  it('does not duplicate a message when Send is clicked twice before the request settles', async () => {
    await render();
    await act(async () => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '只发一次');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { sendButton().click(); sendButton().click(); });
    expect(sends.map(send => send.content)).toEqual(['只发一次']);
  });
  it('keeps the current reply stop button separate from sending a follow-up', async () => {
    await act(async () => root.render(<>
      <MessageBubble message={{ id: 'active-reply', conversation_id: 'images-chat', role: 'assistant',
        content: '', artifacts_json: null, created_at: '', status: 'streaming', task_id: 'current-task' }} />
      <ChatInput conversationId="images-chat" />
    </>));
    await act(async () => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '补充一个限制');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
    await act(async () => sendButton().click());
    expect(sends[0]?.content).toBe('补充一个限制');
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
  });
  it('keeps all restored images but requires removal when merged drafts exceed the image cap', async () => {
    await render();
    await act(async () => paste(Array.from({ length: 4 }, (_, i) => new File(['png'], `old${i}.png`, { type: 'image/png' }))));
    let rejectSend!: (response: Response) => void;
    deferredSend = new Promise(resolve => { rejectSend = resolve; });
    await act(async () => sendButton().click());
    await act(async () => paste([new File(['png'], 'new.png', { type: 'image/png' })]));
    await act(async () => rejectSend(new Response(JSON.stringify({ code: 1 }), { status: 400 })));
    expect(container.querySelectorAll('img')).toHaveLength(5);
    expect(container.textContent).toContain('最多 4 张');
    expect(sendButton().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 new.png"]')!.click());
    expect(sendButton().disabled).toBe(false);
  });
  it('merges the failed send with text and images added while that request was pending', async () => {
    await render();
    const type = (value: string) => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    uploadResponse = async file => response({ ...payload, file_name: file.name, file_path: `uploads/${file.name}` });
    await act(async () => { type('first question'); paste([new File(['a'], 'first.png', { type: 'image/png' })]); });
    let rejectSend!: (response: Response) => void;
    deferredSend = new Promise(resolve => { rejectSend = resolve; });
    await act(async () => sendButton().click());
    await act(async () => { type('next question'); paste([new File(['b'], 'next.png', { type: 'image/png' })]); });
    await act(async () => rejectSend(new Response(JSON.stringify({ code: 1, message: 'Agent unavailable' }), { status: 400 })));
    expect(container.querySelector('textarea')!.value).toBe('first question\n\nnext question');
    expect(container.querySelector('img[alt="first.png"]')).not.toBeNull();
    expect(container.querySelector('img[alt="next.png"]')).not.toBeNull();
    deferredSend = undefined;
    await act(async () => sendButton().click());
    expect(sends[1]).toMatchObject({ content: 'first question\n\nnext question', attachments: [
      { ...payload, file_name: 'first.png', file_path: 'uploads/first.png' },
      { ...payload, file_name: 'next.png', file_path: 'uploads/next.png' },
    ] });
  });
  it('reads clipboard image items when files is empty, and retains an image when sending fails', async () => {
    await render();
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } });
    await act(async () => container.querySelector('textarea')!.dispatchEvent(event));
    expect(uploads).toEqual([file]);
    failSend = true;
    await act(async () => sendButton().click());
    expect(container.textContent).toContain('发送失败，草稿和附件已保留');
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    failSend = false;
    await act(async () => sendButton().click());
    expect(sends[1]).toMatchObject({ attachments: [payload] });
  });
  it('explains unsupported images and the Agent image limits instead of uploading unusable images', async () => {
    await render();
    await act(async () => paste([new File(['svg'], 'diagram.svg', { type: 'image/svg+xml' })]));
    expect(uploads).toHaveLength(0);
    expect(container.textContent).toContain('PNG、JPEG、GIF 或 WebP');
    await act(async () => paste([new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]));
    expect(uploads).toHaveLength(0);
    expect(container.textContent).toContain('4MiB');
    await act(async () => {
      paste([new File(['a'], 'a.png', { type: 'image/png' })]);
      paste(Array.from({ length: 4 }, (_, i) => new File(['b'], `b${i}.png`, { type: 'image/png' })));
    });
    expect(uploads).toHaveLength(1);
    expect(container.textContent).toContain('最多 4 张');
  });
  it('drops an image on the actual chat window and previews it before an explicit send', async () => {
    useConversationStore.setState({ activeConversationId: 'images-chat' });
    await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ChatWindow /></MemoryRouter>));
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [new File(['png'], 'image.png', { type: 'image/png' })] } });
    await act(async () => container.firstElementChild!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    expect(sends).toEqual([]);
    await act(async () => sendButton().click());
    expect(sends[0]).toMatchObject({ attachments: [payload], agent_id: 'vision-agent' });
  });
  it('does not mix same-name uploads or carry images into a different conversation', async () => {
    const complete: Array<(response: Response) => void> = [];
    uploadResponse = () => new Promise(resolve => complete.push(resolve));
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    await render();
    await act(async () => {
      paste([new File(['one'], 'image.png', { type: 'image/png' })]);
      paste([new File(['two'], 'image.png', { type: 'image/png' })]);
    });
    await act(async () => {
      complete[1]!(response({ ...payload, file_path: 'uploads/two.png' }));
      complete[0]!(response({ ...payload, file_path: 'uploads/one.png' }));
    });
    await act(async () => sendButton().click());
    expect(sends[0]!.attachments).toEqual([
      { ...payload, file_path: 'uploads/one.png' },
      { ...payload, file_path: 'uploads/two.png' },
    ]);
    await act(async () => { paste([new File(['old'], 'old.png', { type: 'image/png' })]); });
    await render('other-chat');
    await act(async () => complete[2]!(response({ ...payload, file_name: 'old.png' })));
    expect(container.querySelector('img')).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });
  it('preserves normal text paste and does not upload or prevent it', async () => {
    await render();
    act(() => { expect(paste([], 'hello').defaultPrevented).toBe(false); });
    expect(uploads).toEqual([]);
  });

  it('keeps incomplete or failed images attached and blocks Enter until they are removed', async () => {
    let finish!: (response: Response) => void;
    uploadResponse = () => new Promise(resolve => { finish = resolve; });
    await render();
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'describe this');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      paste([new File(['png'], 'image.png', { type: 'image/png' })]);
    });
    expect(sendButton().disabled).toBe(true);
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(sends).toEqual([]);
    await act(async () => finish(new Response(JSON.stringify({ code: 1, message: 'unsupported' }), { status: 400 })));
    expect(container.textContent).toContain('上传失败');
    expect(sendButton().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 image.png"]')!.click());
    expect(sendButton().disabled).toBe(false);
  });
  it('pastes an image, previews it without sending and sends its uploaded attachment to the Agent', async () => {
    await render();
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    let event!: Event;
    await act(async () => { event = paste([file]); });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toBe(file);
    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    expect(sends).toEqual([]);
    await act(async () => sendButton().click());
    expect(sends).toEqual([expect.objectContaining({ content: '', agent_id: 'vision-agent', attachments: [payload] })]);
  });
});
