// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ExecutionTraceButton } from './ExecutionTraceButton';
vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Drawer: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div role="dialog">{children}</div> : null,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Empty: ({ description }: { description: string }) => <span>{description}</span>,
}));
it('keeps event details out of the reply until the execution drawer is opened', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<ExecutionTraceButton blocks={[{ index: 0, kind: 'tool_use', tool_name: 'search', tool_kind: 'mcp', server_name: 'docs', text: 'query' }]} />));
  expect(container.textContent).toBe('查看执行链路');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  act(() => container.querySelector('button')?.click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('docs');
  expect(container.textContent).toContain('未收到结果');
  expect(container.textContent).toContain('query');
  act(() => root.unmount());
});
