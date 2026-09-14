// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { queryReportOrderCohort } from '@/api/report';
import { ReportOrderCountDistribution } from './ReportOrderCountDistribution';

vi.mock('@/api/report', () => ({ queryReportOrderCohort: vi.fn() }));

it('selects exact 1–10 and >10 orders and shows real cohort counts and within-cohort percentages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (n: number) => ({ data_date: '2026-09-13', order_cohort: { user_count: n + 3, share: 0, distribution: [{ level: 'HIGH', user_count: 3 }, { level: 'LOW', user_count: n }] } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockResolvedValueOnce(response(7)).mockResolvedValueOnce(response(9));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={['北京']} all={[{ label: '低价敏', value: 100 }]} />));
    const select = host.querySelector('select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['all', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'gt10']);
    expect(host.textContent).toContain('30.00%');
    await act(async () => { select.value = 'gt10'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(queryReportOrderCohort).toHaveBeenLastCalledWith('r', '2026-09-13', 'gt10', ['北京']);
    expect(host.textContent).toContain('12 人');
    expect(host.textContent).toContain('25.00%');
    expect(host.textContent).toContain('超过 10 笔');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('discards stale selections and shows query errors without old counts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolveOld!: (value: ReportAnalyticsResult) => void;
  vi.mocked(queryReportOrderCohort).mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockRejectedValueOnce(new Error('offline'));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[]} />));
    await act(async () => { const select = host.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => resolveOld({ order_cohort: { user_count: 999, distribution: [{ level: 'HIGH', user_count: 999 }] } } as ReportAnalyticsResult));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('查询失败');
    expect(host.textContent).not.toContain('999');
    expect(host.querySelector('section[aria-label="1 笔订单人群价敏分布"]')?.textContent).toContain('尚无可用统计');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
