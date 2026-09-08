// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SkillsView from './SkillsView';
const { fetchAgents, selectAgent } = vi.hoisted(() => ({ fetchAgents: vi.fn().mockResolvedValue(undefined), selectAgent: vi.fn() }));
vi.mock('@/store/agentStore', () => ({ useAgentStore: (selector: (state: unknown) => unknown) => selector({ fetchAgents, agents: [{ id: 'a', name: 'Codex', cli_tool: 'codex' }, { id: 'b', name: 'Claude', cli_tool: 'claude' }] }) }));
vi.mock('@/store/uiStore', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector({ selectedAgentId: null, setSelectedAgent: selectAgent }) }));
vi.mock('@/components/agent/AgentSkillsPanel', () => ({ AgentSkillsPanel: ({ agent }: { agent: { name: string } }) => <div>{agent.name} local skills panel</div> }));
vi.mock('antd', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Select: ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) => <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
  Alert: () => <span>error</span>, Empty: () => <span>empty</span>, Spin: () => <span>loading</span>,
}));
it('defaults to the first agent and uses a compact header selector to switch agents', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<SkillsView />));
  expect(container.textContent).toContain('Codex local skills panel');
  const selector = container.querySelector('header select') as HTMLSelectElement;
  expect(selector.value).toBe('a');
  act(() => { selector.value = 'b'; selector.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(selectAgent).toHaveBeenCalledWith('b');
  expect(fetchAgents).toHaveBeenCalledWith(true);
  act(() => root.unmount());
});
