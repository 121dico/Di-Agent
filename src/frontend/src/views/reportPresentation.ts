import type { ReportAnalyticsResult, ReportRow, ReportVisualization } from '@/types/report';

export interface ReportPresentation {
  metrics: Array<{ label: string; value: string; suffix: string }>;
  supplementalMetrics: Array<{ label: string; value: string; suffix: string }>;
  labels: string[];
  series: Array<{ label: string; color?: string; values: number[] }>;
  columns: string[];
  distribution: Array<{ label: string; value: number }>;
}

export interface PriceSensitiveAnalyticsPresentation {
  metrics: Array<{ label: string; value: string; suffix: string }>;
  businessMetrics: Array<{ key: string; label: string; value: string; suffix: string; available: boolean }>;
  labels: string[];
  incrementSeries: Array<{ key: string; label: string; color: string; values: number[] }>;
  cumulativeSeries: Array<{ key: string; label: string; color: string; values: number[] }>;
  growthRateSeries: Array<{ key: string; label: string; color: string; values: number[] }>;
  scoreSeries: Array<{ key: string; label: string; color: string; values: number[] }>;
  volumeSeries: Array<{ key: string; label: string; color: string; values: number[] }>;
  orderValues: number[];
  distribution: Array<{ label: string; value: number }>;
}

export interface ChartDomain {
  min: number;
  max: number;
}

export function buildDateTickIndexes(count: number, plotWidth: number): number[] {
  if (count <= 0) return [];
  const maxTicks = plotWidth < 420 ? 3 : plotWidth < 560 ? 5 : 7;
  if (count <= maxTicks) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: maxTicks }, (_, index) => Math.round(index * (count - 1) / (maxTicks - 1)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function formatChartDateTick(label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(label);
  return match ? `${match[2]}-${match[3]}` : label;
}

function niceChartStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function buildChartDomain(values: number[], bounds?: [number, number]): ChartDomain {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: bounds?.[0] ?? 0, max: bounds?.[1] ?? 1 };
  const observedMin = Math.min(...finite);
  const observedMax = Math.max(...finite);
  const observedSpan = observedMax - observedMin;
  const padding = observedSpan > 0
    ? observedSpan * 0.16
    : Math.max(Math.abs(observedMax) * 0.08, bounds?.[1] === 100 ? 2 : 1);
  const step = niceChartStep((observedSpan + padding * 2) / 4);
  let min = Math.floor((observedMin - padding) / step) * step;
  let max = Math.ceil((observedMax + padding) / step) * step;
  if (bounds) {
    min = Math.max(bounds[0], min);
    max = Math.min(bounds[1], max);
  }
  if (max <= min) {
    min = bounds ? Math.max(bounds[0], observedMin - 1) : observedMin - 1;
    max = bounds ? Math.min(bounds[1], observedMax + 1) : observedMax + 1;
  }
  return { min, max };
}

export function buildSmoothChartPath(points: Array<{ x: number; y: number }>, _width: number, _pad: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return '';
  return points.slice(1).reduce((path, current, index) => {
    const previous = points[index];
    if (!previous) return path;
    const midX = (previous.x + current.x) / 2;
    return `${path} C ${midX} ${previous.y}, ${midX} ${current.y}, ${current.x} ${current.y}`;
  }, `M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`);
}

export interface RobustTrend {
  fittedValues: number[];
  outlierIndexes: number[];
}

export interface RobustTrendOptions {
  forcedOutlierIndexes?: number[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/**
 * Builds a robust local-linear trend while keeping raw observations separate.
 * Isolated offsets are detected with a Hampel-style median/MAD check, replaced
 * only for fitting, then smoothed with a short local regression window.
 */
export function buildRobustTrend(values: number[], options: RobustTrendOptions = {}): RobustTrend {
  if (values.length === 0) return { fittedValues: [], outlierIndexes: [] };

  const finiteValues = values.map((value) => Number.isFinite(value) ? value : 0);
  const adjacentChanges = finiteValues
    .slice(1)
    .map((value, index) => Math.abs(value - (finiteValues[index] ?? value)))
    .filter(Number.isFinite);
  const typicalChange = median(adjacentChanges);
  const outlierIndexSet = new Set<number>(
    (options.forcedOutlierIndexes ?? []).filter((index) => index >= 0 && index < finiteValues.length),
  );

  if (finiteValues.length >= 5) {
    const pairwiseSlopes: number[] = [];
    for (let left = 0; left < finiteValues.length - 1; left += 1) {
      for (let right = left + 1; right < finiteValues.length; right += 1) {
        pairwiseSlopes.push(((finiteValues[right] ?? 0) - (finiteValues[left] ?? 0)) / (right - left));
      }
    }
    const robustSlope = median(pairwiseSlopes);
    const robustIntercept = median(finiteValues.map((value, index) => value - robustSlope * index));
    const residuals = finiteValues.map((value, index) => value - (robustIntercept + robustSlope * index));
    const residualMedian = median(residuals);
    const residualMad = median(residuals.map((value) => Math.abs(value - residualMedian)));
    const globalThreshold = Math.max(
      residualMad * 1.4826 * 2.75,
      typicalChange * 3,
      Math.abs(median(finiteValues)) * 0.03,
      1e-6,
    );
    residuals.forEach((residual, index) => {
      if (Math.abs(residual - residualMedian) > globalThreshold) outlierIndexSet.add(index);
    });
  }

  if (finiteValues.length >= 5) {
    const detectionRadius = 2;
    for (let index = detectionRadius; index < finiteValues.length - detectionRadius; index += 1) {
      const window = finiteValues.slice(index - detectionRadius, index + detectionRadius + 1);
      const localMedian = median(window);
      const localMad = median(window.map((value) => Math.abs(value - localMedian)));
      const noiseFloor = Math.max(Math.abs(localMedian) * 0.03, typicalChange * 3, 1e-6);
      const threshold = Math.max(localMad * 1.4826 * 3, noiseFloor);
      if (Math.abs((finiteValues[index] ?? localMedian) - localMedian) > threshold) {
        outlierIndexSet.add(index);
      }
    }
  }

  const outlierIndexes = [...outlierIndexSet].sort((left, right) => left - right);
  const outlierSet = new Set(outlierIndexes);
  const cleaned = finiteValues.map((value, index) => {
    if (!outlierSet.has(index)) return value;
    let left = index - 1;
    let right = index + 1;
    while (left >= 0 && outlierSet.has(left)) left -= 1;
    while (right < finiteValues.length && outlierSet.has(right)) right += 1;
    if (left >= 0 && right < finiteValues.length) {
      const progress = (index - left) / (right - left);
      return (finiteValues[left] ?? value) + ((finiteValues[right] ?? value) - (finiteValues[left] ?? value)) * progress;
    }
    return left >= 0 ? (finiteValues[left] ?? value) : (finiteValues[right] ?? value);
  });

  if (cleaned.length <= 2) return { fittedValues: cleaned, outlierIndexes };
  const regressionRadius = Math.min(5, Math.max(2, Math.round(cleaned.length / 8)));
  const fittedValues = cleaned.map((fallback, center) => {
    const start = Math.max(0, center - regressionRadius);
    const end = Math.min(cleaned.length - 1, center + regressionRadius);
    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let index = start; index <= end; index += 1) {
      const distance = Math.abs(index - center) / (regressionRadius + 1);
      const weight = (1 - distance ** 3) ** 3;
      const value = cleaned[index] ?? fallback;
      sumWeight += weight;
      sumX += weight * index;
      sumY += weight * value;
      sumXX += weight * index * index;
      sumXY += weight * index * value;
    }
    const denominator = sumWeight * sumXX - sumX * sumX;
    if (Math.abs(denominator) < 1e-9) return sumY / Math.max(sumWeight, 1);
    const slope = (sumWeight * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / sumWeight;
    return intercept + slope * center;
  });

  return { fittedValues, outlierIndexes };
}

const sensitivityLevelLabels: Record<string, string> = { VERY_HIGH: '极高价敏', HIGH: '高价敏', MEDIUM_HIGH: '中高价敏', MEDIUM: '中价敏', MEDIUM_LOW: '中低价敏', LOW: '低价敏', VERY_LOW: '极低价敏', UNKNOWN: '未知', UNASSIGNED: '未赋分' };
const sensitivityLevelOrder: Record<string, number> = { VERY_HIGH: 0, HIGH: 1, MEDIUM_HIGH: 2, MEDIUM: 3, MEDIUM_LOW: 4, LOW: 5, VERY_LOW: 6, UNKNOWN: 7 };

export function presentSensitivityDistribution(distribution: ReportAnalyticsResult['distribution']) {
  return [...distribution]
    .sort((left, right) => (sensitivityLevelOrder[left.level] ?? 99) - (sensitivityLevelOrder[right.level] ?? 99))
    .map((item) => ({ label: sensitivityLevelLabels[item.level] ?? item.level, value: item.user_count }));
}

export function buildPriceSensitiveAnalyticsPresentation(analytics: ReportAnalyticsResult): PriceSensitiveAnalyticsPresentation {
  const trend = [...analytics.trend].sort((left, right) => left.dt.localeCompare(right.dt));
  const score = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(2))) : '—';
  const count = (value: number) => Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—';
  const signedCount = (value: number) => `${value > 0 ? '+' : ''}${count(value)}`;
  const calculatedUsers = trend.map((point) => point.calculated_user_count);
  // 兼容旧缓存的首日占位零；只有明确标记可用的跨区间比较才保留首日增量。
  const dailyNetValues = trend.map((point, index) => point.daily_growth_available === false || (index === 0 && point.daily_growth_available !== true) ? Number.NaN : point.daily_net_user_growth
    ?? (index === 0 ? Number.NaN : point.calculated_user_count - trend[index - 1]!.calculated_user_count));
  const baselineUsers = analytics.summary.baseline_calculated_user_count ?? calculatedUsers[0] ?? analytics.summary.calculated_user_count;
  const cumulativeNetValues = trend.map((point) => point.cumulative_net_user_growth
    ?? point.calculated_user_count - baselineUsers);
  const growthRateValues = trend.map((point, index) => point.daily_growth_available === false || (index === 0 && point.daily_growth_available !== true) ? Number.NaN : point.daily_user_growth_rate
    ?? (index === 0 || !calculatedUsers[index - 1] ? Number.NaN : dailyNetValues[index]! / calculatedUsers[index - 1]! * 100));
  const latestDailyNet = Number.isFinite(dailyNetValues[dailyNetValues.length - 1]) ? analytics.summary.latest_daily_net_user_growth ?? dailyNetValues[dailyNetValues.length - 1]! : NaN;
  const cumulativeNet = analytics.summary.cumulative_net_user_growth ?? cumulativeNetValues[cumulativeNetValues.length - 1] ?? 0;
  const latestGrowthRate = Number.isFinite(growthRateValues[growthRateValues.length - 1]) ? analytics.summary.latest_user_growth_rate ?? growthRateValues[growthRateValues.length - 1]! : NaN;
  const dailyChanges = dailyNetValues.slice(1).filter(Number.isFinite);
  const averageDailyNet = dailyChanges.length ? analytics.summary.average_daily_net_user_growth
    ?? dailyChanges.reduce((sum, value) => sum + value, 0) / dailyChanges.length : NaN;
  const scoreValue = (point: ReportAnalyticsResult['trend'][number], key: string, legacy: number) =>
    point.nullable_scores ? (point.nullable_scores[key] ?? Number.NaN) : legacy;
  const v12 = analytics.profile === 'price_sensitive_v1_2';
  return {
    metrics: v12 ? [
      { label: '总用户数', value: count(analytics.summary.total_user_count), suffix: '人' },
      { label: '已有价敏分用户（含先验）', value: count(analytics.summary.calculated_user_count), suffix: '人' },
      { label: '价敏赋分覆盖率', value: score(analytics.summary.calculated_user_share), suffix: '%' },
      { label: '价敏均分', value: analytics.summary.calculated_user_count ? score(analytics.summary.average_price_sensitivity_score) : '—', suffix: '分' },
      { label: '标签记录的180天订单数', value: count(analytics.summary.total_order_count), suffix: '单' },
      { label: '先验赋分用户', value: count(analytics.assigned_by_type?.PRIOR ?? 0), suffix: '人' },
    ] : [
      { label: '当前价敏用户', value: count(analytics.summary.calculated_user_count), suffix: '人' },
      { label: '本期累计净增', value: signedCount(cumulativeNet), suffix: '人' },
      { label: '最近一日净增', value: signedCount(latestDailyNet), suffix: Number.isFinite(latestDailyNet) ? '人' : '' },
      { label: '最近一日增长率', value: score(latestGrowthRate), suffix: Number.isFinite(latestGrowthRate) ? '%' : '' },
      { label: '日均净增', value: signedCount(averageDailyNet), suffix: Number.isFinite(averageDailyNet) ? '人' : '' },
      { label: '当前价敏覆盖率', value: score(analytics.summary.calculated_user_share), suffix: '%' },
    ],
    businessMetrics: [
      { key: 'priceSensitiveUsers', label: '价敏用户数', value: count(analytics.summary.calculated_user_count), suffix: '人', available: true },
      { key: 'orders', label: '参与计算订单数', value: count(analytics.summary.total_order_count), suffix: '单', available: true },
    ],
    labels: trend.map((point) => point.dt),
    incrementSeries: [
      { key: 'dailyNet', label: '每日价敏净增', color: '#2F6FDB', values: dailyNetValues },
    ],
    cumulativeSeries: [
      { key: 'cumulativeNet', label: '累计净增', color: '#15857A', values: cumulativeNetValues },
    ],
    growthRateSeries: [
      { key: 'growthRate', label: '每日增长率', color: '#765BC4', values: growthRateValues },
    ],
    scoreSeries: [
      { key: 'price', label: '价敏均分', color: '#2F6FDB', values: trend.map((point) => scoreValue(point, 'price', point.average_price_sensitivity_score)) },
      { key: 'd1', label: v12 ? '价格分' : 'D1 价格分', color: '#15857A', values: trend.map((point) => scoreValue(point, 'd1', point.average_d1_price_score)) },
      { key: 'd2', label: v12 ? '用券分' : 'D2 优惠分', color: '#765BC4', values: trend.map((point) => scoreValue(point, 'd2', point.average_d2_coupon_score)) },
      { key: 'd3', label: v12 ? '时间换价格分' : 'D3 时间分', color: '#D05C50', values: trend.map((point) => scoreValue(point, 'd3', point.average_d3_time_score)) },
    ],
    volumeSeries: [
      { key: 'users', label: '价敏用户数', color: '#2F6FDB', values: trend.map((point) => point.calculated_user_count) },
      { key: 'orders', label: '参与计算订单数', color: '#D18A24', values: trend.map((point) => point.total_order_count) },
    ],
    orderValues: trend.map((point) => point.total_order_count),
    distribution: presentSensitivityDistribution(analytics.distribution),
  };
}

const textValue = (value: unknown): string => value == null ? '—' : String(value);
const numberValue = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value: number): string => String(Number(value.toFixed(2)));

export interface ReportSort { column: string; direction: 'asc' | 'desc' }
export type ReportFieldGroup = 'all' | 'd1' | 'd2' | 'd3' | 'd4' | 'result';

const identityColumns = new Set(['duid', 'dt']);

export function reportColumnsForGroup(columns: string[], group: ReportFieldGroup): string[] {
  if (group === 'all') return columns;
  return columns.filter((column) => identityColumns.has(column) || (
    group === 'result'
      ? !/^d[1-4]_/.test(column)
      : column.startsWith(`${group}_`)
  ));
}

export function filterAndSortReportRows(rows: ReportRow[], query: string, sort: ReportSort | null): ReportRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? rows.filter((row) => Object.values(row).some((value) => textValue(value).toLocaleLowerCase().includes(normalizedQuery)))
    : [...rows];
  if (!sort) return filtered;
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return filtered.sort((left, right) => {
    const leftValue = left[sort.column];
    const rightValue = right[sort.column];
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return (leftNumber - rightNumber) * multiplier;
    return textValue(leftValue).localeCompare(textValue(rightValue), 'zh-CN') * multiplier;
  });
}

export function buildReportPresentation(rows: ReportRow[], visualization: ReportVisualization): ReportPresentation {
  const latest = rows[rows.length - 1] ?? {};
  const primaryField = visualization.chart?.series[0]?.field;
  const primaryValues = primaryField
    ? rows.map((row) => Number(row[primaryField])).filter((value) => Number.isFinite(value))
    : [];
  const supplementalMetrics = [{ label: '样本数量', value: String(rows.length), suffix: '行' }];
  if (primaryValues.length > 0) {
    supplementalMetrics.push(
      { label: '本页均值', value: formatNumber(primaryValues.reduce((sum, value) => sum + value, 0) / primaryValues.length), suffix: '' },
      { label: '本页最低', value: formatNumber(Math.min(...primaryValues)), suffix: '' },
      { label: '本页最高', value: formatNumber(Math.max(...primaryValues)), suffix: '' },
    );
  }
  const distributionCounts = new Map<string, number>();
  for (const value of primaryValues) {
    const label = formatNumber(value);
    distributionCounts.set(label, (distributionCounts.get(label) ?? 0) + 1);
  }
  return {
    metrics: (visualization.metrics ?? []).map((metric) => ({
      label: metric.label,
      value: textValue(latest[metric.field]),
      suffix: metric.suffix ?? '',
    })),
    supplementalMetrics,
    labels: rows.map((row) => textValue(row[visualization.chart?.xField ?? ''])),
    series: (visualization.chart?.series ?? []).map((series) => ({
      label: series.label,
      color: series.color,
      values: rows.map((row) => numberValue(row[series.field])),
    })),
    columns: Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    distribution: Array.from(distributionCounts, ([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label)),
  };
}
