// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReportSelector } from './ReportSelector';

it('opens the report directory, switches the selected report and collapses the options', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [selectedId, setSelectedId] = useState('v12');
    return <><ReportSelector reports={[{ id: 'v12', name: '价敏用户报表 V1.2' }, { id: 'original', name: '价敏用户报表' }]} selectedId={selectedId} onSelect={setSelectedId} /><output>{selectedId}</output></>;
  }
  try {
    await act(async () => root.render(<Harness />));
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input.getAttribute('aria-label')).toBe('报表目录');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await act(async () => input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const option = [...document.querySelectorAll('[title="价敏用户报表"]')].find(element => element.textContent === '价敏用户报表')!;
    expect(option).toBeTruthy();
    await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('output')?.textContent).toBe('original');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
