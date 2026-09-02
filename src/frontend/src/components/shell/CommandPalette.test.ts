import { describe, expect, it } from 'vitest';
import { nextPaletteIndex } from './CommandPalette';

describe('nextPaletteIndex', () => {
  it('wraps through command results with arrow keys', () => {
    expect(nextPaletteIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextPaletteIndex(0, 'ArrowUp', 3)).toBe(2);
  });

  it('supports Home and End and handles an empty result set', () => {
    expect(nextPaletteIndex(1, 'Home', 4)).toBe(0);
    expect(nextPaletteIndex(1, 'End', 4)).toBe(3);
    expect(nextPaletteIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
});
