import { expect, it } from 'vitest';
import { fitReportLocalTrend } from './reportLocalFit';
const labels = Array.from({ length: 9 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
it('smooths daily wiggles without moving a linear trend', () => {
  const straight = labels.map((_, i) => 100 + i * 10);
  fitReportLocalTrend(straight, labels, []).forEach((value, i) => expect(value).toBeCloseTo(straight[i]!));
  const noisy = [100, 120, 100, 120, 100, 120, 100, 120, 100];
  const result = fitReportLocalTrend(noisy, labels, []);
  expect(result[4]).toBeGreaterThan(105);
  expect(result[4]).toBeLessThan(115);
  expect(noisy[4]).toBe(100);
});
it('excludes spikes while leaving missing days and calendar gaps disconnected', () => {
  const input = [100, 100, 100, 1000000, 100, NaN, 500, 500, 500];
  const result = fitReportLocalTrend(input, labels, [3]);
  expect(result[3]).toBeNaN();
  expect(result[5]).toBeNaN();
  expect(result[4]).toBeCloseTo(100);
  expect(result[6]).toBeCloseTo(500);
  expect(fitReportLocalTrend([100, 500], ['2026-09-01', '2026-09-03'], [])).toEqual([100, 500]);
});
