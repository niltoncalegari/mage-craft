import { describe, expect, it } from 'vitest';
import { EFFECT_ORDER } from '../../sim/effects';
import { liveParticles } from './columnFall';
import { EFFECT_VFX, TELL_ELSEWHERE } from './effectVfx';

/**
 * The quietest table in the renderer, and the one with the least holding it up.
 *
 * A status effect reaches the client generically — `buildSnapshot` maps the
 * list, so a kind added to `balance.json` arrives on the wire the same day
 * without anyone touching the protocol. That is the good half. The bad half is
 * that **nothing then requires the client to draw it**: the emission loop walks
 * this table, a kind with no row is simply skipped, and the result is an effect
 * that is running, mattering, and completely invisible.
 *
 * It has already happened once. The Tier 2 pass added six kinds and this table
 * kept the three it started with, so `root`, `regen`, `fortify` and `empower`
 * shipped shedding nothing at all — no test went red, because there was no
 * test. This is that test.
 *
 * The list it is held against is `EFFECT_ORDER` from the simulation rather than
 * a literal written here, so the day a card brings a kind, this file is what
 * asks whether anyone decided how it looks.
 */

describe('every effect the sim can run says something on screen', () => {
  it('gives each kind a stream of its own, or names where its tell lives instead', () => {
    const emitted = new Set(EFFECT_VFX.map((e) => e.kind));
    const unaccounted = EFFECT_ORDER.filter(
      (kind) => !emitted.has(kind) && !(kind in TELL_ELSEWHERE),
    );
    expect(unaccounted).toEqual([]);
  });

  it('has no rows for effects the simulation does not have', () => {
    const orphans = EFFECT_VFX.map((e) => e.kind).filter(
      (kind) => !(EFFECT_ORDER as readonly string[]).includes(kind),
    );
    expect(orphans).toEqual([]);
  });

  /**
   * Both halves at once would be two cues for one fact, paid for out of a pool
   * that fails silently — and it would also make the table a lie about what it
   * controls, which is how `hazard` went wrong on the card side.
   */
  it('never gives a kind both a stream here and a tell elsewhere', () => {
    for (const e of EFFECT_VFX) {
      expect(e.kind in TELL_ELSEWHERE, `${e.kind} is drawn twice`).toBe(false);
    }
  });

  it('never leaves a row with nothing to draw', () => {
    for (const e of EFFECT_VFX) {
      expect(e.colors.length, e.kind).toBeGreaterThan(0);
      expect(e.interval, e.kind).toBeGreaterThan(0);
      expect(e.life, e.kind).toBeGreaterThan(0);
      expect(e.size, e.kind).toBeGreaterThan(0);
    }
  });

  it('says nothing twice', () => {
    const kinds = EFFECT_VFX.map((e) => e.kind);
    expect(kinds.length).toBe(new Set(kinds).size);
  });
});

/**
 * A budget question rather than a correctness one — the same species as the
 * gain ceiling in `spellVfx.test.ts`, and it belongs in a test for the same
 * reason: any single row is always defensible, and it is the seventh one that
 * empties the pool.
 *
 * The pool is a shared 900 and `spawnParticle` **returns without drawing** when
 * it is full, so an over-eager status emission does not look like an over-eager
 * status emission. It looks like impact bursts that stopped happening.
 */
describe('a field full of status effects leaves room for the fight', () => {
  /** Particles alive at once from one mage carrying every emitting effect. */
  function perMage(): number {
    // Three stacks is the deepest anything goes (`burn`, in balance.json), and
    // a `perStack` row emits proportionally faster at depth.
    const MAX_STACKS = 3;
    return EFFECT_VFX.reduce((live, e) => {
      const interval = e.perStack ? e.interval / MAX_STACKS : e.interval;
      return live + liveParticles(1, interval, e.life);
    }, 0);
  }

  it('keeps a full arena of carriers under half the shared pool', () => {
    // Eight bodies is a full arena of living mages, and the worst case is all
    // of them carrying everything at once. Half of 900 is the line because the
    // other half is the fight itself: impacts, trails, puffs and cast beats,
    // which are the particles a player is actually reading.
    expect(perMage() * 8).toBeLessThan(450);
  });
});
