import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, post } from './client';
import { ensureReportAgentSession } from './reportAgentSession';

vi.mock('./client', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), getAuthHeaders: vi.fn(), ApiError: class extends Error {} }));

describe('报表 Agent 会话接入', () => {
  beforeEach(() => vi.resetAllMocks());

  it('并发打开只创建一次绑定在线 Claude 的报表 Agent 和独立会话', async () => {
    vi.mocked(get).mockImplementation(async (path) => {
      if (path === '/api/agents') return [];
      if (path === '/api/daemon/machines') return [{ id: 'machine', status: 'connected' }];
      if (path === '/api/daemon/agent-candidates') return [
        { id: 'codex', machine_id: 'machine', cli_tool: 'codex', variant: 'cli' },
        { id: 'claude', machine_id: 'machine', cli_tool: 'claude', variant: 'cli' },
      ];
      throw new Error(`Unexpected GET ${path}`);
    });
    vi.mocked(post).mockImplementation(async (path) => path.endsWith('/add')
      ? { id: 'report-agent', name: '报表agent', machine_id: 'machine', status: 'online' }
      : { id: 'report-conversation', type: 'agent' });

    const [first, second] = await Promise.all([
      ensureReportAgentSession('user-1', 'session-1', () => true),
      ensureReportAgentSession('user-1', 'session-1', () => true),
    ]);

    expect(first.conversation.id).toBe('report-conversation');
    expect(second).toEqual(first);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('/api/daemon/agent-candidates/claude/add', expect.objectContaining({ name: '报表agent', cli_tool: 'claude', enable_management_tools: false }));
    expect(post).toHaveBeenCalledWith('/api/conversations/agent', { agent_id: 'report-agent', workspace: 'report', select_agent: false });
  });

  it('已有报表 Agent 时恢复同一会话，认证变化后不创建资源', async () => {
    vi.mocked(get).mockResolvedValue([{ id: 'existing', user_id: 'user-2', name: '报表agent', machine_id: 'machine' }]);
    vi.mocked(post).mockResolvedValue({ id: 'history' });
    expect((await ensureReportAgentSession('user-2', 'session-2', () => true)).conversation.id).toBe('history');
    expect(post).toHaveBeenCalledOnce();
    vi.mocked(post).mockClear();
    let current = true;
    vi.mocked(get).mockImplementation(async () => { current = false; return []; });
    await expect(ensureReportAgentSession('user-3', 'session-3', () => current)).rejects.toThrow('登录状态已变化');
    expect(post).not.toHaveBeenCalled();
  });

  it('离线环境不创建假 Agent，恢复连接后允许重试', async () => {
    vi.mocked(get).mockResolvedValue([]);
    await expect(ensureReportAgentSession('user-4', 'session-4', () => true)).rejects.toThrow('暂无在线运行环境');
    expect(post).not.toHaveBeenCalled();
    vi.mocked(get).mockResolvedValue([{ id: 'existing', user_id: 'user-4', name: '报表agent' }]);
    vi.mocked(post).mockResolvedValue({ id: 'recovered' });
    expect((await ensureReportAgentSession('user-4', 'session-4', () => true)).conversation.id).toBe('recovered');
  });
});
