// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LocalSkillsPanel, localSkillIndex } from './LocalSkillsPanel';
vi.mock('@/utils/message', () => ({ message: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/store/agentStore', () => ({ useAgentStore: () => vi.fn() }));
vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Drawer: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div role="dialog">{children}</div> : null,
  Alert: ({ title }: { title: string }) => <span>{title}</span>,
  Empty: ({ description }: { description: string }) => <span>{description}</span>,
  Input: () => <input />,
}));
it('shows local skills immediately and opens metadata without fetching the body', async () => {
  const skill = { name: 'review', description: 'Review code', usage: 'Load review locally', source_path: '/skills/review/SKILL.md', detail: 'PRIVATE BODY' };
  const onImport = vi.fn().mockResolvedValue(undefined);
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<LocalSkillsPanel agentId="a" skills={[skill]} onImport={onImport} />));
  expect(container.textContent).toContain('Review code');
  act(() => container.querySelector('button')?.click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Load review locally');
  expect(container.textContent).not.toContain('PRIVATE BODY');
  const importButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('入库'));
  await act(async () => { importButton?.click(); });
  expect(onImport).toHaveBeenCalledWith(localSkillIndex(skill));
  expect(onImport.mock.calls[0]?.[0]).not.toHaveProperty('detail');
  act(() => root.unmount());
});
