import { expect, it } from 'vitest';
import { loadSnapshotHistory } from './reportSnapshotHistory';
import type { ReportAnalyticsResult } from '@/types/report';

it('loads actual dates individually, retains failures as gaps and uses latest successful summary', async () => {
  const calls: string[] = [];
  let final: ReportAnalyticsResult | null = null;
  const query = async (_id: string, range: string, end?: string) => {
    if (range === 'dates') return { available_dates: ['2026-07-28', '2026-07-29', '2026-07-30'] } as ReportAnalyticsResult;
    calls.push(end!);
    if (end === '2026-07-29') throw new Error('upstream unavailable');
    return { data_date: end, summary: { total_user_count: 10 }, trend: [{ dt: end }], query_ids: [] } as unknown as ReportAnalyticsResult;
  };
  await expect(loadSnapshotHistory(query, 'r', 'all', [], (result) => { final = result; })).rejects.toThrow('1 个 dt');
  expect(calls).toEqual(['2026-07-30', '2026-07-29', '2026-07-28']);
  expect(final!.summary.total_user_count).toBe(10);
  expect(final!.trend.map((point) => point.dt)).toEqual(['2026-07-28', '2026-07-30']);
  expect(final!.missing_dates).toEqual(['2026-07-29']);
});

it('stops scheduling obsolete selections', async () => {
  let active = true;
  let calls = 0;
  const query = async () => { calls++; active = false; return { available_dates: ['2026-07-28'] } as ReportAnalyticsResult; };
  await loadSnapshotHistory(query, 'r', 'all', [], () => { throw new Error('obsolete publish'); }, () => active);
  expect(calls).toBe(1);
});
