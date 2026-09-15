import { describe, expect, it, vi } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { loadStoredSnapshotHistory } from './reportSnapshotHistory';

describe('prepared report history', () => {
  const saved = {
    prepared: true,
    data_date: '2026-09-14',
    start_date: '2026-09-01',
    end_date: '2026-09-14',
    summary: { total_user_count: 150 },
    trend: [{ dt: '2026-09-01', total_user_count: 100 }, { dt: '2026-09-14', total_user_count: 150 }],
    available_dates: ['2026-09-01', '2026-09-14'],
    missing_dates: ['2026-09-13'],
    order_groups: { '1': { user_count: 3, share: 0, distribution: [{ level: 'VERY_HIGH', user_count: 3 }] } },
  } as unknown as ReportAnalyticsResult;

  it('publishes the selected cities from one saved read without directory or daily scans', async () => {
    const query = vi.fn(async () => saved);
    const publish = vi.fn();
    await loadStoredSnapshotHistory(query, 'report-1', '7d', ['北京', '上海'], publish);
    expect(query.mock.calls).toEqual([['report-1', 'saved', undefined, ['北京', '上海']]]);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      prepared: true,
      start_date: '2026-09-08',
      summary: { total_user_count: 150 },
      trend: [{ dt: '2026-09-14', total_user_count: 150 }],
      available_dates: ['2026-09-14'],
      missing_dates: ['2026-09-13'],
      order_groups: saved.order_groups,
    });
  });

  it('keeps a cold initialization error visible without triggering fallback scans', async () => {
    const query = vi.fn(async (): Promise<ReportAnalyticsResult> => { throw new Error('报表正在后台初始化'); });
    const publish = vi.fn();
    await expect(loadStoredSnapshotHistory(query, 'report-1', 'all', [], publish)).rejects.toThrow('后台初始化');
    expect(query).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish a delayed result after the report selection changes', async () => {
    const query = vi.fn(async () => saved);
    const publish = vi.fn();
    await loadStoredSnapshotHistory(query, 'report-1', 'all', [], publish, () => false);
    expect(query).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
