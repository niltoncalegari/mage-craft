import { describe, expect, it } from 'vitest';
import { planColumnFall } from './columnFall';

/**
 * Chuva de Meteoros is a *shower*: radius 5, and 18 damage every half second
 * for a second and a half. The first cut of the `column` shape drew one narrow
 * shaft down the middle of that, which contradicted both halves of the card —
 * the name and the hazard it actually leaves.
 *
 * This is the seam that carries the claim. Where the impacts land and when is
 * arithmetic; only the drawing needs an eye.
 */

/** Deterministic stand-in for `Math.random`, so a scatter can be asserted at all. */
function seededRand(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('planColumnFall', () => {
  it('spreads its impacts across the disc instead of stacking them on the centre', () => {
    const impacts = planColumnFall(7, 5, 1, seededRand());
    const offCentre = impacts.filter((i) => Math.hypot(i.dx, i.dy) > 1);

    // The bug this replaces put every impact at the exact centre, so the
    // assertion that matters is simply that most of them are not there.
    expect(offCentre.length).toBeGreaterThanOrEqual(4);
  });

  it('lands them one after another, starting immediately', () => {
    const impacts = planColumnFall(7, 5, 1.2, seededRand());
    const times = impacts.map((i) => i.at);

    // Immediately, because the cast has to read on the frame it happens; then
    // spread, because seven meteors arriving on one tick is one explosion.
    expect(times[0]).toBe(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(Math.max(...times)).toBeLessThan(1.2);
  });
});
