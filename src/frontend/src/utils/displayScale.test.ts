import { describe, expect, it } from 'vitest';
import { calculateDisplayScale } from './displayScale';

describe('calculateDisplayScale', () => {
  it('keeps phone-sized viewports at native scale', () => {
    expect(calculateDisplayScale(390)).toBe(1);
    expect(calculateDisplayScale(768)).toBe(1);
  });

  it('makes compact desktop workspaces denser without shrinking indefinitely', () => {
    expect(calculateDisplayScale(900)).toBe(0.948);
    expect(calculateDisplayScale(1024)).toBe(0.9);
    expect(calculateDisplayScale(1280)).toBe(0.962);
  });

  it('uses 1440px as the native-size baseline', () => {
    expect(calculateDisplayScale(1440)).toBe(1);
  });

  it('grows large displays continuously and caps extreme widths', () => {
    expect(calculateDisplayScale(1920)).toBe(1.094);
    expect(calculateDisplayScale(2560)).toBe(1.22);
    expect(calculateDisplayScale(3840)).toBe(1.22);
  });

  it('falls back safely for invalid dimensions', () => {
    expect(calculateDisplayScale(0)).toBe(1);
    expect(calculateDisplayScale(Number.NaN)).toBe(1);
  });
});
