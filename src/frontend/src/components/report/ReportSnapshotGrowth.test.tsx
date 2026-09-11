import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { ReportSnapshotGrowth, SnapshotGrowthMetrics } from './ReportSnapshotGrowth';

const analytics = {
  start_date: '2026-09-08', end_date: '2026-09-10', data_date: '2026-09-10',
  summary: { calculated_user_count: 105, total_user_count: 200, cumulative_net_user_growth: 0 },
  trend: [100, 110, 105].map((count, i) => ({ dt: `2026-09-${String(8 + i).padStart(2, '0')}`, calculated_user_count: count, total_user_count: 200, daily_net_user_growth: 0, cumulative_net_user_growth: 0 })),
} as ReportAnalyticsResult;

it('does not use the excluded July 28 snapshot as a growth baseline', () => {
  const data = { ...analytics, start_date: '2026-07-29', end_date: '2026-07-30', data_date: '2026-07-30', trend: [999999, 100, 120].map((count, i) => ({ ...analytics.trend[0]!, dt: `2026-07-${28+i}`, calculated_user_count: count })) };
  let daily: number[] = [];
  renderToStaticMarkup(<ReportSnapshotGrowth analytics={data} renderBar={(_labels, values) => { daily = values; return null; }} renderChart={() => null} />);
  expect(daily).toEqual([NaN, 20]);
});

it('does not carry a one-day level jump into later daily increases', () => {
  const data = { ...analytics, trend: [100, 1000100, 1000220].map((count, i) => ({ ...analytics.trend[i]!, calculated_user_count: count })) };
  const curves: number[][] = [];
  renderToStaticMarkup(<ReportSnapshotGrowth analytics={data} renderBar={() => null} renderChart={(_labels, series) => { curves.push(series[0]!.values); return null; }} />);
  expect(curves[0]).toEqual([NaN, 1000000, 120]);
});

it('derives the overview and chart from retained daily snapshots instead of single-day cached zero deltas', () => {
  const html = renderToStaticMarkup(<SnapshotGrowthMetrics analytics={analytics} />);
  expect(html).not.toContain('累计净增');
  expect(html).toContain('-5');
  expect(html).toContain('-4.55');
  expect(html).toContain('+3');
  expect(html).toContain('52.5');
  const charts: number[][] = [];
  const bars: number[][] = [];
  renderToStaticMarkup(<ReportSnapshotGrowth analytics={analytics} renderBar={(_labels, values) => { bars.push(values); return null; }} renderChart={(_labels, series) => { charts.push(series[0]!.values); return null; }} />);
  expect(bars[0]).toEqual([NaN, 10, -5]);
  expect(charts[0]).toEqual([NaN, 10, -5]);
  expect(charts[1]?.[2]).toBeCloseTo(-4.54545);
  expect(charts[1]?.[0]).toBeNaN();
});

it('leaves missing calendar days and their daily comparisons unavailable without accumulating across gaps', () => {
  const partial = { ...analytics, trend: [analytics.trend[0]!, analytics.trend[2]!] };
  const bars: number[][] = [];
  const charts: number[][] = [];
  const html = renderToStaticMarkup(<ReportSnapshotGrowth analytics={partial} renderBar={(_labels, values) => { bars.push(values); return null; }} renderChart={(_labels, series) => { charts.push(series[0]!.values); return null; }} />);
  expect(bars[0]).toEqual([NaN, NaN, NaN]);
  expect(charts[0]).toEqual([NaN, NaN, NaN]);
  expect(charts[1]).toEqual([NaN, NaN, NaN]);
  expect(html).not.toContain('个连续日对');
  const metrics = renderToStaticMarkup(<SnapshotGrowthMetrics analytics={partial} />);
  expect(metrics.match(/—/g)).toHaveLength(3);
});

it('does not invent day growth from a single snapshot or a zero denominator and ignores out-of-range baselines', () => {
  const one = { ...analytics, start_date: '2026-09-10' };
  const html = renderToStaticMarkup(<SnapshotGrowthMetrics analytics={one} />);
  expect(html.match(/—/g)).toHaveLength(3);
  expect(html).not.toContain('+5');
  const zero = { ...analytics, trend: analytics.trend.map((point) => ({ ...point, calculated_user_count: 0, total_user_count: 0 })) };
  expect(renderToStaticMarkup(<SnapshotGrowthMetrics analytics={zero} />).match(/—/g)).toHaveLength(2);
});

it('keeps a genuine zero change after the first observation, without filling earlier dates', () => {
  const data = { ...analytics, start_date: '2026-09-07', trend: analytics.trend.map(point => ({ ...point, calculated_user_count: 100 })) };
  const charts: number[][] = [];
  let daily: number[] = [];
  renderToStaticMarkup(<ReportSnapshotGrowth analytics={data} renderBar={(_labels, values) => { daily = values; return null; }} renderChart={(_labels, series) => { charts.push(series[0]!.values); return null; }} />);
  expect(daily).toEqual([NaN, NaN, 0, 0]);
  expect(charts[1]).toEqual([NaN, NaN, 0, 0]);
});
