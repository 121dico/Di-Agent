// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StationScoreEvidence } from './StationScoreEvidence';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (station: string, isAdmin = true) => <StationScoreEvidence reportId="report" station={station} start="2026-08-01" end="2026-08-02" valid isAdmin={isAdmin} />;

it('requires an administrator and single station, then opens real evidence with missing fields explicit', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {
    station_id: 'A', start: '2026-08-01', end: '2026-08-02', level: 'VERY_HIGH', min_days: 2, candidate_count: 1, limit: 20, fetched_at: '2026-08-03T00:00:00Z',
    cases: [{ duid: '123', consumption_days: 2, orders: 4, first_date: '2026-08-01', last_date: '2026-08-02', label_date: '2026-08-02', level: 'VERY_HIGH', status: 'matched', reason: '', fields: { ps_score: 92, price_score: 96, ps_conf: 0.8 }, observed_contributions: { price: 48, coupon: 23.279999999999998, time: null } }],
  } }) });
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(render('A', false)));
  expect(host.textContent).toBe('');
  await act(async () => root.render(render('ALL')));
  expect(host.textContent).toContain('请选择单个场站');
  expect(host.querySelector('button')?.disabled).toBe(true);
  await act(async () => root.render(render('A')));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')?.click());
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('station=A&start=2026-08-01&end=2026-08-02&level=VERY_HIGH&min_days=2');
  expect(host.textContent).toContain('DUID 123');
  const caseSummary = [...host.querySelectorAll('summary')].find((summary) => summary.textContent?.includes('DUID 123'));
  await act(async () => caseSummary?.click());
  expect(caseSummary?.parentElement?.hasAttribute('open')).toBe(true);
  expect(host.textContent).toContain('48');
  expect(host.textContent).toContain('23.28');
  expect(host.textContent).not.toContain('23.279999');
  expect(host.textContent).toContain('未提供');
  expect(host.textContent).toContain('价格加权贡献最大');
  expect(host.textContent).not.toContain('用于对照，未核验线上版本');
  expect(host.textContent).not.toContain('查询于');
  expect(host.textContent).not.toContain('长期用户');
});

it('isolates old station responses and displays unavailable evidence without inferring a score', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {
    station_id: 'B', start: '2026-08-01', end: '2026-08-02', level: 'VERY_HIGH', min_days: 2, candidate_count: 1, limit: 20, fetched_at: '2026-08-03T00:00:00Z',
    cases: [{ duid: '456', consumption_days: 2, orders: 4, first_date: '2026-08-01', last_date: '2026-08-02', label_date: '2026-08-02', level: 'VERY_HIGH', status: 'unavailable', reason: '同日标签不唯一', fields: {}, observed_contributions: { price: null, coupon: null, time: null } }],
  } }) });
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(render('A')));
  await act(async () => host.querySelector('button')?.click());
  await act(async () => root.render(render('B')));
  await act(async () => finish?.({ ok: true, json: async () => ({ code: 0, data: { candidate_count: 999, cases: [] } }) }));
  expect(host.textContent).not.toContain('999');
  await act(async () => host.querySelector('button')?.click());
  await act(async () => [...host.querySelectorAll('summary')].find((summary) => summary.textContent?.includes('DUID 456'))?.click());
  expect(host.textContent).toContain('同日标签不唯一');
  expect(host.textContent).not.toContain('价格 × 50%');
});

it('queries the selected high cohort and minimum days, with retry and explicit empty results', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {
    station_id: 'A', start: '2026-08-01', end: '2026-08-02', level: 'HIGH', min_days: 3, candidate_count: 0, limit: 20, fetched_at: '2026-08-03T00:00:00Z', cases: [],
  } }) });
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(render('A')));
  await act(async () => {
    const select = host.querySelector('select');
    if (select) { select.value = 'HIGH'; select.dispatchEvent(new Event('change', { bubbles: true })); }
    const input = host.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '3');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')?.click());
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('level=HIGH&min_days=3');
  expect(host.textContent).toContain('网络连接失败');
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('重试判分依据'))?.click());
  expect(host.textContent).toContain('当前场站和区间没有符合条件的用户');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
