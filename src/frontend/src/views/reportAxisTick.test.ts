import { expect, it } from 'vitest';
import { formatReportAxisTick } from './reportAxisTick';

it('keeps billion-scale population ticks distinguishable', () => {
  const ticks = [356_000_000, 357_000_000, 358_000_000, 359_000_000, 360_000_000];
  expect(new Set(ticks.map((tick) => formatReportAxisTick(tick, 1_000_000))).size).toBe(5);
  expect(formatReportAxisTick(357_000_000, 1_000_000)).toBe('3.57亿');
  expect(formatReportAxisTick(50, 25)).toBe('50');
});
