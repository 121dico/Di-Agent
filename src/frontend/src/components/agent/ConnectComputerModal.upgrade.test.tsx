// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectComputerModal } from './ConnectComputerModal';
import type { DaemonMachine } from '@/types/agent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ connect: vi.fn(), download: vi.fn(), copy: vi.fn() }));
vi.mock('@/api/agent', () => ({ getMachineConnectCommand: api.connect, downloadMachineLauncher: api.download }));
vi.mock('@/utils/clipboard', () => ({ copyText: api.copy }));
vi.mock('./AgentCreateModal', () => ({ AgentCreateModal: () => null }));
vi.mock('@/utils/message', () => ({ message: { success: vi.fn(), error: vi.fn() } }));
const machine: DaemonMachine = { id: 'old-computer', user_id: 'owner', name: '在线旧电脑', machine_id: 'mac-host', status: 'connected', created_at: '', updated_at: '' };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.connect.mockReset().mockResolvedValue({ install_command: 'echo test-upgrade' });
  api.download.mockReset().mockResolvedValue(undefined); api.copy.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(allowConnectedUpgrade: boolean) {
  await act(async () => root.render(<ConnectComputerModal open machines={[machine]} candidates={[]} loading={false} allowConnectedUpgrade={allowConnectedUpgrade}
    onClose={vi.fn()} onRefresh={async () => {}} onCreate={vi.fn()} onDeleteMachine={vi.fn()} onAddCandidate={vi.fn()} />));
}

it('preserves normal connected-computer presentation unless the wizard opts in', async () => {
  await render(false);
  expect(document.querySelector('button[aria-label="升级 在线旧电脑 的 Mac 连接程序"]')).toBeNull();
  expect(api.connect).not.toHaveBeenCalled();
});

it('suggests a readable workstation name and preserves an explicitly entered name on creation', async () => {
  const create = vi.fn().mockRejectedValue(new Error('test only'));
  await act(async () => root.render(<ConnectComputerModal open machines={[machine]} candidates={[]} loading={false}
    onClose={vi.fn()} onRefresh={async () => {}} onCreate={create} onDeleteMachine={vi.fn()} onAddCandidate={vi.fn()} />));
  const input = document.querySelector<HTMLInputElement>('input[maxlength="100"]')!;
  expect(input.value).toBe('云杉工作站');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, '我的分析电脑'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s/g, '') === '创建连接')!;
  await act(async () => button.click());
  expect(create).toHaveBeenCalledWith('我的分析电脑');
});

it('keeps connection help folded and warns only when reconnecting an online computer', async () => {
  await render(true);
  expect(document.body.textContent).not.toContain('Daemon v');
  expect(document.body.textContent).not.toContain('可能中断正在运行的 Agent 任务');
  expect(document.body.textContent).not.toContain('升级 Mac');
  expect(document.body.textContent).not.toContain('machine key');
  const help = document.querySelector<HTMLDetailsElement>('details[aria-label="在线旧电脑连接帮助"]');
  expect(help?.open).toBe(false);
  await act(async () => help!.querySelector('summary')!.click());
  const upgrade = document.querySelector<HTMLButtonElement>('button[aria-label="重新连接 在线旧电脑 的 Mac 电脑"]');
  expect(upgrade).not.toBeNull();
  await act(async () => upgrade!.click());
  expect(api.connect).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('确认这台电脑上的任务已结束');
  const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '任务已结束，复制命令');
  expect(confirm).toBeDefined();
  await act(async () => confirm!.click());
  expect(api.connect).toHaveBeenCalledWith('old-computer');
  expect(api.copy).toHaveBeenCalledWith('echo test-upgrade');
  expect(api.download).not.toHaveBeenCalled();
});

it('refreshes an untouched suggestion after async computers load and after each successful creation', async () => {
  const create = vi.fn(async (name: string) => ({ machine: { ...machine, id: name, name }, install_command: 'echo connect', command: '', api_key: '', daemon_source_path: '', daemon_npm_path: '' }));
  const renderMachines = async (machines: DaemonMachine[], open = true) => act(async () => root.render(<ConnectComputerModal open={open} machines={machines} candidates={[]} loading={false}
    onClose={vi.fn()} onRefresh={async () => {}} onCreate={create} onDeleteMachine={vi.fn()} onAddCandidate={vi.fn()} />));
  await renderMachines([]);
  const input = () => document.querySelector<HTMLInputElement>('input[maxlength="100"]')!;
  expect(input().value).toBe('云杉工作站');
  const existing = [{ ...machine, name: '云杉工作站' }];
  await renderMachines(existing);
  expect(input().value).toBe('银杏工作站');
  const createButton = () => Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s/g, '') === '创建连接')!;
  await act(async () => createButton().click());
  expect(create).toHaveBeenLastCalledWith('银杏工作站');
  expect(input().value).toBe('青松工作站');
  await act(async () => createButton().click());
  expect(create).toHaveBeenLastCalledWith('青松工作站');
  expect(input().value).toBe('白桦工作站');
  await renderMachines(existing, false);
  await renderMachines([...existing, { ...machine, id: 'new', name: '白桦工作站' }]);
  expect(input().value).toBe('枫林工作站');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), '我的草稿'); input().dispatchEvent(new Event('input', { bubbles: true })); });
  await renderMachines([], false);
  await renderMachines(existing);
  expect(input().value).toBe('我的草稿');
});
