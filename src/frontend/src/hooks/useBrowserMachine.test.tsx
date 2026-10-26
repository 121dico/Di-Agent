// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { BROWSER_IDENTITY_MAX_AGE, resetBrowserMachineStore, useBrowserMachineStore } from '@/store/browserMachineStore';
import type { DaemonMachine } from '@/types/agent';
import { useBrowserMachine } from './useBrowserMachine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { resetBrowserMachineStore(); vi.useRealTimers(); });

it('invalidates display classification when the verified computer disconnects or recognition expires', async () => {
  vi.useFakeTimers();
  useAuthStore.setState({ user: { id: 'owner', username: 'owner', is_admin: false, created_at: '' } });
  const machine = { id: 'local', user_id: 'owner', status: 'connected' } as DaemonMachine;
  const element = document.createElement('div');
  const root = createRoot(element);
  function Probe({ computer }: { computer: DaemonMachine }) {
    const identity = useBrowserMachine([computer]);
    return <span>{identity.label(computer)}</span>;
  }
  const verified = () => useBrowserMachineStore.setState({ userId: 'owner', machineId: 'local', status: 'verified', verifiedAt: Date.now(), error: '' });
  verified();
  await act(async () => root.render(<Probe computer={machine} />));
  expect(element.textContent).toBe('本机');
  await act(async () => root.render(<Probe computer={{ ...machine, status: 'offline' }} />));
  expect(element.textContent).toBe('待识别');
  await act(async () => root.render(<Probe computer={machine} />));
  await act(async () => { verified(); });
  expect(element.textContent).toBe('本机');
  await act(async () => { vi.advanceTimersByTime(BROWSER_IDENTITY_MAX_AGE); });
  expect(element.textContent).toBe('待识别');
  await act(async () => root.unmount());
});

it('preserves verified identity while a newly mounted page awaits its first machine list', async () => {
  useAuthStore.setState({ user: { id: 'owner', username: 'owner', is_admin: false, created_at: '' } });
  useBrowserMachineStore.setState({ userId: 'owner', machineId: 'local', status: 'verified', verifiedAt: Date.now(), error: '' });
  const machine = { id: 'local', user_id: 'owner', status: 'connected' } as DaemonMachine;
  const element = document.createElement('div');
  const root = createRoot(element);
  function Page({ computers }: { computers: DaemonMachine[] }) {
    const identity = useBrowserMachine(computers);
    return <span>{identity.label(machine)}</span>;
  }
  try {
    await act(async () => root.render(<Page computers={[]} />));
    await act(async () => root.render(<Page computers={[machine]} />));
    expect(element.textContent).toBe('本机');
    await act(async () => root.render(<Page computers={[]} />));
    expect(element.textContent).toBe('待识别');
  } finally { await act(async () => root.unmount()); }
});
