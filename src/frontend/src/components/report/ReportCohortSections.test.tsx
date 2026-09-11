import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ReportAnalyticsResult } from '@/types/report';
import { ReportCohortSections } from './ReportCohortSections';

it('separates all users and positive-confidence users without inventing daily additions', () => {
  const analytics: ReportAnalyticsResult = {
    range: '1d', start_date: '2026-09-09', end_date: '2026-09-09', data_date: '2026-09-09', cached: false, duration_ms: 1,
    summary: { total_user_count: 100, total_order_count: 300, calculated_user_count: 90, calculated_user_share: 90, average_price_sensitivity_score: 50, high_sensitivity_share: 0, medium_sensitivity_share: 0, low_sensitivity_share: 100 },
    trend: [], distribution: [{ level: 'LOW', user_count: 90 }],
    order_cohort: { user_count: 20, share: 20, distribution: [{ level: 'HIGH', user_count: 20 }] },
  };
  const html = renderToStaticMarkup(<ReportCohortSections analytics={analytics} loading={false} error="" renderDistribution={(items) => <div>{JSON.stringify(items)}</div>} />);
  expect(html).toContain('全量人群');
  expect(html).toContain('有订单人群');
  expect(html).toContain('20%');
  expect(html).toContain('未赋分');
  expect(html).not.toContain('首次新增标签用户');
  expect(html).not.toContain('订单发生日新增');
  expect(html).not.toContain('待接入');
  expect(html).not.toContain('每日价敏用户净增');
});

it('keeps unavailable statistics distinct from genuine zero', () => {
  const html = renderToStaticMarkup(<ReportCohortSections analytics={null} loading={false} error="资源限制" renderDistribution={() => null} />);
  expect(html).toContain('资源限制');
  expect(html).toContain('尚无可用统计');
  expect(html).not.toContain('0%');
});

it('wires filtered snapshot increments into the overview and keeps report sections in order', () => {
  const analytics: ReportAnalyticsResult = {
    range: '7d', start_date: '2026-09-09', end_date: '2026-09-10', data_date: '2026-09-10', cached: true, duration_ms: 1,
    summary: { total_user_count: 200, total_order_count: 300, calculated_user_count: 105, calculated_user_share: 52.5, average_price_sensitivity_score: 50, high_sensitivity_share: 0, medium_sensitivity_share: 0, low_sensitivity_share: 100 },
    trend: [100, 110, 105].map((count, index) => ({
      dt: `2026-09-${String(8 + index).padStart(2, '0')}`, calculated_user_count: count, total_user_count: 200,
      total_order_count: 300, average_price_sensitivity_score: 50,
      average_d1_price_score: 50, average_d2_coupon_score: 50, average_d3_time_score: 50,
    })),
    distribution: [],
    order_cohort: { user_count: 20, share: 10, distribution: [] },
  };
  const bars: Array<{ labels: string[]; values: number[] }> = [];
  const growthCharts: number[][] = [];
  const html = renderToStaticMarkup(<ReportCohortSections analytics={analytics} loading={false} error=""
    renderDistribution={() => null} renderChart={() => <div>snapshot trends</div>}
    renderGrowthChart={(_labels, series) => { growthCharts.push(series[0]!.values); return null; }}
    renderBar={(labels, values) => { bars.push({ labels, values }); return null; }} />);
  expect(bars).toEqual([{ labels: ['2026-09-09', '2026-09-10'], values: [NaN, -5] }]);
  expect(growthCharts[0]).toEqual([NaN, -5]);
  expect(growthCharts[1]?.[1]).toBeCloseTo(-4.54545);
  expect(html).not.toContain('累计净增');
  expect(html).not.toContain('个连续日对');
  expect(html).not.toContain('+5');
  const sections = ['report-overview', 'report-order-cohort', 'report-increments', 'report-trend'];
  const positions = sections.map((id) => html.indexOf(`id="${id}"`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

it('hides explanatory banners while retaining actionable errors and empty states', () => {
  const html = renderToStaticMarkup(<ReportCohortSections analytics={null} loading={false} error="连接失败"
    progress="已载入保存的 dt 快照，共 45 天" renderDistribution={() => null} renderChart={() => null} />);
  expect(html).not.toContain('已载入保存');
  expect(html).not.toContain('按每天 dt 的完整快照统计');
  expect(html).not.toContain('包含先验赋分与历史继承用户');
  expect(html).toContain('连接失败');
  expect(html).toContain('尚无可用统计');
});

it('shows an empty increments section without rendering fabricated chart values', () => {
  let growthRenderCount = 0;
  const html = renderToStaticMarkup(<ReportCohortSections analytics={null} loading={false} error=""
    renderDistribution={() => null}
    renderGrowthChart={() => { growthRenderCount += 1; return null; }}
    renderBar={() => { growthRenderCount += 1; return null; }} />);
  expect(html).toContain('id="report-increments"');
  expect(html).toContain('尚无可用快照');
  expect(html).not.toContain('本期累计净增');
  expect(growthRenderCount).toBe(0);
});
