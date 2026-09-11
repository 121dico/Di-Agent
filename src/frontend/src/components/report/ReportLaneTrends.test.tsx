// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReportLaneTrends } from './ReportLaneTrends';

it('sorts latest counts descending, gives each scale the same height, and reveals real values', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const series = [
    { key: 'small', label: '小人群', color: 'red', values: [500000, 600000] },
    { key: 'large', label: '大人群', color: 'blue', values: [200000000, 240000000] },
    { key: 'mid', label: '中人群', color: 'green', values: [5000000, 6000000] },
  ];
  try {
    act(() => root.render(<ReportLaneTrends labels={['2026-09-01', '2026-09-02']} series={series} />));
    expect([...host.querySelectorAll('section')].map(node => node.getAttribute('aria-label'))).toEqual(['大人群独立趋势', '中人群独立趋势', '小人群独立趋势']);
    for (const svg of host.querySelectorAll('svg')) expect([...svg.querySelectorAll('circle')].map(node => node.getAttribute('cy'))).toEqual(['70', '10']);
    expect(series[0]?.key).toBe('small');
    act(() => host.querySelector('rect')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('200,000,000 人');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('500,000 人');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('preserves missing observations, constant and zero values without inventing slopes', () => {
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    act(() => root.render(<ReportLaneTrends labels={['2026-09-01', '2026-09-02', '2026-09-03']} series={[{ key: 'a', label: '零', color: 'red', values: [0, NaN, 0] }]} />));
    expect(host.querySelectorAll('circle')).toHaveLength(2);
    expect([...host.querySelectorAll('circle')].map(node => node.getAttribute('cy'))).toEqual(['40', '40']);
    expect(host.querySelector('path')).toBeNull();
    expect(host.innerHTML).not.toMatch(/(?:cy|d)="[^"]*NaN/);
    act(() => root.render(<ReportLaneTrends labels={[]} series={[]} />));
    expect(host.textContent).toContain('暂无可见趋势数据');
  } finally { act(() => root.unmount()); }
});
