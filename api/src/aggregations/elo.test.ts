import { describe, expect, it } from 'vitest';
import { applyEloDelta, computeEloDelta } from './elo.js';

describe('computeEloDelta', () => {
  it('is zero for an even match ending in the expected 50/50 result rounding', () => {
    // Equal ratings -> expected score 0.5; a win nets +K/2, a loss -K/2.
    expect(computeEloDelta(1200, 1200, true)).toBe(16);
    expect(computeEloDelta(1200, 1200, false)).toBe(-16);
  });

  it('rewards beating a higher-rated opponent more than beating a lower-rated one', () => {
    const upset = computeEloDelta(1200, 1400, true);
    const expected = computeEloDelta(1400, 1200, true);
    expect(upset).toBeGreaterThan(expected);
  });

  it('penalizes losing to a lower-rated opponent more than losing to a higher-rated one', () => {
    const badLoss = computeEloDelta(1400, 1200, false);
    const normalLoss = computeEloDelta(1200, 1400, false);
    expect(badLoss).toBeLessThan(normalLoss);
  });

  it('respects a custom K-factor', () => {
    expect(computeEloDelta(1200, 1200, true, 16)).toBe(8);
  });
});

describe('applyEloDelta', () => {
  it('adds the delta to the rating', () => {
    expect(applyEloDelta(1200, 16)).toBe(1216);
  });

  it('floors the result at 100', () => {
    expect(applyEloDelta(120, -50)).toBe(100);
  });
});
