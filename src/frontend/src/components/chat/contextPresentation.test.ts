import { describe, expect, it } from 'vitest';
import { clampUsageRatio, formatTokenCount, getUsageStatusLabel } from './contextPresentation';

describe('contextPresentation', () => {
  it('clamps invalid context ratios', () => {
    expect(clampUsageRatio(-0.2)).toBe(0);
    expect(clampUsageRatio(0.72)).toBe(0.72);
    expect(clampUsageRatio(1.4)).toBe(1);
    expect(clampUsageRatio(Number.NaN)).toBe(0);
  });

  it('formats token counts for compact display', () => {
    expect(formatTokenCount(900)).toBe('900');
    expect(formatTokenCount(12_800)).toBe('12.8K');
    expect(formatTokenCount(128_000)).toBe('128K');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
  });

  it('uses an actionable status label', () => {
    expect(getUsageStatusLabel('warning')).toBe('接近上限');
    expect(getUsageStatusLabel('critical')).toBe('建议迁移');
  });
});
