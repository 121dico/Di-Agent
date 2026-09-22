import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, post } from './client';
import { ensureDeliveryAgentSession } from './deliveryAgentSession';

vi.mock('./client', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), getAuthHeaders: vi.fn(), ApiError: class extends Error {} }));

const agent = (overrides: Record<string, unknown> = {}) => ({
  id: 'report-agent', name: '报表agent', user_id: 'user-1', machine_id: 'machine', status: 'online', cli_tool: 'codex',
  ...overrides,
});

describe('投放页 Agent 会话接入', () => {
  beforeEach(() => vi.resetAllMocks());

  it('复用现有本地 Agent 和投放页历史会话，不创建新的 Agent 实体', async () => {
    vi.mocked(get).mockResolvedValue([agent(), agent({ id: 'claude-agent', name: 'Claude 助手', cli_tool: 'claude' })]);
    vi.mocked(post).mockResolvedValue({ id: 'delivery-history', type: 'agent', peer_id: 'report-agent' });

    const session = await ensureDeliveryAgentSession('user-1', 'token-1', () => true);

    expect(session.agent.id).toBe('report-agent');
    expect(session.conversation.id).toBe('delivery-history');
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/conversations/agent', { agent_id: 'report-agent', workspace: 'delivery', select_agent: false });
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining('/add'), expect.anything());
  });

  it('没有在线本地 Agent 时明确失败，不生成占位 Agent', async () => {
    vi.mocked(get).mockResolvedValue([agent({ status: 'offline' })]);

    await expect(ensureDeliveryAgentSession('user-1', 'token-2', () => true)).rejects.toThrow('暂无在线本地 Agent');
    expect(post).not.toHaveBeenCalled();
  });
});
