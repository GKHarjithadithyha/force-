import { describe, expect, it } from 'vitest';
import { DISPLAY_SCALE, scaleFor, scaleValue } from '@/lib/display-scale';

describe('display calibration', () => {
  it('is x1.8 when ON and exactly 1 when OFF', () => {
    expect(DISPLAY_SCALE).toBe(1.8);
    expect(scaleFor(true)).toBe(1.8);
    expect(scaleFor(false)).toBe(1);
  });
  it('shown power = shown voltage x current, shown energy scales the same, missing stays missing', () => {
    const k = scaleFor(true); const v = 11.592; const iA = 0.041;
    expect(scaleValue(v * iA, k)).toBeCloseTo(v * k * iA, 12);
    expect(scaleValue(2, k)).toBeCloseTo(3.6, 12);
    expect(scaleValue(null, k)).toBeNull();
    expect(scaleValue(undefined, k)).toBeUndefined();
    expect(scaleValue(5, scaleFor(false))).toBe(5);
  });
});
