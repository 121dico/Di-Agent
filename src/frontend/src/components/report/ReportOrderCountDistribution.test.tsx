// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { queryReportOrderCohort } from '@/api/report';
import { ReportOrderCountDistribution } from './ReportOrderCountDistribution';

vi.mock('@/api/report', () => ({ queryReportOrderCohort: vi.fn() }));

it('switches prepared order groups immediately without any request', async () => {
  vi.mocked(queryReportOrderCohort).mockReset();
  const host = document.createElement('div'); const root = createRoot(host);
  const cohort = (n: number) => ({user_count:n, share:0, distribution:[{level:'VERY_HIGH',user_count:n}]});
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-14" cities={['北京市']} all={[]} preparedGroups={{all:cohort(10),'1':cohort(3)}} />));
    act(() => {const select=host.querySelector('select')!;select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.textContent).toContain('3 人');
    expect(host.textContent).toContain('30.00%');
    expect(host.textContent).not.toContain('正在查询');
    expect(queryReportOrderCohort).not.toHaveBeenCalled();
  } finally {act(()=>root.unmount());}
});

it('shows loading rather than an empty statistic inside the actual chart while an order group is pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(queryReportOrderCohort).mockReset()
    .mockResolvedValueOnce({ order_cohort: { user_count: 40, distribution: [{ level: 'HIGH', user_count: 40 }] } } as ReportAnalyticsResult)
    .mockImplementationOnce(() => new Promise(() => {}));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[{ label: '高价敏', value: 100 }]} />));
    await act(async () => { const select = host.querySelector('select')!; select.value = '9'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const chart = host.querySelector('section[aria-label="9 笔订单人群价敏分布"]')!;
    expect(chart.textContent).not.toContain('尚无可用统计');
    expect(chart.textContent).not.toContain('未加载');
    expect(chart.textContent).toContain('正在加载');
    expect(chart.getAttribute('aria-busy')).toBe('true');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('immediately reuses successful groups within the current scope without refetching or loading flicker', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (n: number) => ({ order_cohort: { user_count: n, distribution: [{ level: 'HIGH', user_count: n }] } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValue(response(9)).mockResolvedValueOnce(response(40)).mockResolvedValueOnce(response(9)).mockResolvedValueOnce(response(10));
  const host = document.createElement('div');
  const root = createRoot(host);
  const choose = async (value: string) => act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[]} />));
    await choose('9');
    await choose('10');
    await choose('9');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(3);
    const chart = host.querySelector('section[aria-label="9 笔订单人群价敏分布"]')!;
    expect(chart.getAttribute('aria-busy')).toBe('false');
    expect(chart.textContent).toContain('9 人');
    expect(host.querySelector('tbody tr')?.lastElementChild?.textContent).toBe('22.50%');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('expires the baseline and selected-group cache after ten minutes and clears it when the scope changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000000);
  const response = (n: number) => ({ order_cohort: { user_count: n, distribution: [{ level: 'HIGH', user_count: n }] } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValue(response(20));
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = (date: string) => root.render(<ReportOrderCountDistribution reportId="r" date={date} cities={[]} all={[]} />);
  const choose = async (value: string) => act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  try {
    await act(async () => render('2026-09-13'));
    await choose('9');
    await choose('all');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1600001);
    await choose('9');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(4);
    expect(queryReportOrderCohort).toHaveBeenNthCalledWith(3, 'r', '2026-09-13', 'all', []);
    expect(queryReportOrderCohort).toHaveBeenNthCalledWith(4, 'r', '2026-09-13', '9', []);
    await act(async () => render('2026-09-14'));
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(6);
    await act(async () => render('2026-09-13'));
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(8);
  } finally { act(() => root.unmount()); now.mockRestore(); vi.unstubAllGlobals(); }
});

it('never caches failed groups and retries when the user selects the group again', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = { order_cohort: { user_count: 9, distribution: [{ level: 'HIGH', user_count: 9 }] } } as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response);
  const host = document.createElement('div');
  const root = createRoot(host);
  const choose = async (value: string) => act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[]} />));
    await choose('9');
    expect(host.textContent).toContain('该组人群查询失败');
    await choose('all');
    await choose('9');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain('该组人群查询失败');
    expect(host.querySelector('section[aria-label="9 笔订单人群价敏分布"]')?.textContent).toContain('9 人');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('keeps the displayed successful scope after TTL on unrelated renders and while another group finishes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000000);
  const response = (n: number) => ({ order_cohort: { user_count: n, distribution: [{ level: 'HIGH', user_count: n }] } }) as ReportAnalyticsResult;
  let finish!: (result: ReportAnalyticsResult) => void;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response(40)).mockResolvedValueOnce(response(9)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[{ label: '高价敏', value: 100 }]} />);
  const choose = async (value: string) => act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  try {
    await act(async () => render());
    await choose('9');
    now.mockReturnValue(1599999);
    await choose('10');
    now.mockReturnValue(1600001);
    await act(async () => finish(response(10)));
    expect(host.textContent).not.toContain('同等级基数加载中');
    expect(host.querySelector('tbody tr')?.lastElementChild?.textContent).toBe('25.00%');
    now.mockReturnValue(2200002);
    await act(async () => render());
    const chart = host.querySelector('section[aria-label="10 笔订单人群价敏分布"]')!;
    expect(chart.getAttribute('aria-busy')).toBe('false');
    expect(chart.textContent).toContain('10 人');
    expect(host.querySelector('tbody tr')?.lastElementChild?.textContent).toBe('25.00%');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(3);
  } finally { act(() => root.unmount()); now.mockRestore(); vi.unstubAllGlobals(); }
});

it('preserves loaded group statistics while the denominator fails and retries only that baseline', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (distribution: Array<{ level: string; user_count: number }>) => ({ order_cohort: { user_count: 10, distribution } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response([{ level: 'HIGH', user_count: 10 }]))
    .mockResolvedValueOnce(response([{ level: 'HIGH', user_count: 40 }, { level: 'LOW', user_count: 0 }]));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[{ label: '低价敏', value: 100 }, { label: '极高价敏', value: 5 }]} />));
    expect(host.textContent).not.toContain('正在查询全部有订单人群');
    await act(async () => { const select = host.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const row = () => [...host.querySelectorAll('tbody tr')].find((item) => item.querySelector('th')?.textContent === '高价敏')!;
    expect(row().textContent).toContain('10 人100.00%');
    expect(row().lastElementChild?.textContent).toBe('—');
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试同等级基数')!;
    await act(async () => retry.click());
    expect(row().lastElementChild?.textContent).toBe('25.00%');
    expect(queryReportOrderCohort).toHaveBeenLastCalledWith('r', '2026-09-13', 'all', []);
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(3);
    for (const label of ['低价敏', '极高价敏']) {
      expect([...host.querySelectorAll('tbody tr')].find((item) => item.querySelector('th')?.textContent === label)?.lastElementChild?.textContent).toBe('—');
    }
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('invalidates both scopes immediately and ignores a delayed older city denominator', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (high: number) => ({ order_cohort: { user_count: high, distribution: [{ level: 'HIGH', user_count: high }] } }) as ReportAnalyticsResult;
  let oldBaseline!: (value: ReportAnalyticsResult) => void;
  let newBaseline!: (value: ReportAnalyticsResult) => void;
  vi.mocked(queryReportOrderCohort).mockReset()
    .mockImplementationOnce(() => new Promise((resolve) => { oldBaseline = resolve; }))
    .mockResolvedValueOnce(response(10))
    .mockImplementationOnce(() => new Promise((resolve) => { newBaseline = resolve; }))
    .mockResolvedValueOnce(response(20));
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = (cities: string[]) => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={cities} all={[]} />);
  try {
    await act(async () => render(['北京']));
    await act(async () => { const select = host.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const share = () => host.querySelector('tbody tr')?.lastElementChild?.textContent;
    expect(share()).toBe('—');
    await act(async () => render(['上海']));
    expect(host.textContent).toContain('20 人');
    expect(share()).toBe('—');
    await act(async () => oldBaseline(response(10)));
    expect(share()).toBe('—');
    await act(async () => newBaseline(response(80)));
    expect(share()).toBe('25.00%');
    expect(queryReportOrderCohort).toHaveBeenLastCalledWith('r', '2026-09-13', '1', ['上海']);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('keeps group share and uses the matching all-orders grade as the independent denominator', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (high: number, low: number) => ({ order_cohort: { user_count: high + low, distribution: [{ level: 'HIGH', user_count: high }, { level: 'LOW', user_count: low }] } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response(40, 160)).mockResolvedValueOnce(response(10, 10));
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReportOrderCountDistribution reportId="r" date="2026-09-13" cities={[]} all={[{ label: '高价敏', value: 1000 }]} />));
    expect(host.textContent).toContain('占同等级总人数');
    expect(host.textContent).toContain('100.00%');
    await act(async () => { const select = host.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const row = [...host.querySelectorAll('tbody tr')].find((item) => item.querySelector('th')?.textContent === '高价敏')!;
    expect(row.textContent).toContain('50.00%');
    expect(row.lastElementChild?.textContent).toBe('25.00%');
    await act(async () => (row.querySelector('[aria-label="1 笔订单人群 高价敏 人数与占比"]') as HTMLButtonElement).click());
    expect(row.lastElementChild?.textContent).toBe('25.00%');
    expect(queryReportOrderCohort).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});

it('selects exact 1–10 and >10 orders and shows real cohort counts and within-cohort percentages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (n: number) => ({ data_date: '2026-09-13', order_cohort: { user_count: n + 3, share: 0, distribution: [{ level: 'HIGH', user_count: 3 }, { level: 'LOW', user_count: n }] } }) as ReportAnalyticsResult;
  vi.mocked(queryReportOrderCohort).mockReset().mockResolvedValueOnce(response(7)).mockResolvedValueOnce(response(9));
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
