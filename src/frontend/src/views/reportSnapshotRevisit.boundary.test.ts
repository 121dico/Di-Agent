import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { loadStoredSnapshotHistory } from './reportSnapshotHistory';

it('ignores a saved response after selection cancellation without starting directory queries', async () => {
  let active = true;
  const calls: string[] = [];
  const published: (ReportAnalyticsResult | null)[] = [];
  await loadStoredSnapshotHistory(async (_id, range) => {
    calls.push(range);
    active = false;
    return { data_date: '2026-09-09', trend: [{ dt: '2026-09-09' }] } as ReportAnalyticsResult;
  }, 'report', 'all', ['北京'], result => published.push(result), () => active);
  expect(calls).toEqual(['saved']);
  expect(published).toEqual([]);
});

it('falls back to real daily data when no saved report exists, retaining the city scope', async () => {
  const calls: string[] = [];
  const published: (ReportAnalyticsResult | null)[] = [];
  await loadStoredSnapshotHistory(async (_id, range, date, cities) => {
    expect(cities).toEqual(['北京']);
    calls.push(range);
    if (range === 'saved') return { trend: [] } as unknown as ReportAnalyticsResult;
    if (range === 'dates') return { available_dates: ['2026-09-09'] } as ReportAnalyticsResult;
    return { data_date: date, trend: [{ dt: date }], summary: { total_user_count: 17 } } as ReportAnalyticsResult;
  }, 'report', 'all', ['北京'], result => published.push(result));
  expect(calls).toEqual(['saved', 'dates', '1d']);
  expect(published[published.length - 1]?.summary.total_user_count).toBe(17);
});

it('keeps saved results visible when the directory check fails', async () => {
  const published: (ReportAnalyticsResult | null)[] = [];
  await expect(loadStoredSnapshotHistory(async (_id, range) => {
    if (range === 'saved') return { start_date: '2026-09-09', data_date: '2026-09-09', trend: [{ dt: '2026-09-09' }], summary: { total_user_count: 19 } } as ReportAnalyticsResult;
    throw new Error('upstream unavailable');
  }, 'report', 'all', [], result => published.push(result))).rejects.toThrow('upstream unavailable');
  expect(published).toHaveLength(1);
  expect(published[0]?.summary.total_user_count).toBe(19);
});
