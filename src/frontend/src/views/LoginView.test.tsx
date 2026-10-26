// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import LoginView from './LoginView';
import RegisterView from './RegisterView';
import { getAuthProviders } from '@/api/auth';

const actions = vi.hoisted(() => ({ login: vi.fn(), loginBoss: vi.fn(), register: vi.fn(), loading: false, error: null }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (state: typeof actions) => unknown) => selector(actions) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => actions }));
vi.mock('@/api/auth', async (original) => ({ ...await original<typeof import('@/api/auth')>(), getAuthProviders: vi.fn() }));
vi.mock('@/layout/AuthLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
let container: HTMLDivElement;
let root: Root;
const local = { mode: 'local' as const, login_url: '', local_login_enabled: true, boss_enabled: false, boss_ready: false };
const hybrid = { mode: 'hybrid' as const, login_url: 'https://boss.example.test/login', local_login_enabled: true, boss_enabled: true, boss_ready: true };
async function render(path = '/login') {
  await act(async () => root.render(<React.StrictMode><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<LoginView />} /><Route path="/register" element={<RegisterView />} /><Route path="/" element={<div>workspace</div>} />
  </Routes></MemoryRouter></React.StrictMode>));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthProviders).mockResolvedValue(local);
  actions.login.mockResolvedValue(undefined); actions.loginBoss.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('hybrid login', () => {
  it('shows unavailable company entry and working local registration link', async () => {
    await render();
    expect(container.textContent).toContain('等待 Boss 接入配置');
    expect(container.querySelector<HTMLButtonElement>('section button')?.disabled).toBe(true);
    expect(container.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/register');
  });
  it('keeps local form and retry when provider discovery fails', async () => {
    vi.mocked(getAuthProviders).mockRejectedValue(new Error('公司登录暂未接通'));
    await render();
    expect(container.textContent).toContain('重新读取配置');
    expect(container.querySelector('form')).not.toBeNull();
  });
  it('bootstraps exactly once under strict effects then enters workspace', async () => {
    vi.mocked(getAuthProviders).mockResolvedValue(hybrid);
    await render('/login?company=1');
    expect(actions.loginBoss).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('workspace');
  });
  it('does not bootstrap a disabled company callback', async () => {
    await render('/login?company=1');
    expect(actions.loginBoss).not.toHaveBeenCalled();
    expect(container.textContent).toContain('公司登录暂不可用');
  });
  it('shows callback failure without automatic retries', async () => {
    vi.mocked(getAuthProviders).mockResolvedValue(hybrid);
    actions.loginBoss.mockRejectedValue(new Error('网关身份验证失败'));
    await render('/login?company=1');
    expect(actions.loginBoss).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('网关身份验证失败');
    expect(container.querySelector('form')).not.toBeNull();
  });
  it('does not accept token or user fields from URL', async () => {
    await render('/login?token=fake&user=fake');
    expect(actions.loginBoss).not.toHaveBeenCalled();
    expect(container.textContent).not.toBe('workspace');
  });
  it('hides local registration in exclusive mode', async () => {
    vi.mocked(getAuthProviders).mockResolvedValue({ ...hybrid, mode: 'boss', local_login_enabled: false });
    await render('/register');
    expect(container.textContent).toContain('本地注册已关闭');
    expect(container.querySelector('input')).toBeNull();
  });
  it('retains local registration in hybrid mode', async () => {
    vi.mocked(getAuthProviders).mockResolvedValue(hybrid);
    await render('/register');
    expect(container.querySelectorAll('input')).toHaveLength(3);
  });
});
