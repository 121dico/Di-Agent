// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ConnectComputerModal } from './ConnectComputerModal';
import { AgentProfile } from './AgentProfile';
import { AgentList } from './AgentList';
import { ComputerProfile } from './ComputerProfile';
import { useAgentStore } from '@/store/agentStore';
import { useAuthStore } from '@/store/authStore';
import { resetBrowserMachineStore, useBrowserMachineStore } from '@/store/browserMachineStore';
import type { Agent, AgentCandidate, DaemonMachine } from '@/types/agent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/api/client', () => ({ get: vi.fn(async () => []), getAuthHeaders: () => ({}), setToken: vi.fn(), clearToken: vi.fn() }));
vi.mock('@/api/agent', async (original) => ({ ...await original<typeof import('@/api/agent')>(), getAgentRuntimeOverview: () => new Promise(() => {}) }));
const machine: DaemonMachine = { id: 'machine-id', name: '我的分析电脑', user_id: 'owner', machine_id: 'host', status: 'connected', created_at: '', updated_at: '' };
const candidate: AgentCandidate = { id: 'candidate-id', machine_id: machine.id, machine_name: 'computer-1543', name: 'Codex', cli_tool: 'codex', version: '', created_at: '', updated_at: '', last_seen_at: '' };
const agent: Agent = { id: 'agent-id', name: '数据助手', user_id: 'owner', machine_id: machine.id, machine_name: 'computer-1543', type: 'custom', cli_tool: 'codex', status: 'offline', source: 'daemon', created_at: '', updated_at: '' };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetBrowserMachineStore();
  useAuthStore.setState({ user: { id: 'owner', username: 'owner', is_admin: false, created_at: '' } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  useAgentStore.setState({ machines: [machine], agents: [], candidates: [], agentsLoaded: true, machinesLoaded: true, candidatesLoaded: true });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); resetBrowserMachineStore(); vi.unstubAllGlobals(); });

it('keeps the list and computer profile compact without guessed locality or persistent recognition controls', async () => {
  vi.stubGlobal('isSecureContext', false);
  await act(async () => root.render(<><AgentList selectedAgentId={null} selectedMachineId={machine.id} onSelect={vi.fn()} onSelectMachine={vi.fn()} /><ComputerProfile machineId={machine.id} /></>));
  expect(container.textContent).toContain('我的分析电脑');
  expect(container.textContent).not.toContain('识别本机');
  expect(container.textContent).not.toContain('待识别');
  expect(container.textContent).not.toContain('外部');
  expect(container.textContent).not.toContain('运行环境与连接状态');
});

it('does not expose unknown locality for a foreign computer when the owner computer was recognized', async () => {
  const foreign = { ...machine, id: 'foreign', user_id: 'other', name: '共享电脑' };
  useAgentStore.setState({ machines: [machine, foreign] });
  useBrowserMachineStore.setState({ userId: 'owner', machineId: machine.id, verifiedAt: Date.now(), status: 'verified' });
  await act(async () => root.render(<><AgentList selectedAgentId={null} selectedMachineId={machine.id} onSelect={vi.fn()} onSelectMachine={vi.fn()} /><ComputerProfile machineId={foreign.id} /></>));
  expect(container.textContent).toContain('本机');
  expect(container.textContent).not.toContain('待识别');
  expect(container.textContent).not.toContain('外部');
});

it('uses the current computer name in discovered tools and the actual create-agent dialog', async () => {
  await act(async () => root.render(<ConnectComputerModal open machines={[machine]} candidates={[candidate]} loading={false}
    onClose={vi.fn()} onRefresh={async () => {}} onCreate={vi.fn()} onDeleteMachine={vi.fn()} onAddCandidate={vi.fn()} />));
  expect(document.body.textContent).toContain('codex · 我的分析电脑');
  expect(document.body.textContent).not.toContain('computer-1543');
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === '添加 Agent')!;
  await act(async () => button.click());
  expect(document.body.textContent).toContain('创建 Agent · 我的分析电脑');
  expect(candidate.machine_id).toBe('machine-id');
});

it('uses the linked computer name in agent profile without rewriting agent metadata', async () => {
  await act(async () => root.render(<AgentProfile agent={agent} />));
  const edit = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s/g, '') === '编辑')!;
  await act(async () => edit.click());
  expect(container.textContent).toContain('我的分析电脑');
  expect(container.textContent).not.toContain('computer-1543');
  expect(agent.machine_name).toBe('computer-1543');
});
