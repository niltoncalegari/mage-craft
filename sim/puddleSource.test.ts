import { describe, expect, it } from 'vitest';
import { Arena } from './Arena';
import { TEAM_A, TEAM_B } from './entities';
import { rangeMap } from './rangeMap';
import { buildSnapshot } from './snapshot';
import { Vec2 } from './Vec2';
import { World } from './World';

/**
 * A puddle has to say what put it there.
 *
 * The client draws every ground hazard the same, because the wire never told it
 * otherwise — which was fine while Praga was the only card that left one. Chuva
 * de Meteoros leaves one too, and a crater of burning rock came out drawn as a
 * pool of poison. The colour is the client's business, but *which card* is a
 * fact only the simulation has, so it travels.
 *
 * The puddle an element leaves (the Alchemist's flask) deliberately names no
 * card: it is not one, and the client's default is already the right green.
 */

function arena(): Arena {
  return Arena.parse(rangeMap());
}

/** Enough mana banked to cast anything, by letting the clock run. */
function ready(w: World): void {
  for (let i = 0; i < 60 * 60; i++) w.step(1 / 60);
}

describe('a puddle carries the card that made it', () => {
  it('names the card on the puddle itself', () => {
    const w = new World(arena());
    ready(w);

    expect(w.castSpell(TEAM_A, 'plague', new Vec2(0, 0)).ok).toBe(true);

    const puddles = [...w.puddles.values()];
    expect(puddles).toHaveLength(1);
    expect(puddles[0].spellId).toBe('plague');
  });

  it('distinguishes two cards that both leave one', () => {
    const w = new World(arena());
    ready(w);

    expect(w.castSpell(TEAM_A, 'plague', new Vec2(-3, 0)).ok).toBe(true);
    // The other side, so the global cooldown does not refuse the second cast.
    expect(w.castSpell(TEAM_B, 'meteor_shower', new Vec2(3, 0)).ok).toBe(true);

    const bySpell = [...w.puddles.values()].map((p) => p.spellId).sort();
    expect(bySpell).toEqual(['meteor_shower', 'plague']);
  });

  it('puts it on the wire, which is the only place the client can read it', () => {
    const w = new World(arena());
    ready(w);
    expect(w.castSpell(TEAM_A, 'meteor_shower', new Vec2(0, 0)).ok).toBe(true);

    const snap = buildSnapshot(w, 1);
    expect(snap.puddles).toHaveLength(1);
    expect(snap.puddles[0].spellId).toBe('meteor_shower');
  });
});
