import { describe, expect, it } from 'vitest';
import { buildChartDomain, buildDateTickIndexes, buildPriceSensitiveAnalyticsPresentation, buildReportPresentation, buildRobustTrend, buildSmoothChartPath, filterAndSortReportRows, formatChartDateTick, reportColumnsForGroup } from './reportPresentation';

describe('buildReportPresentation', () => {
  it('builds metric cards and numeric chart series from a persisted snapshot', () => {
    const result = buildReportPresentation(
      [{ dt: '2026-08-23', users: '100' }, { dt: '2026-08-24', users: '120' }],
      {
        metrics: [{ field: 'users', label: '用户数', suffix: '人' }],
        chart: { xField: 'dt', series: [{ field: 'users', label: '用户数' }] },
      },
    );

    expect(result.metrics).toEqual([{ label: '用户数', value: '120', suffix: '人' }]);
    expect(result.labels).toEqual(['2026-08-23', '2026-08-24']);
    expect(result.series[0]?.values).toEqual([100, 120]);
    expect(result.columns).toEqual(['dt', 'users']);
  });

  it('derives real summary metrics and a value distribution from the first numeric series', () => {
    const result = buildReportPresentation(
      [{ score: 58.3 }, { score: 60 }, { score: 60 }],
      { chart: { xField: 'duid', series: [{ field: 'score', label: '价格得分' }] } },
    );

    expect(result.supplementalMetrics).toEqual([
      { label: '样本数量', value: '3', suffix: '行' },
      { label: '本页均值', value: '59.43', suffix: '' },
      { label: '本页最低', value: '58.3', suffix: '' },
      { label: '本页最高', value: '60', suffix: '' },
    ]);
    expect(result.distribution).toEqual([
      { label: '60', value: 2 },
      { label: '58.3', value: 1 },
    ]);
  });

  it('filters across fields and sorts the interactive detail table by the selected column', () => {
    const rows = [
      { duid: 1, score: 60 },
      { duid: 2, score: 58.3 },
      { duid: 3, score: 60 },
    ];

    expect(filterAndSortReportRows(rows, '60', { column: 'duid', direction: 'desc' }))
      .toEqual([{ duid: 3, score: 60 }, { duid: 1, score: 60 }]);
  });
});

it('groups full price-sensitive fields while keeping user identity columns visible', () => {
  const columns = ['duid', 'dt', 'd1_price_score', 'd2_coupon_score', 'd3_time_score', 'd4_total_coefficient', 'price_sensitivity_score', 'price_sensitivity_level'];
  expect(reportColumnsForGroup(columns, 'd2')).toEqual(['duid', 'dt', 'd2_coupon_score']);
  expect(reportColumnsForGroup(columns, 'result')).toEqual(['duid', 'dt', 'price_sensitivity_score', 'price_sensitivity_level']);
  expect(reportColumnsForGroup(columns, 'all')).toEqual(columns);
});

it('builds a concise price-sensitive overview and daily chart models', () => {
  const result = buildPriceSensitiveAnalyticsPresentation({
    range: '7d', start_date: '2026-08-18', end_date: '2026-08-24', cached: false, duration_ms: 320,
    summary: { average_price_sensitivity_score: 64.25, total_user_count: 1000, total_order_count: 3000, calculated_user_count: 500, calculated_user_share: 50, high_sensitivity_share: 40, medium_sensitivity_share: 50, low_sensitivity_share: 10 },
    trend: [
      { dt: '2026-08-18', average_price_sensitivity_score: 60, average_d1_price_score: 62, average_d2_coupon_score: 51, average_d3_time_score: 58, total_order_count: 600, calculated_user_count: 240 },
      { dt: '2026-08-19', average_price_sensitivity_score: 65, average_d1_price_score: 67, average_d2_coupon_score: 54, average_d3_time_score: 61, total_order_count: 634, calculated_user_count: 260 },
    ],
    distribution: [{ level: 'HIGH', user_count: 200 }, { level: 'MEDIUM', user_count: 300 }],
  });

  expect(result.metrics).toEqual([
    { label: '当前价敏用户', value: '500', suffix: '人' },
    { label: '本期累计净增', value: '+20', suffix: '人' },
    { label: '最近一日净增', value: '+20', suffix: '人' },
    { label: '最近一日增长率', value: '8.33', suffix: '%' },
    { label: '日均净增', value: '+20', suffix: '人' },
    { label: '当前价敏覆盖率', value: '50', suffix: '%' },
  ]);
  expect(result.labels).toEqual(['2026-08-18', '2026-08-19']);
  expect(result.scoreSeries[0]?.values).toEqual([60, 65]);
  expect(result.orderValues).toEqual([600, 634]);
  expect(result.volumeSeries).toEqual([
    { key: 'users', label: '价敏用户数', color: '#2F6FDB', values: [240, 260] },
    { key: 'orders', label: '参与计算订单数', color: '#D18A24', values: [600, 634] },
  ]);
  expect(result.distribution).toEqual([{ label: '高价敏', value: 200 }, { label: '中价敏', value: 300 }]);
  expect(result.businessMetrics).toEqual([
    { key: 'priceSensitiveUsers', label: '价敏用户数', value: '500', suffix: '人', available: true },
    { key: 'orders', label: '参与计算订单数', value: '3,000', suffix: '单', available: true },
  ]);
});

it('makes day-over-day user increments the primary report story', () => {
  const result = buildPriceSensitiveAnalyticsPresentation({
    range: '31d', start_date: '2026-07-28', end_date: '2026-08-27', cached: false, duration_ms: 320,
    summary: {
      average_price_sensitivity_score: 55.07,
      total_user_count: 41_958_976,
      total_order_count: 70_273_417,
      calculated_user_count: 7_978_735,
      calculated_user_share: 19.02,
      high_sensitivity_share: 20.24,
      medium_sensitivity_share: 61.52,
      low_sensitivity_share: 18.24,
      baseline_calculated_user_count: 7_652_886,
      latest_daily_net_user_growth: 31_034,
      cumulative_net_user_growth: 325_849,
      latest_user_growth_rate: 0.39,
      average_daily_net_user_growth: 10_862,
    },
    trend: [
      { dt: '2026-07-28', average_price_sensitivity_score: 55.4, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, total_order_count: 67_954_207, calculated_user_count: 7_652_886, daily_net_user_growth: 0, daily_user_growth_rate: 0, cumulative_net_user_growth: 0 },
      { dt: '2026-07-29', average_price_sensitivity_score: 55.36, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, total_order_count: 68_005_801, calculated_user_count: 7_673_390, daily_net_user_growth: 20_504, daily_user_growth_rate: 0.27, cumulative_net_user_growth: 20_504 },
      { dt: '2026-08-27', average_price_sensitivity_score: 55.07, average_d1_price_score: 0, average_d2_coupon_score: 0, average_d3_time_score: 0, total_order_count: 70_273_417, calculated_user_count: 7_978_735, daily_net_user_growth: 31_034, daily_user_growth_rate: 0.39, cumulative_net_user_growth: 325_849 },
    ],
    distribution: [],
  });

  expect(result.metrics.slice(0, 5)).toEqual([
    { label: '当前价敏用户', value: '7,978,735', suffix: '人' },
    { label: '本期累计净增', value: '+325,849', suffix: '人' },
    { label: '最近一日净增', value: '+31,034', suffix: '人' },
    { label: '最近一日增长率', value: '0.39', suffix: '%' },
    { label: '日均净增', value: '+10,862', suffix: '人' },
  ]);
  expect(result.incrementSeries).toEqual([
    { key: 'dailyNet', label: '每日价敏净增', color: '#2F6FDB', values: [0, 20_504, 31_034] },
  ]);
  expect(result.cumulativeSeries).toEqual([
    { key: 'cumulativeNet', label: '累计净增', color: '#15857A', values: [0, 20_504, 325_849] },
  ]);
  expect(result.growthRateSeries[0]?.values).toEqual([0, 0.27, 0.39]);
});

it('does not invent a line when only one real daily sample exists', () => {
  expect(buildSmoothChartPath([{ x: 44, y: 128 }], 1100, 44)).toBe('');
});

it('fits the majority of a time series without pulling the trend through an isolated offset', () => {
  const result = buildRobustTrend([10, 11, 12, 80, 13, 14, 15]);

  expect(result.outlierIndexes).toEqual([3]);
  expect(result.fittedValues[3]).toBeGreaterThan(11);
  expect(result.fittedValues[3]).toBeLessThan(16);
  expect(Math.max(...result.fittedValues) - Math.min(...result.fittedValues)).toBeLessThan(8);
});

it('keeps a consistent series fully represented by the fitted trend', () => {
  const result = buildRobustTrend([10, 11, 12, 13, 14, 15, 16]);

  expect(result.outlierIndexes).toEqual([]);
  expect(result.fittedValues).toHaveLength(7);
  expect(result.fittedValues[3]).toBeCloseTo(13, 4);
});

it('does not let an offset at the edge pull the fitted tail away from the majority', () => {
  const result = buildRobustTrend([10, 12, 11, 13, 12, 14, -40]);

  expect(result.outlierIndexes).toContain(6);
  expect(result.fittedValues[6]).toBeGreaterThan(10);
  expect(result.fittedValues[6]).toBeLessThan(18);
});

it('supports domain-invalid observations that must remain raw but stay out of the trend', () => {
  const result = buildRobustTrend([10, 11, 12, 11, 10], { forcedOutlierIndexes: [3, 4] });

  expect(result.outlierIndexes).toEqual([3, 4]);
  expect(result.fittedValues[4]).toBeGreaterThanOrEqual(11);
});

it('builds a padded real-value domain so meaningful changes remain visible', () => {
  expect(buildChartDomain([58, 67], [0, 100])).toEqual({ min: 55, max: 70 });
  expect(buildChartDomain([7_900_000, 8_100_000])).toEqual({ min: 7_800_000, max: 8_200_000 });
  expect(buildChartDomain([55.07], [0, 100])).toEqual({ min: 50, max: 60 });
});

it('adapts date ticks to the real chart width while preserving both endpoints', () => {
  expect(buildDateTickIndexes(31, 320)).toEqual([0, 15, 30]);
  expect(buildDateTickIndexes(31, 640)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  expect(formatChartDateTick('2026-08-02')).toBe('08-02');
  expect(formatChartDateTick('2026-09-01')).toBe('09-01');
});

it('sorts analytics dates before building every x-axis series', () => {
  const result = buildPriceSensitiveAnalyticsPresentation({
    range: '7d', start_date: '2026-08-18', end_date: '2026-08-20', cached: false, duration_ms: 20,
    summary: { average_price_sensitivity_score: 61, total_user_count: 100, total_order_count: 30, calculated_user_count: 12, calculated_user_share: 12, high_sensitivity_share: 20, medium_sensitivity_share: 60, low_sensitivity_share: 20 },
    trend: [
      { dt: '2026-08-20', average_price_sensitivity_score: 63, average_d1_price_score: 62, average_d2_coupon_score: 61, average_d3_time_score: 60, total_order_count: 30, calculated_user_count: 12 },
      { dt: '2026-08-18', average_price_sensitivity_score: 60, average_d1_price_score: 59, average_d2_coupon_score: 58, average_d3_time_score: 57, total_order_count: 10, calculated_user_count: 10 },
      { dt: '2026-08-19', average_price_sensitivity_score: 61, average_d1_price_score: 60, average_d2_coupon_score: 59, average_d3_time_score: 58, total_order_count: 20, calculated_user_count: 11 },
    ],
    distribution: [],
  });

  expect(result.labels).toEqual(['2026-08-18', '2026-08-19', '2026-08-20']);
  expect(result.scoreSeries[0]?.values).toEqual([60, 61, 63]);
  expect(result.orderValues).toEqual([10, 20, 30]);
});
