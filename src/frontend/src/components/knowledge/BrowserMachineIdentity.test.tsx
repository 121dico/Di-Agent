// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { resetBrowserMachineStore } from '@/store/browserMachineStore';
import DatadreamSetupPanel from './DatadreamSetupPanel';
import { ConnectComputerModal } from '@/components/agent/ConnectComputerModal';
import type { DaemonMachine } from '@/types/agent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ machines: vi.fn() }));
vi.mock('@/api/managedMcp', () => ({
  listManagedMcpMachines: api.machines, inspectManagedMcp: () => new Promise(() => {}),
  createManagedMcpSetupSession: vi.fn(), saveManagedMcpConfiguration: vi.fn(), managedMcpErrorMessage: vi.fn(),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  resetBrowserMachineStore();
  useAuthStore.setState({ user: { id: 'owner', username: 'owner', is_admin: false, created_at: '' } });
  api.machines.mockResolvedValue([
    { id: 'browser-machine', user_id: 'owner', name: '我的电脑', status: 'connected', is_local: false },
    { id: 'server-machine', user_id: 'owner', name: '服务器', status: 'connected', is_local: true },
  ]);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); resetBrowserMachineStore(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<MemoryRouter><DatadreamSetupPanel /></MemoryRouter>)); }

it('keeps HTTP browser locality unknown until user-triggered recognition', async () => {
  vi.stubGlobal('isSecureContext', false);
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await render();
  const options = Array.from(container.querySelectorAll('option')).map((option) => option.textContent);
  expect(options).toEqual(['我的电脑 · 在线', '服务器 · 在线']);
  expect(container.textContent).not.toContain('识别本机');
  expect(container.textContent).not.toContain('待识别');
  expect(fetcher).not.toHaveBeenCalled();
});

it('labels the proven browser computer, not the server-local flag, and clears on account change', async () => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as { nonce: string };
    return url.startsWith('http:')
      ? new Response(JSON.stringify({ nonce: data.nonce, issued_at: Math.floor(Date.now() / 1000), proof: 'a'.repeat(64) }))
      : new Response(JSON.stringify({ code: 0, data: { machine_id: 'browser-machine' } }));
  }));
  await render();
  expect(Array.from(container.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['我的电脑 · 本机 · 在线', '服务器 · 外部 · 在线']);
  api.machines.mockResolvedValue([{ id: 'other', user_id: 'other-owner', name: '其他账号电脑', status: 'offline' }]);
  await act(async () => useAuthStore.setState({ user: { id: 'other-owner', username: 'other', is_admin: false, created_at: '' } }));
  expect(container.textContent).not.toContain(' · 本机');
  expect(container.textContent).not.toContain(' · 外部');
});

it('retries a blocked secure-context background probe through a user-opened verification window', async () => {
  vi.stubGlobal('isSecureContext', true);
  const fetcher = vi.fn().mockRejectedValue(new Error('local network blocked')); vi.stubGlobal('fetch', fetcher);
  await render();
  expect(container.textContent).not.toContain('未能识别本机');
  expect(container.textContent).not.toContain(' · 外部');
  const machines = await api.machines() as DaemonMachine[];
  await act(async () => root.render(<MemoryRouter><DatadreamSetupPanel /><ConnectComputerModal open machines={machines} candidates={[]} loading={false}
    onClose={vi.fn()} onRefresh={async () => {}} onCreate={vi.fn()} onDeleteMachine={vi.fn()} onAddCandidate={vi.fn()} /></MemoryRouter>));
  const help = document.querySelector<HTMLDetailsElement>('details[aria-label="连接帮助"]')!;
  expect(help).not.toBeNull();
  expect(help.open).toBe(false);
  await act(async () => help.querySelector('summary')!.click());
  const popup = { closed: false, close: vi.fn() } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { machine_id: 'browser-machine' } })));
  const button = Array.from(help.querySelectorAll('button')).find((item) => item.textContent === '识别本机')!;
  await act(async () => button.click());
  const nonce = new URL(String(open.mock.calls[0]?.[0])).searchParams.get('nonce');
  await act(async () => window.dispatchEvent(new MessageEvent('message', {
    origin: 'http://127.0.0.1:28683', source: popup,
    data: { type: 'di-agent-browser-identity', nonce, issued_at: Math.floor(Date.now() / 1000), proof: 'a'.repeat(64) },
  })));
  expect(container.textContent).toContain('我的电脑 · 本机 · 在线');
  expect(container.textContent).toContain('服务器 · 外部 · 在线');
});

it('ignores a late platform verification after logout', async () => {
  vi.stubGlobal('isSecureContext', true);
  let complete!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => url.startsWith('http:')
    ? new Response(JSON.stringify({ nonce: (JSON.parse(String(init.body)) as { nonce: string }).nonce, issued_at: Math.floor(Date.now() / 1000), proof: 'a'.repeat(64) }))
    : pending));
  await render();
  expect(container.textContent).not.toContain('识别中');
  await act(async () => useAuthStore.getState().logout());
  await act(async () => complete(new Response(JSON.stringify({ code: 0, data: { machine_id: 'browser-machine' } }))));
  expect(container.textContent).not.toContain(' · 本机');
  expect(container.textContent).not.toContain(' · 外部');
});
