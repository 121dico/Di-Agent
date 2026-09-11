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
