export type ReportScaleMode = 'actual' | 'trend';

// 只转换绘图坐标，原始数值始终用于读数和变化率。
export function normalizeReportTrend(values: number[]): number[] {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return values.map((value) => !Number.isFinite(value) ? NaN : max === min ? 50 : (value - min) / (max - min) * 100);
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
