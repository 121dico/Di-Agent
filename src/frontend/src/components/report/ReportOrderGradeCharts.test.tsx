// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { queryReportOrderCohort } from '@/api/report';
import type { ReportAnalyticsResult } from '@/types/report';
import { ReportOrderCountDistribution } from './ReportOrderCountDistribution';

vi.mock('@/api/report', () => ({ queryReportOrderCohort: vi.fn() }));
const response = (high: number, low: number) => ({ order_cohort: { user_count: high + low, distribution: [{ level: 'HIGH', user_count: high }, { level: 'LOW', user_count: low }] } }) as ReportAnalyticsResult;
const choose = (host: HTMLElement, value: string) => act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });

it('charts real people and independent same-grade percentages and filters without changing denominators', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response(40, 160)).mockResolvedValueOnce(response(20, 40));
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[{ label: '高价敏', value: 1000 }]} />));
    await choose(host, '1');
    const chart = host.querySelector('section[aria-label="订单人数与同等级占比"]')!;
    expect(chart).not.toBeNull();
    expect(chart.querySelectorAll('input[type="checkbox"]')).toHaveLength(7);
    const high = chart.querySelector('[aria-label="同等级占比 高价敏：20 人，占同等级 50.00%，同等级基数 40 人"]')!;
    expect(high).not.toBeNull();
    await act(async () => (high as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(chart.querySelector('[role="status"]')?.textContent).toContain('高价敏：20 人 · 占同等级 50.00% · 同等级基数 40 人');
    await act(async () => (chart.querySelector('input[aria-label="显示低价敏"]') as HTMLInputElement).click());
    expect(chart.querySelector('[aria-label^="同等级占比 低价敏"]')).toBeNull();
    expect(chart.querySelector('[aria-label^="同等级占比 高价敏"]')?.getAttribute('aria-label')).toContain('50.00%');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('keeps missing and zero denominators unavailable while a true zero numerator remains zero', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(queryReportOrderCohort).mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(20, 0)).mockResolvedValueOnce(response(40, 0));
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[]} />));
    await choose(host, '1');
    const chart = host.querySelector('section[aria-label="订单人数与同等级占比"]')!;
    expect(chart.querySelector('[aria-label^="同等级占比 高价敏"]')?.getAttribute('aria-label')).toContain('占同等级 —');
    expect(chart.querySelector('[aria-label^="各等级人数 低价敏"]')?.getAttribute('aria-label')).toContain('低价敏：0 人');
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '重试同等级基数')!.click());
    expect(chart.querySelector('[aria-label^="同等级占比 高价敏"]')?.getAttribute('aria-label')).toContain('50.00%');
    expect(chart.querySelector('[aria-label^="同等级占比 低价敏"]')?.getAttribute('aria-label')).toContain('占同等级 —');
    expect(chart.innerHTML).not.toContain('NaN');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('recovers all-off selection and preserves filters while new order groups load without stale bars', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: ReportAnalyticsResult) => void;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response(40, 160)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[]} />));
    const chart = host.querySelector('section[aria-label="订单人数与同等级占比"]')!;
    await act(async () => chart.querySelectorAll<HTMLInputElement>('input').forEach((input) => input.click()));
    expect(chart.textContent).toContain('请选择至少一个价敏等级');
    expect(chart.querySelector('svg[aria-label="同等级占比柱状图"]')).toBeNull();
    await act(async () => chart.querySelector('button')!.click());
    expect([...chart.querySelectorAll<HTMLInputElement>('input')].every((input) => input.checked)).toBe(true);
    await act(async () => (chart.querySelector('input[aria-label="显示低价敏"]') as HTMLInputElement).click());
    await choose(host, '1');
    expect(chart.getAttribute('aria-busy')).toBe('true');
    expect(chart.querySelector('svg[aria-label="各等级人数柱状图"]')).toBeNull();
    expect((chart.querySelector('input[aria-label="显示低价敏"]') as HTMLInputElement).checked).toBe(false);
    await act(async () => finish(response(20, 40)));
    expect(chart.querySelector('[aria-label^="同等级占比 低价敏"]')).toBeNull();
    expect(chart.querySelector('[aria-label^="同等级占比 高价敏"]')?.getAttribute('aria-label')).toContain('50.00%');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
