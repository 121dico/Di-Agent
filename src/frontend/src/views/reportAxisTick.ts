/** Preserve differences between adjacent ticks when the population is very large. */
export function formatReportAxisTick(value: number, step: number): string {
  const scale = Math.abs(value) >= 100_000_000 ? 100_000_000 : Math.abs(value) >= 10_000 ? 10_000 : 1;
  const suffix = scale === 100_000_000 ? '亿' : scale === 10_000 ? '万' : '';
  const precision = step > 0 ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step / scale)) + 1)) : 0;
  return `${Number((value / scale).toFixed(precision)).toLocaleString('zh-CN', { maximumFractionDigits: precision })}${suffix}`;
}
