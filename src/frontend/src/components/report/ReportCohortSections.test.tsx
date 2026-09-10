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
  expect(html).toContain('首次新增标签用户');
  expect(html).toContain('待接入');
  expect(html).not.toContain('每日价敏用户净增');
});

it('keeps unavailable statistics distinct from genuine zero', () => {
  const html = renderToStaticMarkup(<ReportCohortSections analytics={null} loading={false} error="资源限制" renderDistribution={() => null} />);
  expect(html).toContain('资源限制');
  expect(html).toContain('尚无可用统计');
  expect(html).not.toContain('0%');
});
