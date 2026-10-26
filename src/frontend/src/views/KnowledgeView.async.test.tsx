// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import KnowledgeView from './KnowledgeView';
import type { ManagedMcpInspection } from '@/api/managedMcp';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { requests, pending } = vi.hoisted(() => ({
  requests: { connections: vi.fn(), tables: vi.fn(), receipts: vi.fn(), sources: vi.fn(), catalog: vi.fn(), machines: vi.fn(), inspect: vi.fn() },
  pending: new Promise<never>(() => {}),
}));
vi.mock('@/api/dataHub', () => ({
  getDataSession: () => pending,
  listDataConnections: requests.connections,
  listHiveTables: requests.tables,
  listHiveReceipts: requests.receipts,
  listAPISourceStatuses: requests.sources,
  listHiveCatalog: requests.catalog,
  addHiveTable: vi.fn(), loginHive: vi.fn(), runHiveQuery: vi.fn(), getHiveReceipt: vi.fn(),
}));
vi.mock('@/components/report/DataSourceManagerModal', () => ({ default: () => null }));
vi.mock('@/api/managedMcp', () => ({
  listManagedMcpMachines: requests.machines, inspectManagedMcp: requests.inspect,
  createManagedMcpSetupSession: vi.fn(), saveManagedMcpConfiguration: vi.fn(), managedMcpErrorMessage: vi.fn(),
}));
beforeEach(() => {
  useAuthStore.setState({ user: null });
  requests.machines.mockReset().mockResolvedValue([]);
  requests.inspect.mockReset();
  requests.connections.mockReturnValue(pending);
  requests.tables.mockReturnValue(pending);
  requests.receipts.mockReturnValue(pending);
  requests.sources.mockReturnValue(pending);
  requests.catalog.mockReturnValue(pending);
});

const owner = { id: 'owner', username: 'owner', is_admin: false, created_at: '' };
const machine = (id: string, status = 'connected', user_id = 'owner') => ({ id, name: `电脑-${id}`, status, user_id });
const verified: ManagedMcpInspection = {
  status: 'connected', checked_at: '2026-10-19T01:00:00Z', configuration_changed: false,
  key_configured: true, project_code: 'epower_platform', credential_source: 'file', project_source: 'file', opened: false,
  checks: [{ id: 'identity', status: 'passed', code: 'identity_verified' }],
};
function deferred<T>() { let resolve!: (result: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function clickIn(container: Element, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s/g, '') === label.replace(/\s/g, ''))!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

it('shows real MCP state in the sidebar and preserves it across API and Cooper tabs', async () => {
  useAuthStore.setState({ user: owner });
  requests.machines.mockResolvedValue([machine('a')]);
  const first = deferred<ManagedMcpInspection>(); requests.inspect.mockReturnValue(first.promise);
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><KnowledgeView /></MemoryRouter>));
  const dot = () => container.querySelector('[aria-label="数据连接状态"]')!;
  expect(dot()?.getAttribute('title')).toBe('检测中');
  expect(dot()?.className).not.toContain('statusConnected');
  await act(async () => first.resolve(verified));
  expect(dot().getAttribute('title')).toBe('MCP 已验证');
  expect(dot().className).toContain('statusConnected');
  const tab = async (label: string) => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).find((item) => item.textContent?.startsWith(label))!;
    await act(async () => button.click());
  };
  await tab('API 接口');
  expect(container.querySelector('[aria-label="数据连接配置"]')?.closest('[hidden]')).not.toBeNull();
  expect(dot().className).toContain('statusConnected');
  await tab('Cooper');
  expect(dot().className).toContain('statusConnected');
  await tab('数据连接');
  expect(requests.inspect).toHaveBeenCalledTimes(1);
  requests.inspect.mockResolvedValue({ ...verified, status: 'configured_unverified', checks: [] });
  await clickIn(container, '检查连接');
  expect(dot().getAttribute('title')).toBe('尚未验证');
  expect(dot().className).not.toContain('statusConnected');
  requests.inspect.mockRejectedValue(new Error('检测超时'));
  await clickIn(container, '检查连接');
  expect(dot().getAttribute('title')).toBe('连接未通过');
  expect(dot().className).toContain('statusFailed');
  requests.machines.mockResolvedValue([machine('a', 'offline')]);
  await clickIn(container, '刷新电脑');
  expect(dot().getAttribute('title')).toBe('电脑离线');
  expect(dot().className).not.toContain('statusFailed');
  expect(dot().className).not.toContain('statusConnected');
  await act(async () => root.unmount());
});

it('ignores obsolete success after selecting another machine or switching accounts', async () => {
  useAuthStore.setState({ user: owner });
  requests.machines.mockResolvedValue([machine('a'), machine('b')]);
  const oldMachine = deferred<ManagedMcpInspection>();
  const oldUser = deferred<ManagedMcpInspection>();
  requests.inspect.mockImplementation((id: string) => id === 'a' ? oldMachine.promise : oldUser.promise);
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><KnowledgeView /></MemoryRouter>));
  await act(async () => { const select = container.querySelector('select')!; select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => oldMachine.resolve(verified));
  const dot = () => container.querySelector('[aria-label="数据连接状态"]')!;
  expect(dot()?.getAttribute('title')).toBe('检测中');
  requests.machines.mockResolvedValue([machine('c', 'offline', 'second')]);
  await act(async () => useAuthStore.setState({ user: { ...owner, id: 'second' } }));
  await act(async () => oldUser.resolve(verified));
  expect(dot().getAttribute('title')).toBe('电脑离线');
  expect(dot().className).not.toContain('statusConnected');
  await act(async () => root.unmount());
});

it('opens data connection immediately and keeps removed destinations out of pending navigation', async () => {
  requests.connections.mockReturnValue(pending);
  requests.tables.mockReturnValue(pending);
  requests.receipts.mockReturnValue(pending);
  requests.sources.mockReturnValue(pending);
  requests.catalog.mockReturnValue(pending);
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><KnowledgeView /></MemoryRouter>); });
  expect(container.querySelector('main h1')?.textContent).toBe('数据连接');
  expect(container.textContent).not.toContain('Hadoop / Hive');
  expect(container.textContent).not.toContain('数据地图');
  expect(container.querySelector('aside')?.textContent).not.toContain('数梦');
  expect(container.querySelector('aside')?.textContent).toContain('API 接口');
  expect(container.querySelector('aside')?.textContent).toContain('Cooper');
  expect(container.querySelector('aside')?.textContent).toContain('数据连接 3');
  expect(requests.catalog).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); });
});

it('filters hidden backend entries and keeps API and Cooper accessible without waiting for Hive', async () => {
  requests.connections.mockResolvedValue([
    { kind: 'hive', name: 'Hadoop / Hive', account: 'my-account', status: '已连接', detail: '连接正常' },
    { kind: 'datamap', name: '数据地图', account: '', status: '未连接', detail: '' },
    { kind: 'api', name: 'API 接口', account: '', status: '已登记', detail: 'API 已登记' },
    { kind: 'cooper', name: 'Cooper', account: '', status: '未接入', detail: '' },
  ]);
  requests.tables.mockReturnValue(pending);
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><KnowledgeView /></MemoryRouter>); });
  const sidebar = container.querySelector('aside')!;
  expect(sidebar.textContent).not.toContain('Hadoop');
  expect(sidebar.textContent).not.toContain('数据地图');
  expect(sidebar.textContent).toContain('数据连接 3');
  const click = async (name: string) => {
    const button = Array.from(sidebar.querySelectorAll('button')).find((item) => item.textContent?.includes(name))!;
    await act(async () => button.click());
  };
  await click('API 接口');
  expect(container.querySelector('main')?.textContent).toContain('API 数据源');
  await click('Cooper');
  expect(container.querySelector('main')?.textContent).toContain('Cooper 接入');
  const search = sidebar.querySelector('input')!;
  const searchFor = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await searchFor('Hive');
  expect(sidebar.textContent).not.toContain('Hadoop');
  expect(sidebar.textContent).toContain('数据连接 0');
  await searchFor('数据连接');
  expect(sidebar.textContent).toContain('配置与连接诊断');
  expect(sidebar.textContent).toContain('数据连接 1');
  await act(async () => { root.unmount(); });
});
