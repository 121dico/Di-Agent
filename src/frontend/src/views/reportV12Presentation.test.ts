import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { buildPriceSensitiveAnalyticsPresentation } from './reportPresentation';

it('preserves V1.2 null scores, additional levels, prior assignment and negative snapshot changes', () => {
  const analytics: ReportAnalyticsResult = {
    profile: 'price_sensitive_v1_2', range: '7d', start_date: '2026-09-03', end_date: '2026-09-09', cached: false, duration_ms: 1,
    summary: { total_user_count: 100, total_order_count: 300, calculated_user_count: 40, calculated_user_share: 40, average_price_sensitivity_score: 50, high_sensitivity_share: 0, medium_sensitivity_share: 100, low_sensitivity_share: 0 },
    assigned_by_type: { PRIOR: 30 },
    trend: [
      { dt: '2026-09-08', calculated_user_count: 50, total_order_count: 350, average_price_sensitivity_score: 60, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, nullable_scores: { price: 60, d1: null, d2: 0, d3: null } },
      { dt: '2026-09-09', calculated_user_count: 40, total_order_count: 300, average_price_sensitivity_score: 50, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, nullable_scores: { price: 50, d1: null, d2: 0, d3: null } },
    ],
    distribution: [{ level: 'MEDIUM_LOW', user_count: 20 }, { level: 'NEW_LEVEL', user_count: 5 }, { level: 'MEDIUM_HIGH', user_count: 15 }],
  };
  const result = buildPriceSensitiveAnalyticsPresentation(analytics);
  expect(result.metrics).toContainEqual({ label: '先验赋分用户', value: '30', suffix: '人' });
  expect(result.metrics).toContainEqual({ label: '标签记录的180天订单数', value: '300', suffix: '单' });
  expect(result.scoreSeries.find((series) => series.key === 'd1')?.values.every(Number.isNaN)).toBe(true);
  expect(result.scoreSeries.find((series) => series.key === 'd2')?.values).toEqual([0, 0]);
  expect(result.incrementSeries[0]?.values).toEqual([0, -10]);
  expect(result.growthRateSeries[0]?.values).toEqual([0, -20]);
  expect(result.distribution).toEqual([{ label: '中高价敏', value: 15 }, { label: '中低价敏', value: 20 }, { label: 'NEW_LEVEL', value: 5 }]);
});
