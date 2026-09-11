function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// 只标记相邻真实日期间跳出又回归的孤立点；持续变更、端点和缺失不做错误推断。
export function detectReportOutliers(values: number[], labels: string[]): number[] {
  return values.flatMap((value, index) => {
    const previous = values[index - 1];
    const next = values[index + 1];
    if (!Number.isFinite(value) || previous == null || next == null || !Number.isFinite(previous) || !Number.isFinite(next)) return [];
    if (Date.parse(labels[index] ?? '') - Date.parse(labels[index - 1] ?? '') !== 86400000
      || Date.parse(labels[index + 1] ?? '') - Date.parse(labels[index] ?? '') !== 86400000) return [];
    if ((value - previous) * (value - next) <= 0) return [];
    const neighbours = values.slice(Math.max(0, index - 3), index + 4)
      .filter((sample, offset) => Number.isFinite(sample) && offset + Math.max(0, index - 3) !== index);
    const center = median(neighbours);
    const mad = median(neighbours.map((sample) => Math.abs(sample - center)));
    const threshold = Math.max(Math.abs((previous + next) / 2) * 0.03, mad * 1.4826 * 3, Math.abs(next - previous) * 3, 1e-6);
    return Math.min(Math.abs(value - previous), Math.abs(value - next)) > threshold ? [index] : [];
  });
}

// 增量展示还需识别区间内极少量的超大幅度（包括末日），无需等下一天回落。
// 这是正常趋势的展示分层，不判断源数据错误；多数数据或持续新水平不能被整批排除。
export function detectIncrementOutliers(values: number[], labels: string[], minimumMagnitude = 1): number[] {
  const isolated = detectReportOutliers(values, labels);
  const magnitudes = values.filter(Number.isFinite).map(Math.abs);
  if (magnitudes.length < 7) return isolated;
  const center = median(magnitudes);
  const mad = median(magnitudes.map((value) => Math.abs(value - center)));
  const upper = Math.max(center * 6, center + mad * 1.4826 * 8, minimumMagnitude);
  const extreme = values.flatMap((value, index) => Number.isFinite(value) && Math.abs(value) > upper ? [index] : []);
  return [...new Set([...isolated, ...(extreme.length <= Math.floor(magnitudes.length * 0.2) ? extreme : [])])].sort((a, b) => a - b);
}
