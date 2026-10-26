// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '@/api/auth';
import * as userApi from '@/api/user';
import type { AuthResponse } from '@/types/auth';
import { useConversationStore } from './conversationStore';
import { STORAGE_KEYS } from '@/config/constants';
import { useAgentApprovalStore } from './agentApprovalStore';
import { useAuthStore } from './authStore';

afterEach(() => {
  useAgentApprovalStore.getState().clear();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false, loading: false, error: null });
  window.localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('auth approval privacy boundary', () => {
  it('never refreshes an old stored token during a company callback', async () => {
    window.history.replaceState({}, '', '/login?company=1');
    const user = { id: 'new-company', username: 'employee', is_admin: false, created_at: '2026-10-08' };
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'expired-local-token');
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ ...user, id: 'old-local' }));
    // 如果此请求发出，它会在新会话建立后才返回 401；回调路径必须完全避免它。
    const profile = vi.spyOn(userApi, 'getCurrentUser').mockImplementation(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('401')), 10);
    }));
    vi.spyOn(authApi, 'loginBoss').mockResolvedValue({ token: 'company-token', user });
    useAuthStore.getState().loadFromStorage();
    await useAuthStore.getState().loginBoss();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(profile).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('company-token');
    expect(localStorage.getItem(STORAGE_KEYS.TOKEN)).toBe('company-token');
  });

  it.each(['logout', 'local-login'])('ignores a late company response after %s', async (nextAction) => {
    let finish!: (value: AuthResponse) => void;
    const user = { id: 'company-user', username: 'employee', is_admin: false, created_at: '2026-10-08' };
    vi.spyOn(authApi, 'loginBoss').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useAuthStore.getState().loginBoss();
    const rejected = expect(pending).rejects.toThrow('登录请求已取消');
    if (nextAction === 'logout') useAuthStore.getState().logout();
    else {
      vi.spyOn(authApi, 'login').mockResolvedValue({ token: 'local-token', user: { ...user, id: 'local-user' } });
      await useAuthStore.getState().login('local', 'password');
    }
    finish({ token: 'late-company-token', user });
    await rejected;
    expect(useAuthStore.getState().token).toBe(nextAction === 'logout' ? null : 'local-token');
    expect(localStorage.getItem(STORAGE_KEYS.TOKEN)).toBe(nextAction === 'logout' ? null : 'local-token');
    expect(useAuthStore.getState().error).toBeNull();
  });
  it('installs only the company server response after clearing prior account state', async () => {
    const user = { id: 'company-user', username: 'employee', is_admin: false, created_at: '2026-10-08' };
    vi.spyOn(authApi, 'loginBoss').mockResolvedValue({ token: 'verified-response-token', user });
    useConversationStore.setState({ activeConversationId: 'local-private-conversation' });
    useAuthStore.setState({ user: { ...user, id: 'local-user' }, token: 'old-token', isAuthenticated: true });
    await useAuthStore.getState().loginBoss();
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useConversationStore.getState().activeConversationId).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.TOKEN)).toBe('verified-response-token');
  });

  it('leaves prior session untouched on failed company bootstrap', async () => {
    vi.spyOn(authApi, 'loginBoss').mockRejectedValue(new Error('denied'));
    useAuthStore.setState({ token: 'local-token', isAuthenticated: true });
    await expect(useAuthStore.getState().loginBoss()).rejects.toThrow('denied');
    expect(useAuthStore.getState().token).toBe('local-token');
    expect(useAuthStore.getState().loading).toBe(false);
  });
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
