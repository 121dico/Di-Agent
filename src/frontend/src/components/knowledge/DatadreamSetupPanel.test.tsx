// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DatadreamSetupPanel from './DatadreamSetupPanel';
import type { ManagedMcpInspection } from '@/api/managedMcp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ list: vi.fn(), inspect: vi.fn(), session: vi.fn(), save: vi.fn() }));
vi.mock('@/api/managedMcp', () => ({ listManagedMcpMachines: api.list, inspectManagedMcp: api.inspect, createManagedMcpSetupSession: api.session, saveManagedMcpConfiguration: api.save, managedMcpErrorMessage: (code: string) => code === 'session_expired' ? '安全配置会话已过期' : code }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'owner' } }) }));
vi.mock('@/components/agent/ConnectComputerModal', () => ({ ConnectComputerModal: ({ open, allowConnectedUpgrade }: { open: boolean; allowConnectedUpgrade: boolean }) => open ? <div>连接电脑对话框{allowConnectedUpgrade && '支持在线电脑升级'}</div> : null }));
vi.mock('@/api/agent', () => ({ addAgentCandidate: vi.fn(), createDaemonMachine: vi.fn(), deleteDaemonMachine: vi.fn() }));

const machine = (id: string, owner = 'owner', status = 'connected') => ({ id, user_id: owner, name: `电脑-${id}`, status });
const connected: ManagedMcpInspection = {
  status: 'connected', checked_at: '2026-10-16T03:00:00Z', configuration_changed: false,
  key_configured: true, project_code: 'epower_platform', credential_source: 'keychain', project_source: 'file', opened: false,
  checks: [
    { id: 'daemon', status: 'passed', code: 'daemon_ready' }, { id: 'proxy', status: 'passed', code: 'proxy_reachable' },
    { id: 'identity', status: 'passed', code: 'identity_verified' }, { id: 'credential', status: 'passed', code: 'key_present' },
    { id: 'project', status: 'unverified', code: 'project_unverified' },
  ],
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  api.list.mockReset().mockResolvedValue([machine('a')]);
  api.inspect.mockReset().mockResolvedValue(connected);
  api.session.mockReset().mockResolvedValue({ ...connected, setup_session: { id: 'session', public_key: 'public', expires_at: new Date(Date.now() + 300000).toISOString(), supported: true, reason: '' } });
  api.save.mockReset().mockResolvedValue({ ...connected, saved: true, status: 'configured_unverified' });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => { root.render(<MemoryRouter><DatadreamSetupPanel /></MemoryRouter>); }); }
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s+/g, '') === label.replace(/\s+/g, ''));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

it('renders immediately while machines load, then only offers the owner’s computers', async () => {
  const pending = deferred<ReturnType<typeof machine>[]>(); api.list.mockReturnValue(pending.promise);
  await render();
  expect(container.textContent).toContain('正在读取本人电脑');
  expect(container.textContent).toContain('本机 MCP 代理');
  expect(api.inspect).not.toHaveBeenCalled();
  await act(async () => pending.resolve([machine('a'), machine('other', 'someone-else')]));
  expect(container.textContent).toContain('电脑-a');
  expect(container.textContent).not.toContain('电脑-other');
  expect(api.inspect).toHaveBeenCalledWith('a', expect.any(AbortSignal));
});

it('keeps successful diagnostics to four compact status rows without credential or project commentary', async () => {
  await render();
  expect(container.textContent).toContain('MCP 已验证');
  const rows = container.querySelectorAll('[aria-label="连接诊断"] li');
  expect(Array.from(rows).map((row) => row.textContent)).toEqual(['电脑连接程序通过', '本机 MCP 代理通过', '安全身份与 MCP通过', '个人 API Key通过']);
  expect(container.textContent).not.toContain('数据项目');
  expect(container.textContent).not.toContain('epower_platform');
  expect(container.textContent).not.toContain('系统钥匙串');
  expect(container.textContent).not.toContain('不代表项目或全部表已有权限');
  expect(container.textContent).not.toContain('识别本机');
  expect(container.textContent).not.toContain('待识别');
});

it('presents friendly automatic computer names without changing custom names or selected IDs', async () => {
  api.list.mockResolvedValue([
    { ...machine('auto'), name: 'computer-1543' },
    { ...machine('custom'), name: '我的分析工作站' },
  ]);
  await render();
  const select = container.querySelector('select')!;
  expect(select.options[0]?.textContent).toMatch(/^.+工作站.* · 在线$/);
  expect(select.options[0]?.textContent).not.toContain('computer-1543');
  expect(select.options[1]?.textContent).toBe('我的分析工作站 · 在线');
  expect(select.value).toBe('auto');
  await click('基础配置设置');
  expect(document.body.textContent).toContain(`配置目标：${select.options[0]?.textContent?.split(' · ')[0]}`);
  expect(api.session).toHaveBeenCalledWith('auto', expect.any(AbortSignal));
  await click('关闭');
  await act(async () => { select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(api.inspect).toHaveBeenLastCalledWith('custom', expect.any(AbortSignal));
});

it('ignores late diagnostics after selecting another computer', async () => {
  const pending = deferred<ManagedMcpInspection>();
  api.list.mockResolvedValue([machine('a'), machine('b')]);
  api.inspect.mockImplementation((id: string) => id === 'a' ? pending.promise : Promise.resolve({ ...connected, project_code: 'second_project' }));
  await render();
  const oldSignal = api.inspect.mock.calls[0]?.[1] as AbortSignal;
  await act(async () => { const select = container.querySelector('select')!; select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => pending.resolve({ ...connected, project_code: 'stale_project' }));
  await click('基础配置设置');
  expect(document.body.textContent).toContain('配置目标：电脑-b');
  expect(container.textContent).not.toContain('stale_project');
});

it('does not inspect offline computers or expose installation controls on data page', async () => {
  api.list.mockResolvedValue([machine('a', 'owner', 'offline')]);
  await render();
  expect(api.inspect).not.toHaveBeenCalled();
  expect(container.textContent).toContain('这台电脑已离线');
  expect(container.textContent).not.toContain('连接 / 升级电脑');
  await click('基础配置设置');
  expect(document.querySelector('a[href="/agents"]')).not.toBeNull();
  expect(api.session).not.toHaveBeenCalled();
});

it('explains missing keys without treating a reachable proxy as a logged-in identity', async () => {
  api.inspect.mockResolvedValue({ ...connected, status: 'setup_required', key_configured: false, credential_source: 'missing', checks: [
    { id: 'proxy', status: 'passed', code: 'proxy_reachable' },
    { id: 'identity', status: 'unverified', code: 'identity_required' },
    { id: 'credential', status: 'failed', code: 'key_missing' },
  ] });
  await render();
  expect(container.textContent).toContain('需要配置');
  expect(container.textContent).not.toContain('端口在线不代表身份已登录');
  expect(container.textContent).toContain('还没有可用的个人 API Key');
  expect(container.querySelector('a[href*="action=open_tokens"]')).not.toBeNull();
  expect(container.textContent).not.toContain('MCP 已验证');
});

it('keeps failure visible, removes old success during retry and distinguishes environment overrides', async () => {
  await render();
  const pending = deferred<ManagedMcpInspection>(); api.inspect.mockReturnValue(pending.promise);
  await click('检查连接');
  expect(container.textContent).not.toContain('MCP 已验证');
  expect(container.textContent).toContain('正在检查连接');
  await act(async () => pending.resolve({ ...connected, credential_source: 'environment', configuration_changed: true }));
  expect(container.textContent).toContain('环境变量覆盖');
  expect(container.textContent).toContain('旧的验证记录已失效');
  api.inspect.mockRejectedValue(new Error('检测超时，请确认电脑在线和公司网络正常后重试。'));
  await click('检查连接');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('检测超时');
  expect(container.textContent).not.toContain('MCP 已验证');
});

it('keeps Key/project inputs inline and checks real connection after saving', async () => {
  await render(); await click('基础配置设置');
  const expectNeutralCopy = () => {
    expect(document.body.textContent).not.toContain('数梦');
    expect(Array.from(document.querySelectorAll('[aria-label]')).map((element) => element.getAttribute('aria-label')).join(' ')).not.toContain('数梦');
  };
  expect(container.querySelector('h1')?.textContent).toBe('数据连接');
  expectNeutralCopy();
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  expect(document.body.textContent).toContain('第一次使用需配置');
  expect(document.body.textContent).toContain('安全助手连接');
  expect(document.querySelector('a[href^="lca:"]')?.getAttribute('href')).toBe('lca://openWebviewPage?url=%2Fai-protection&isMainWindow=true');
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="个人 API Key 详细引导"]')!.click());
  expect(document.body.textContent).toContain('1 · 个人 API Key 详细引导');
  expectNeutralCopy();
  await click('返回基础配置');
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="项目 Code 详细引导"]')!.click());
  expect(document.body.textContent).toContain('2 · 项目 Code 详细引导');
  expect(document.body.textContent).toContain('前往数据平台查看项目');
  expectNeutralCopy();
  await click('返回基础配置');
  const official = document.querySelector<HTMLAnchorElement>('a[href*="action=open_tokens"]');
  expect(official?.rel).toContain('noopener');
  expect(document.body.textContent).not.toContain('在所选电脑打开配置页');
  await click('保存并检查连接');
  expect(api.save).toHaveBeenCalledWith('a', 'owner', expect.objectContaining({ id: 'session' }), '', 'epower_platform', expect.any(AbortSignal));
  expect(api.inspect).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('MCP 已验证');
  expect(document.body.textContent).toContain('已保存，MCP 已验证');
});

async function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('clears secret on close and reopen, and never echoes an existing key', async () => {
  await render(); await click('基础配置设置'); await type('datadream-api-key', 'test-key-not-a-real-secret');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).value).toBe('test-key-not-a-real-secret');
  expect(document.querySelector('a[href^="lca:"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="个人 API Key 详细引导"]')!.click());
  await click('返回基础配置');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).value).toBe('test-key-not-a-real-secret');
  await click('关闭'); await click('基础配置设置');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).value).toBe('');
});
it('disables fields before unsupported platform solicits credentials', async () => {
  api.session.mockResolvedValue({ ...connected, setup_session: { supported: false, reason: 'unsupported_platform' } });
  await render(); await click('基础配置设置');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).disabled).toBe(true);
  expect(document.body.textContent).toContain('DI_AGENT_DATADREAM_API_KEY');
  expect(api.save).not.toHaveBeenCalled();
});
it('rejects numeric projectId and ignores late save after closing', async () => {
  await render(); await click('基础配置设置'); await type('datadream-project-code', '839');
  const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('保存并检查连接'))!;
  expect(save.disabled).toBe(true);
  await type('datadream-project-code', 'epower_platform');
  const pending = deferred<ManagedMcpInspection>(); api.save.mockReturnValue(pending.promise);
  await click('保存并检查连接'); await click('关闭');
  await act(async () => pending.resolve({ ...connected, saved: true, project_code: 'stale_project' }));
  expect(api.inspect).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain('stale_project');
});
it('allows explicit fresh-session recovery after expiry and clears the secret', async () => {
  await render(); await click('基础配置设置'); await type('datadream-api-key', 'test-key-not-a-real-secret');
  api.save.mockResolvedValue({ ...connected, saved: false, error_code: 'session_expired' });
  await click('保存并检查连接');
  expect(document.body.textContent).toContain('安全配置会话已过期');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).value).toBe('');
  await click('重新准备配置');
  expect(api.session).toHaveBeenCalledTimes(2);
});
it('shows saved-but-unverified when the post-save handshake times out', async () => {
  await render(); await click('基础配置设置');
  api.inspect.mockRejectedValue(new Error('检测超时'));
  await click('保存并检查连接');
  expect(document.body.textContent).toContain('已保存到所选电脑，但连接检查未完成');
  expect(document.body.textContent).not.toContain('正在验证真实 MCP 连接');
});
it('clears drafts and ignores old preparation when the selected machine changes', async () => {
  api.list.mockResolvedValue([machine('a'), machine('b')]);
  await render(); await click('基础配置设置'); await type('datadream-api-key', 'test-key-not-a-real-secret');
  await act(async () => { const select = container.querySelector('select')!; select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(document.getElementById('datadream-api-key')).toBeNull();
  await click('基础配置设置');
  expect((document.getElementById('datadream-api-key') as HTMLInputElement).value).toBe('');
  expect(api.session).toHaveBeenLastCalledWith('b', expect.any(AbortSignal));
});
