// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { getAgentModels, type RuntimeModelCatalog } from '@/api/agentModels';
import { useAgentModels } from './useAgentModels';
vi.mock('@/api/agentModels', () => ({ getAgentModels: vi.fn() }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.resetAllMocks(); });
function Harness({ id }: { id: string }) {
  const { catalog, loading, error, scan } = useAgentModels(id);
  return <button onClick={() => { void scan(); }}>{loading ? 'loading' : ''}{catalog?.default_model}{error}</button>;
}
function mount(id: string) {
  const element = document.createElement('div'); document.body.appendChild(element);
  const root = createRoot(element);
  act(() => root.render(<Harness id={id} />));
  cleanup = () => { act(() => root.unmount()); element.remove(); };
  return { element, root };
}
const catalog = (name: string): RuntimeModelCatalog => ({ models: [], source: 'runtime', default_model: name });
it('ignores a previous agent response after changing the active runtime', async () => {
  let resolveOld!: (value: RuntimeModelCatalog) => void;
  vi.mocked(getAgentModels).mockImplementation(id => id === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(catalog('new model')));
  const { element, root } = mount('old');
  await act(async () => element.querySelector('button')?.click());
  act(() => root.render(<Harness id="new" />));
  await act(async () => element.querySelector('button')?.click());
  await act(async () => resolveOld(catalog('stale model')));
  expect(element.textContent).toContain('new model');
  expect(element.textContent).not.toContain('stale');
});
it('deduplicates in-flight scans and preserves last good catalog on a scan error', async () => {
  vi.mocked(getAgentModels).mockResolvedValueOnce(catalog('native model')).mockRejectedValueOnce(new Error('电脑未连接'));
  const { element } = mount('a');
  await act(async () => { element.querySelector('button')?.click(); element.querySelector('button')?.click(); });
  expect(getAgentModels).toHaveBeenCalledTimes(1);
  await act(async () => element.querySelector('button')?.click());
  expect(element.textContent).toContain('native model');
  expect(element.textContent).toContain('电脑未连接');
});
