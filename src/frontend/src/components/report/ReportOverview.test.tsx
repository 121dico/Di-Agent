// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { ReportCohortSections } from './ReportCohortSections';

const fixture: ReportAnalyticsResult = {
  data_date: '2026-09-14', start_date: '2026-09-13', end_date: '2026-09-14', range: '7d', cached: true, duration_ms: 0,
  summary: { total_user_count: 1000, calculated_user_count: 900, calculated_user_share: 90, total_order_count: 12500, average_price_sensitivity_score: 42.35, high_sensitivity_share: 0, medium_sensitivity_share: 0, low_sensitivity_share: 0 },
  order_cohort: { user_count: 200, share: 20, distribution: [] }, assigned_by_type: { PRIOR: 700 },
  distribution: [{ level: 'VERY_HIGH', user_count: 12 }, { level: 'HIGH', user_count: 35 }],
  trend: [
    { dt: '2026-09-13', calculated_user_count: 890, average_price_sensitivity_score: 0, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, total_order_count: 0 },
    { dt: '2026-09-14', calculated_user_count: 900, average_price_sensitivity_score: 42.35, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, total_order_count: 12500, nullable_scores: { price: 42.35 } },
  ],
};
function overview(data: ReportAnalyticsResult) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ReportCohortSections analytics={data} loading={false} error="" renderDistribution={() => null} />);
  return host.querySelector('#report-overview')!;
}
it('renders eight real snapshot metrics and compact continuous-day growth without requesting another dataset', () => {
  const section = overview(fixture);
  const cards = [...section.querySelectorAll('[data-overview-metric]')];
  expect(cards).toHaveLength(8);
  expect(cards.map(card => card.textContent)).toEqual([
    '全量用户1,000人', '已赋分用户900人', '有订单人群200人',
    '价敏均分42.35分', '极高价敏12人', '高价敏35人',
    '画像订单量12,500笔', '先验赋分人群700人',
  ]);
  expect(section.textContent).toContain('最近一日净增+10人');
  expect(section.textContent).not.toContain('相邻连续 dt 快照差');
});
it('keeps missing scores and cohorts unavailable while preserving true zero values', () => {
  const data = { ...fixture, order_cohort: undefined, assigned_by_type: undefined,
    trend: [ { ...fixture.trend[1]!, nullable_scores: { price: null } } ], distribution: [] };
  const section = overview(data);
  expect(section.querySelector('[data-overview-metric="价敏均分"]')?.textContent).toContain('—');
  expect(section.querySelector('[data-overview-metric="有订单人群"]')?.textContent).toContain('—');
  expect(section.querySelector('[data-overview-metric="先验赋分人群"]')?.textContent).toContain('—');
  expect(section.textContent).toContain('最近一日净增—');
  const zeros = overview({ ...fixture, assigned_by_type: { OBSERVED: 900 }, trend: [{ ...fixture.trend[1]!, nullable_scores: { price: 0 } }] });
  expect(zeros.querySelector('[data-overview-metric="价敏均分"]')?.textContent).toContain('0分');
  expect(zeros.querySelector('[data-overview-metric="先验赋分人群"]')?.textContent).toContain('0人');
  const noScored = overview({ ...fixture, summary: { ...fixture.summary, calculated_user_count: 0, average_price_sensitivity_score: 0 }, trend: [], distribution: [] });
  expect(noScored.querySelector('[data-overview-metric="价敏均分"]')?.textContent).toContain('—');
  expect(noScored.querySelector('[data-overview-metric="极高价敏"]')?.textContent).toBe('极高价敏0人');
  expect(noScored.querySelector('[data-overview-metric="高价敏"]')?.textContent).toBe('高价敏0人');
});
