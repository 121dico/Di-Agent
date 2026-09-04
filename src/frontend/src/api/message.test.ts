import { beforeEach, describe, expect, it, vi } from 'vitest';
import { post } from './client';
import { sendMessage } from './message';

vi.mock('./client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

describe('sendMessage runtime request contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes the complete v2 runtime config into the exact request body', async () => {
    vi.mocked(post).mockResolvedValue({} as never);
    const runtimeConfig = {
      version: 2 as const,
      model: 'gpt-5.6-sol' as const,
      reasoning_effort: 'high' as const,
      approval_mode: 'request' as const,
      service_tier: 'priority' as const,
    };

    await sendMessage(
      'conversation-1',
      'verify runtime',
      'user',
      undefined,
      undefined,
      undefined,
      'agent-1',
      runtimeConfig,
    );

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/conversations/conversation-1/messages', {
      content: 'verify runtime',
      role: 'user',
      attachments: [],
      agent_id: 'agent-1',
      runtime_config: {
        version: 2,
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
        approval_mode: 'request',
        service_tier: 'priority',
      },
    });
  });
});
