/**
 * The path a `strike` cast's bolt takes from the sky to the ground.
 *
 * Same split as `columnFall` and `rootGrowth`: the shape is arithmetic and only
 * the look is taste. What matters here is that the bolt actually connects the
 * two points it claims to — a discharge that misses the ground, or that starts
 * somewhere other than above the target, is a card pointing at the wrong place.
 */

import { describe, expect, it } from 'vitest';
import { BOLT_POINTS, planBoltPath, BOLT_STRIKE_HEIGHT } from './boltPath';

function cyclingRand(): () => number {
  const values = [0.2, 0.8, 0.35, 0.9, 0.5, 0.1, 0.75, 0.45];
  let i = 0;
  return () => values[i++ % values.length];
}

describe('bolt path', () => {
  it('fills exactly the buffer the bolt mesh draws', () => {
    const path = planBoltPath(0, 0, 1, cyclingRand());
    expect(path).toHaveLength(BOLT_POINTS * 3);
  });

  /**
   * Both ends are pinned. The reference lets the top wander, which is right for
   * a strike out of an open sky; the *bottom* may not, because that is the spot
   * the card actually caught people at and the eye reads the card's aim from it.
   */
  it('lands exactly on the point the card was cast at', () => {
    const path = planBoltPath(4, -2, 1, cyclingRand());
    const last = (BOLT_POINTS - 1) * 3;

    expect(path[last]).toBeCloseTo(4, 5);
    expect(path[last + 1]).toBeCloseTo(0, 5);
    expect(path[last + 2]).toBeCloseTo(-2, 5);
  });

  it('starts high above that point, not beside it', () => {
    const path = planBoltPath(4, -2, 1, cyclingRand());

    expect(path[1]).toBeCloseTo(BOLT_STRIKE_HEIGHT, 5);
    // Some lateral wander up top is wanted; a bolt from a different postcode is not.
    expect(Math.hypot(path[0] - 4, path[2] - -2)).toBeLessThan(BOLT_STRIKE_HEIGHT / 2);
  });

  it('descends the whole way, so the arc never doubles back up', () => {
    const path = planBoltPath(0, 0, 1, cyclingRand());
    for (let i = 1; i < BOLT_POINTS; i++) {
      expect(path[i * 3 + 1], `point ${i}`).toBeLessThanOrEqual(path[(i - 1) * 3 + 1] + 1e-6);
    }
  });

  /**
   * The jaggedness is a fractal: each generation halves the offset it adds, so
   * the silhouette has both a big sweep and fine crackle. A wider `spread` has
   * to actually widen it, or the parameter is decoration.
   */
  it('wanders further when told to wander further', () => {
    const drift = (spread: number): number => {
      const path = planBoltPath(0, 0, spread, cyclingRand());
      let max = 0;
      for (let i = 0; i < BOLT_POINTS; i++) max = Math.max(max, Math.hypot(path[i * 3], path[i * 3 + 2]));
      return max;
    };

    expect(drift(3)).toBeGreaterThan(drift(1));
  });
});
