// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StationPeople } from './StationPeople';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const response = { start: '2026-08-01', end: '2026-08-02', history_start: '2026-08-01', station_id: 'ALL', fetched_at: '2026-08-02T00:00:00Z', users: 2, repeat_users: 1, multi_day_users: 1, cross_station_users: 1,
  levels: { VERY_HIGH: { users: 1, once: 1, twice: 0, three_plus: 0, multi_day: 0, cross_station: 0 } },
  days: [{ dt: '2026-08-02', users: 2, new: 1, returning: 1, previous: 1, previous_week: 1, previous_available: true, week_days_available: 1,
    levels: { VERY_HIGH: { users: 1, new: 1, returning: 0, previous_week: 0, same_level_week: 0 } } }],
};

it('loads only on request, defaults to very high and hides recalculation for ordinary users', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: response }) });
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<StationPeople reportId="report" station="ALL" dates={['2026-08-01', '2026-08-02']} isAdmin={false} renderChart={(_, series) => <div>{series.map((s) => s.label).join('/')}</div>} />));
  expect(fetcher).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('重新计算');
  await act(async () => host.querySelector('button')?.click());
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('station=ALL&start=2026-08-01&end=2026-08-02');
  expect(host.querySelector('select')?.value).toBe('VERY_HIGH');
  expect(host.textContent).toContain('仅覆盖1/7天');
  expect(host.textContent).toContain('窗口不完整');
  await act(async () => root.render(<StationPeople reportId="report" station="A" dates={['2026-08-01', '2026-08-02']} isAdmin={false} renderChart={() => null} />));
  expect(host.textContent).not.toContain('多次消费用户是什么价敏等级');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not show a late result from the previous station', async () => {
  let finish: ((value: unknown) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
  const render = (station: string) => <StationPeople reportId="report" station={station} dates={['2026-08-01', '2026-08-02']} isAdmin={false} renderChart={() => null} />;
  await act(async () => root.render(render('ALL')));
  await act(async () => host.querySelector('button')?.click());
  await act(async () => root.render(render('A')));
  await act(async () => finish?.({ ok: true, json: async () => ({ code: 0, data: response }) }));
  expect(host.textContent).not.toContain('多次消费用户是什么价敏等级');
});
