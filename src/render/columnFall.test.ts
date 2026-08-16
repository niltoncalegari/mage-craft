import { describe, expect, it } from 'vitest';
import { ALL_SPELLS } from '../../sim/spells';
import { METEOR_POOL_SIZE, peakConcurrentMeteors, planColumnFall } from './columnFall';
import { spellVfxFor } from './spellVfx';

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

/**
 * Each falling body is a real mesh, so it holds a pool slot for the whole of
 * its fall. This repo's pools fail *silently* when they run dry — `spawnZone`
 * returns without drawing anything — so the sizing is worth arithmetic rather
 * than a guess: a shower that quietly drops half its meteors looks like a
 * weaker card, not like a bug.
 */
describe('the falling bodies fit in their pool', () => {
  it('counts how many are in the air at once', () => {
    // Seven bodies over one second, each airborne for a quarter of it: about
    // two overlap at any moment. Worked by hand rather than by rerunning the
    // formula, so the test can disagree with the code.
    expect(peakConcurrentMeteors(7, 1, 0.25)).toBe(2);
    // Squeeze the same seven into a third of a second and they pile up.
    expect(peakConcurrentMeteors(7, 0.35, 0.25)).toBe(5);
    // A window shorter than one fall means every body is up together.
    expect(peakConcurrentMeteors(4, 0.1, 0.25)).toBe(4);
  });

  it('leaves room for both sides showering at once', () => {
    for (const id of ALL_SPELLS) {
      const vfx = spellVfxFor(id);
      if (vfx.shape !== 'column') continue;
      const peak = peakConcurrentMeteors(vfx.impacts ?? 1, vfx.impactWindow ?? 1);
      // Two, because the global cooldown is shorter than a shower's window:
      // the opponent can start theirs before yours has finished falling.
      expect(peak * 2).toBeLessThanOrEqual(METEOR_POOL_SIZE);
    }
  });
});
