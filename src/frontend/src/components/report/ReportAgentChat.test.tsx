// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, post, put } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { resetMessageStore, useMessageStore } from '@/store/messageStore';
import { useWsStore } from '@/store/wsStore';
import { ReportAgentChat } from './ReportAgentChat';

vi.mock('@/api/client', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(), getAuthHeaders: vi.fn(), ApiError: class extends Error {} }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const agent = { id: 'report-agent', name: '报表agent', user_id: 'report-user', status: 'online', machine_id: 'machine', cli_tool: 'claude' };
const context = { reportName: '价敏用户报表', dataDate: '2026-09-19', dateRange: '2026-09-01 → 2026-09-19', cities: ['北京'], summary: '聚合人数：100' };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  resetMessageStore();
  useAuthStore.setState({ user: { id: 'report-user' } as never, token: 'report-token', isAuthenticated: true });
  useWsStore.setState({ status: 'connected', agentTyping: {} });
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/api/agents') return [agent];
    if (path.endsWith('/blackboard')) return { manual_context: '保留我的备注' };
    return [];
  });
  vi.mocked(put).mockResolvedValue({});
  vi.mocked(post).mockImplementation(async (path) => path === '/api/conversations/agent'
    ? { id: 'report-chat', type: 'agent' }
    : { user_message: { id: 'user-question', conversation_id: 'report-chat', content: '解释一下', role: 'user', created_at: new Date().toISOString() } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('报表浮窗对话', () => {
  it('隐藏时初始化不抢焦点，重新打开聚焦输入，切换报表保留现有焦点', async () => {
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat active={false} context={context} onClose={() => {}} /></MemoryRouter>); });
    expect(container.textContent).not.toContain('陪你读懂每一份报表');
    const input = container.querySelector('textarea')!;
    expect(document.activeElement).not.toBe(input);
    act(() => { root.render(<MemoryRouter><ReportAgentChat active context={context} onClose={() => {}} /></MemoryRouter>); });
    expect(document.activeElement).toBe(input);
    const close = container.querySelector<HTMLButtonElement>('[aria-label="收起报表agent"]')!;
    act(() => { close.focus(); root.render(<MemoryRouter><ReportAgentChat active context={{ ...context, reportName: '新报表' }} onClose={() => {}} /></MemoryRouter>); });
    expect(document.activeElement).toBe(close);
  });

  it('新会话 null 历史作为空会话呈现，仍可输入提问', async () => {
    vi.mocked(get).mockImplementation(async (path) => path === '/api/agents' ? [agent] : null);
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    expect(container.textContent).toContain('一起看看这份报表');
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('textarea'));
  });

  it('首次历史只请求一次，断线重连后才补拉消息', async () => {
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    const historyRequests = () => vi.mocked(get).mock.calls.filter(([path]) => /\/messages(?:\?|$)/.test(path));
    expect(historyRequests()).toHaveLength(1);
    await act(async () => { useWsStore.setState({ status: 'disconnected' }); });
    await act(async () => { useWsStore.setState({ status: 'connected' }); });
    expect(historyRequests()).toHaveLength(2);
  });

  it('历史请求的旧快照不会覆盖请求期间到达的真实回复', async () => {
    const oldReply = { id: 'answer', conversation_id: 'report-chat', role: 'assistant' as const, content: '', status: 'streaming' as const, artifacts_json: null, created_at: '2026-09-19T12:00:00Z' };
    useMessageStore.getState().addMessage('report-chat', oldReply);
    let finishHistory!: (value: unknown) => void;
    vi.mocked(get).mockImplementation(async (path) => {
      if (path === '/api/agents') return [agent];
      if (/\/messages(?:\?|$)/.test(path)) return new Promise((resolve) => { finishHistory = resolve; });
      return [];
    });
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    await act(async () => {
      useMessageStore.getState().addMessage('report-chat', { ...oldReply, status: 'complete', content: '真实完整回答' });
      finishHistory([oldReply]);
    });
    expect(container.textContent).toContain('真实完整回答');
    expect(container.querySelector('[aria-label="停止报表agent回复"]')).toBeNull();
  });

  it('显示当前报表并发送纯用户问题，黑板独立携带数据，IME Enter 不发送', async () => {
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    expect(container.textContent).toContain('价敏用户报表');
    expect(container.textContent).toContain('2026-09-01 → 2026-09-19');
    const input = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '解释一下');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); });
    expect(put).not.toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', expect.anything());
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(put).toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', { manual_context: expect.stringContaining('保留我的备注') });
    expect(put).toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', { manual_context: expect.stringContaining('聚合人数：100') });
    expect(put).toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', { manual_context: expect.stringContaining('2026-09-01 → 2026-09-19') });
    expect(post).toHaveBeenCalledWith('/api/conversations/report-chat/messages', { content: '解释一下', role: 'user', attachments: [], agent_id: 'report-agent' });
  });

  it('发送期间切换报表保留问题原始快照，连按发送不会重复派发，后续草稿不丢失', async () => {
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    let finishContext!: (value: unknown) => void;
    vi.mocked(get).mockImplementation(async (path) => path.endsWith('/blackboard') ? new Promise((resolve) => { finishContext = resolve; }) : []);
    const input = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '解释一下');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => {
      root.render(<MemoryRouter><ReportAgentChat context={{ ...context, reportName: '另一份报表', cities: ['上海'] }} onClose={() => {}} /></MemoryRouter>);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '下一个问题');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { finishContext({ manual_context: '' }); });
    expect(put).toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', { manual_context: expect.stringContaining('北京') });
    expect(put).not.toHaveBeenCalledWith('/api/conversations/report-chat/blackboard', { manual_context: expect.stringContaining('另一份报表') });
    expect(vi.mocked(post).mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(1);
    expect(input.value).toBe('下一个问题');
  });

  it('发送失败保留问题并允许重试，正在回复时不覆盖黑板', async () => {
    await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
    const input = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '解释一下');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    vi.mocked(post).mockRejectedValueOnce(new Error('网络暂时不可用'));
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(container.textContent).toContain('网络暂时不可用');
    expect(input.value).toBe('解释一下');
    expect(useMessageStore.getState().optimisticMessages['report-chat']).toEqual([]);
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '重试发送')!;
    await act(async () => { retry.click(); });
    expect(vi.mocked(post).mock.calls.filter(([path]) => path.endsWith('/messages'))).toHaveLength(2);
    expect(input.value).toBe('');
    vi.mocked(put).mockClear();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '再问一次');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(put).not.toHaveBeenCalled();
  });
});

it('选择本地 GPT 后仍使用原报表会话和已加载历史', async () => {
  const gpt = { ...agent, id: 'my-gpt', name: '我的 GPT', cli_tool: 'codex' };
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/api/agents') return [agent, gpt];
    if (path.includes('/messages')) return [{ id: 'existing-answer', conversation_id: 'report-chat', role: 'assistant', content: '之前的报表回答', status: 'complete', created_at: '2026-09-21T00:00:00Z' }];
    return [];
  });
  vi.mocked(post).mockImplementation(async (_path, body) => ({ id: 'report-chat', type: 'agent', title: '报表agent', peer_id: (body as { agent_id: string }).agent_id }));
  await act(async () => { root.render(<MemoryRouter><ReportAgentChat context={context} onClose={() => {}} /></MemoryRouter>); });
  const selector = container.querySelector<HTMLSelectElement>('[aria-label="报表执行 Agent"]')!;
  expect(selector.textContent).toContain('GPT / Codex');
  await act(async () => { selector.value = 'my-gpt'; selector.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(post).toHaveBeenLastCalledWith('/api/conversations/agent', { agent_id: 'my-gpt', workspace: 'report', select_agent: true });
  expect(container.textContent).toContain('之前的报表回答');
  expect(selector.value).toBe('my-gpt');
});
