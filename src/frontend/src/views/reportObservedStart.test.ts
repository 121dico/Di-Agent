import { expect, it } from 'vitest';
import type { ReportAnalyticsResult, ReportAnalyticsTrendPoint } from '@/types/report';
import { buildPriceSensitiveAnalyticsPresentation } from './reportPresentation';

const point = (overrides: Partial<ReportAnalyticsTrendPoint> = {}): ReportAnalyticsTrendPoint => ({
  dt: '2026-09-10', calculated_user_count: 100, total_order_count: 200,
  average_price_sensitivity_score: 50, average_d1_price_score: 50,
  average_d2_coupon_score: 50, average_d3_time_score: 50, ...overrides,
});
const analytics = (trend: ReportAnalyticsTrendPoint[]): ReportAnalyticsResult => ({
  range: '7d', start_date: '2026-09-10', end_date: '2026-09-11', cached: true, duration_ms: 1,
  summary: { total_user_count: 200, calculated_user_count: 100, total_order_count: 200,
    calculated_user_share: 50, average_price_sensitivity_score: 50,
    high_sensitivity_share: 0, medium_sensitivity_share: 0, low_sensitivity_share: 100 },
  trend, distribution: [],
});

it.each([10, 0, -10])('preserves an explicitly available first-day increment of %s, including a single-day result', (value) => {
  const result = buildPriceSensitiveAnalyticsPresentation(analytics([point({ daily_growth_available: true, daily_net_user_growth: value, daily_user_growth_rate: value })]));
  expect(result.incrementSeries[0]?.values).toEqual([value]);
  expect(result.growthRateSeries[0]?.values).toEqual([value]);
  expect(result.metrics.find((metric) => metric.label === '最近一日净增')?.value).toBe(value > 0 ? `+${value}` : `${value}`);
});

it.each([undefined, false])('leaves an unavailable first-day placeholder empty when availability is %s', (available) => {
  const result = buildPriceSensitiveAnalyticsPresentation(analytics([point({ daily_growth_available: available, daily_net_user_growth: 0, daily_user_growth_rate: 0 })]));
  expect(result.incrementSeries[0]?.values).toEqual([NaN]);
  expect(result.growthRateSeries[0]?.values).toEqual([NaN]);
  expect(result.cumulativeSeries[0]?.values).toEqual([0]);
});

it('retains a genuine zero after an unknown first day, including chronologically unordered input', () => {
  const result = buildPriceSensitiveAnalyticsPresentation(analytics([point({ dt: '2026-09-11' }), point()]));
  expect(result.incrementSeries[0]?.values).toEqual([NaN, 0]);
  expect(result.growthRateSeries[0]?.values).toEqual([NaN, 0]);
});

it('does not expose NaN in single-day unknown growth metric cards', () => {
  const result = buildPriceSensitiveAnalyticsPresentation(analytics([point()]));
  expect(result.metrics.find((metric) => metric.label === '最近一日净增')?.value).toBe('—');
  expect(result.metrics.find((metric) => metric.label === '最近一日增长率')?.value).toBe('—');
});
