export type ReportScaleMode = 'actual' | 'trend';

// 只转换绘图坐标，原始数值始终用于读数和变化率。
export function normalizeReportTrend(values: number[], excluded: number[] = []): number[] {
  const omitted = new Set(excluded);
  const finite = values.filter((value, index) => Number.isFinite(value) && !omitted.has(index));
  if (!finite.length) return values.map(() => NaN);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const deviation = Math.sqrt(finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length);
  // 不用极值铺满画布，避免不同走势被固定到同样的起终点。
  return values.map((value) => !Number.isFinite(value) ? NaN : deviation === 0 ? Math.sign(value - mean) * 3 : (value - mean) / deviation);
}

export function reportDailyRate(values: number[], labels: string[], index: number): string {
  const current = values[index];
  const previous = values[index - 1];
  if (index === 0) return '首日无对比';
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)
    || Date.parse(labels[index] ?? '') - Date.parse(labels[index - 1] ?? '') !== 86400000) return '前日缺失，日变化率不可计算';
  if (previous === 0) return '前日为 0，日变化率不可计算';
  const rate = (current - previous) / Math.abs(previous) * 100;
  return `日变化率 ${rate > 0 ? '+' : ''}${rate.toFixed(2)}%`;
}
