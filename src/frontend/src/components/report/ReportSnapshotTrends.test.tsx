// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { ReportSnapshotTrends, type SnapshotSeries } from './ReportSnapshotTrends';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const analytics = {
  start_date: '2026-09-07', end_date: '2026-09-09',
  trend: [
    { dt: '2026-09-07', total_user_count: 100, order_user_count: 20, distribution: [{ level: 'HIGH', user_count: 30 }], order_distribution: [{ level: 'HIGH', user_count: 4 }] },
    { dt: '2026-09-09', total_user_count: 110, order_user_count: 0, distribution: [{ level: 'HIGH', user_count: 40 }], order_distribution: [] },
  ],
} as ReportAnalyticsResult;

it('switches all three charts from independent trends to actual counts without losing hidden legends', () => {
  act(() => root.render(<ReportSnapshotTrends analytics={analytics} renderChart={(_labels, series, mode) => <output data-mode={mode}>{series.map((item) => item.key).join(',')}</output>} />));
  expect([...container.querySelectorAll('output')].map((item) => item.dataset.mode)).toEqual(['trend', 'trend', 'trend']);
  const click = (text: string) => act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === text)?.click());
  click('全量用户');
  click('真实数值');
  expect([...container.querySelectorAll('output')].map((item) => item.dataset.mode)).toEqual(['actual', 'actual', 'actual']);
  expect(container.querySelector('output')?.textContent).toBe('orders');
  click('趋势对比');
  expect(container.querySelector('output')?.dataset.mode).toBe('trend');
  expect(container.querySelector('output')?.textContent).toBe('orders');
});

it('renders three charts with calendar dt axes and preserves missing-day gaps apart from genuine zero', () => {
  const charts: { labels: string[]; series: SnapshotSeries[] }[] = [];
  act(() => root.render(<ReportSnapshotTrends analytics={analytics} renderChart={(labels, series) => { charts.push({ labels, series }); return <div data-chart />; }} />));
  expect(container.querySelectorAll('[data-chart]')).toHaveLength(3);
  for (const chart of charts) expect(chart.labels).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
  expect(charts[0]?.series[0]?.values).toEqual([100, NaN, 110]);
  expect(charts[0]?.series[1]?.values).toEqual([20, NaN, 0]);
  expect(charts[1]?.series[0]?.values).toEqual([30, NaN, 40]);
  expect(charts[2]?.series[0]?.values).toEqual([4, NaN, 0]);
});

it('lets each chart legend hide and restore its own series without hiding the other cohort', () => {
  const renderChart = (_labels: string[], series: SnapshotSeries[]) => <output>{series.map((item) => item.key).join(',')}</output>;
  act(() => root.render(<ReportSnapshotTrends analytics={analytics} renderChart={renderChart} />));
  const buttons = [...container.querySelectorAll('button')];
  const high = buttons.filter((button) => button.textContent === '高价敏');
  expect(high).toHaveLength(2);
  const button = high[0];
  if (!button) throw new Error('missing high sensitivity legend');
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelectorAll('output')[1]?.textContent).toBe('');
  expect(container.querySelectorAll('output')[2]?.textContent).not.toBe('');
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelectorAll('output')[1]?.textContent).not.toBe('');
});
