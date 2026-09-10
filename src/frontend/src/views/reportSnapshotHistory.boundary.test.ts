import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { loadSnapshotHistory, type SnapshotProgress } from './reportSnapshotHistory';

const daily = (date: string): ReportAnalyticsResult => ({
  data_date: date, trend: [{ dt: date }], summary: { total_user_count: 123 },
} as ReportAnalyticsResult);

it('limits the week to latest available dt and preserves the selected cities on every API query', async () => {
  const requests: { range: string; end?: string; cities?: string[] }[] = [];
  const updates: (ReportAnalyticsResult | null)[] = [];
  await loadSnapshotHistory(async (_id, range, end, cities) => {
    requests.push({ range, end, cities });
    return range === 'dates' ? { available_dates: ['2026-08-31', '2026-09-03', '2026-09-09', '2026-09-09'] } as ReportAnalyticsResult : daily(end!);
  }, 'report', '7d', ['北京', '上海'], (result) => updates.push(result));
  expect(requests).toEqual([
    { range: 'dates', end: undefined, cities: ['北京', '上海'] },
    { range: '1d', end: '2026-09-09', cities: ['北京', '上海'] },
    { range: '1d', end: '2026-09-03', cities: ['北京', '上海'] },
  ]);
  expect(updates[updates.length - 1]).toMatchObject({ start_date: '2026-09-03', end_date: '2026-09-09', summary: { total_user_count: 123 } });
});

it('reports all failed days without publishing a fabricated zero summary', async () => {
  const updates: { result: ReportAnalyticsResult | null; progress: SnapshotProgress }[] = [];
  await expect(loadSnapshotHistory(async (_id, range) => {
    if (range === 'dates') return { available_dates: ['2026-09-08', '2026-09-09'] } as ReportAnalyticsResult;
    throw new Error('capacity exceeded');
  }, 'report', 'all', [], (result, progress) => updates.push({ result, progress }))).rejects.toThrow('2 个 dt 统计失败');
  expect(updates[updates.length - 1]).toEqual({ result: null, progress: { completed: 2, total: 2, failed: ['2026-09-09', '2026-09-08'] } });
  expect(updates.every(({ result }) => result === null)).toBe(true);
});

it('does not publish or request more dates after cancellation during an in-flight day', async () => {
  let active = true;
  const requested: string[] = [];
  const updates: (ReportAnalyticsResult | null)[] = [];
  await loadSnapshotHistory(async (_id, range, end) => {
    if (range === 'dates') return { available_dates: ['2026-09-08', '2026-09-09'] } as ReportAnalyticsResult;
    requested.push(end!);
    active = false;
    return daily(end!);
  }, 'report', 'all', [], (result) => updates.push(result), () => active);
  expect(requested).toEqual(['2026-09-09']);
  expect(updates).toEqual([null]);
});

it('rejects an empty partition directory before starting any daily query', async () => {
  const requests: string[] = [];
  await expect(loadSnapshotHistory(async (_id, range) => {
    requests.push(range);
    return { available_dates: [] } as unknown as ReportAnalyticsResult;
  }, 'report', 'all', [], () => undefined)).rejects.toThrow('没有可用的 dt 分区');
  expect(requests).toEqual(['dates']);
});
