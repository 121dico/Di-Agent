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

it('selects a colored lane segment, expands its real event and filters by type', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<ExecutionTraceButton blocks={[
    { index: 0, kind: 'text', text: 'Public model output' },
    { index: 1, kind: 'thinking', text: 'PRIVATE REASONING' },
    { index: 2, kind: 'tool_use', tool_name: 'load_skill', tool_kind: 'skill', skill_name: 'review', text: '{"name":"review"}' },
  ]} />));
  act(() => container.querySelector('button')?.click());
  expect(container.textContent).not.toContain('PRIVATE REASONING');
  expect(container.textContent).toContain('无时间戳');
  const segment = container.querySelector('[aria-label="定位事件：review"]');
  expect(segment).not.toBeNull();
  act(() => segment?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('details[open]')?.textContent).toContain('review');
  const filter = container.querySelector<HTMLSelectElement>('[aria-label="筛选事件类型"]')!;
  act(() => { filter.value = 'skill'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('[aria-label="事件列表"]')?.textContent).not.toContain('Public model output');
  act(() => root.unmount());
});

it('keeps simultaneous tool bars separately selectable and puts untimed input outside the time axis', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<ExecutionTraceButton input={{ text: 'Please search' }} blocks={[
    { index: 0, kind: 'tool_use', tool_name: 'first', tool_use_id: 'a', text: '', started_at: '2026-09-08T09:00:00Z', ended_at: '2026-09-08T09:00:04Z' },
    { index: 1, kind: 'tool_use', tool_name: 'second', tool_use_id: 'b', text: '', started_at: '2026-09-08T09:00:00Z', ended_at: '2026-09-08T09:00:04Z' },
  ]} />));
  act(() => container.querySelector('button')?.click());
  const a = container.querySelector('[aria-label="定位事件：first"]');
  const b = container.querySelector('[aria-label="定位事件：second"]');
  expect(a?.getAttribute('y')).not.toBe(b?.getAttribute('y'));
  const input = container.querySelector('[aria-label="定位事件：用户输入"]');
  expect(input?.tagName).toBe('BUTTON');
  expect(input?.textContent).toContain('无时间戳');
  act(() => root.unmount());
});

it('lets the native summary collapse and a subsequent bar click reopen the selected row', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ExecutionTraceButton blocks={[{ index: 0, kind: 'tool_use', tool_name: 'search', text: 'query' }]} />));
  act(() => container.querySelector('button')?.click());
  const row = container.querySelector('details')!;
  const summary = row.querySelector('summary')!;
  act(() => summary.click());
  expect(row.open).toBe(true);
  act(() => summary.click());
  expect(row.open).toBe(false);
  act(() => container.querySelector('[aria-label="定位事件：search"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(row.open).toBe(true);
  act(() => root.unmount());
  container.remove();
});
