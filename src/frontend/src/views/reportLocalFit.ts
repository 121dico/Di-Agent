// 七日邻域局部线性拟合：平滑日波动，不强行穿过观测点或固定首尾。
// 仅返回展示值；原始值用于散点、tooltip，离群点和真实缺口保持空值。
export function fitReportLocalTrend(values: number[], labels: string[], excluded: number[]): number[] {
  const omitted = new Set(excluded);
  const segments: number[] = [];
  let segment = 0;
  values.forEach((value, i) => {
    if (!Number.isFinite(value) || (i > 0 && Date.parse(labels[i] ?? '') - Date.parse(labels[i - 1] ?? '') !== 86400000)) segment++;
    segments.push(segment);
  });
  return values.map((value, i) => {
    if (!Number.isFinite(value) || omitted.has(i)) return NaN;
    let w = 0, wx = 0, wy = 0, wxx = 0, wxy = 0;
    const samples: number[] = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(values.length - 1, i + 3); j++) {
      const sample = values[j]!;
      if (segments[j] !== segments[i] || !Number.isFinite(sample) || omitted.has(j)) continue;
      const x = j - i;
      const weight = (1 - (Math.abs(x) / 4) ** 3) ** 3;
      w += weight; wx += weight * x; wy += weight * sample; wxx += weight * x * x; wxy += weight * x * sample;
      samples.push(sample);
    }
    const denominator = w * wxx - wx * wx;
    const fitted = denominator > 1e-12 ? (wy * wxx - wx * wxy) / denominator : value;
    // 端点拟合不外推到邻域实际范围之外，避免生成非真实尖峰。
    return Math.max(Math.min(...samples), Math.min(Math.max(...samples), fitted));
  });
}
