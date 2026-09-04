// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useAgentApprovalStore } from './agentApprovalStore';
import { useAuthStore } from './authStore';

afterEach(() => {
  useAgentApprovalStore.getState().clear();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false, loading: false, error: null });
  window.localStorage.clear();
});

describe('auth approval privacy boundary', () => {
  it('clears pending approval details on logout', () => {
    useAgentApprovalStore.getState().upsert({
      approval_id: 'approval-user-a', conversation_id: 'conversation-shared',
      task_id: 'task-a', agent_id: 'agent-1', kind: 'command', method: 'command',
      details: { command: ['cat', '/private/user-a.txt'] },
    });

    useAuthStore.getState().logout();

    expect(useAgentApprovalStore.getState().pending).toEqual({});
  });
});
