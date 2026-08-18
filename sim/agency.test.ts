/**
 * The agency test (GDD §10).
 *
 * This file is the honest record of how much the player's choices are worth,
 * and the lever it measures has now moved twice. Before v1.1 it was *whether a
 * unit exists at all*. The idle pivot made it the program a player authored,
 * driven by a `Tactician` from the seat a hand used to occupy. v1.3 retires
 * both: there is no hand, no deck and no program, and what the player brings
 * to a match is **four bodies and a posture for each** (plano §3.1, §3.4).
 *
 * So the question "does authorship matter?" gets asked on the two axes that
 * are left:
 *
 * 1. **composition** — a squad that cannot hurt anything must lose to one that
 *    can;
 * 2. **posture** — telling four mages to sit on their kits must cost something
 *    measurable;
 * 3. and the harness that says so must be trustworthy, which for a chooser
 *    that draws no randomness means replay equality down to the last decimal.
 *
 * If any of these goes red, the finding is about the game, not about the
 * floor: the fix is kit design (GDD §14), never a softer threshold.
 */

import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import type { Stance } from './abilityPolicy';
import { defaultSquad, type RosterId } from './cards';
import { SIM_DT } from './config';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { Rng } from './rng';
import { World } from './World';

/** What a player actually brings to a match since v1.3: bodies and postures. */
interface Side {
  squad: readonly RosterId[];
  stances: Partial<Record<RosterId, Stance>>;
}

/** Every mage on this side stands the same way — the coarse lever, for measuring. */
function allAt(squad: readonly RosterId[], stance: Stance): Side {
  return { squad, stances: Object.fromEntries(squad.map((r) => [r, stance])) };
}

interface MatchResult {
  winner: Team | null;
  structuresLostByA: number;
  structuresLostByB: number;
  /** Casts the world actually accepted, per side. */
  castsByA: number;
  castsByB: number;
  ticks: number;
  /**
   * The whole final board, to six decimals. `toEqual` on the summary above
   * would call two matches identical when they merely ended the same way;
   * determinism is a claim about every body on the field.
   */
  board: string;
}

function boardOf(w: World): string {
  const parts: string[] = [];
  for (const id of [...w.mages.keys()].sort()) {
    const m = w.mage(id)!;
    parts.push(
      `${id}@${m.position.x.toFixed(6)},${m.position.y.toFixed(6)}:${m.health.toFixed(6)}:${m.alive ? 1 : 0}`,
    );
  }
  for (const id of [...w.structures.keys()].sort()) {
    const s = w.structures.get(id)!;
    parts.push(`${id}:${s.health.toFixed(6)}:${s.alive ? 1 : 0}`);
  }
  return parts.join('|');
}

function castsOf(w: World, team: Team): number {
  let n = 0;
  for (const c of w.castsBySpell.get(team)?.values() ?? []) n += c;
  return n;
}

/**
 * Runs a full headless match. This is the seed of the mass-simulation harness
 * GDD §14 calls for: no sockets, no renderer, no wall clock.
 *
 * There is no caster in this loop, and that absence *is* the pivot. A spell is
 * spent by the body that carries it, and `Brain` is the only thing that
 * reaches for one — so a match is now exactly two squads and a clock.
 */
function runMatch(seed: number, sides: Record<Team, Side>, maxTicks = 60 * 250): MatchResult {
  const world = new World();
  world.initSquad(TEAM_A, sides[TEAM_A].squad, sides[TEAM_A].stances);
  world.initSquad(TEAM_B, sides[TEAM_B].squad, sides[TEAM_B].stances);

  const brain = new Brain(new Rng(seed));
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  let ticks = 0;
  while (!world.roundOver && ticks < maxTicks) {
    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return {
    winner: world.winner,
    structuresLostByA: world.structuresDestroyedBy(TEAM_B),
    structuresLostByB: world.structuresDestroyedBy(TEAM_A),
    castsByA: castsOf(world, TEAM_A),
    castsByB: castsOf(world, TEAM_B),
    ticks,
    board: boardOf(world),
  };
}

interface HeadToHead {
  leftWins: number;
  rightWins: number;
  draws: number;
  leftCasts: number;
  rightCasts: number;
  leftLost: number;
  rightLost: number;
  /** Share of *decided* matches the left side took; 0 when none were decided. */
  rate: number;
}

/** Plays `seeds` head to head, alternating sides, and returns the left side's record. */
function headToHead(seeds: readonly number[], left: Side, right: Side): HeadToHead {
  let leftWins = 0;
  let rightWins = 0;
  let draws = 0;
  let leftCasts = 0;
  let rightCasts = 0;
  let leftLost = 0;
  let rightLost = 0;

  for (const [i, seed] of seeds.entries()) {
    // Team A and team B do not face a symmetric map, so a fixed assignment
    // would report the map's bias as the squad's.
    const leftOnA = i % 2 === 0;
    const r = runMatch(seed, {
      [TEAM_A]: leftOnA ? left : right,
      [TEAM_B]: leftOnA ? right : left,
    });

    leftCasts += leftOnA ? r.castsByA : r.castsByB;
    rightCasts += leftOnA ? r.castsByB : r.castsByA;
    leftLost += leftOnA ? r.structuresLostByA : r.structuresLostByB;
    rightLost += leftOnA ? r.structuresLostByB : r.structuresLostByA;

    if (r.winner === null) draws++;
    else if (r.winner === (leftOnA ? TEAM_A : TEAM_B)) leftWins++;
    else rightWins++;
  }

  const decided = leftWins + rightWins;
  return {
    leftWins,
    rightWins,
    draws,
    leftCasts,
    rightCasts,
    leftLost,
    rightLost,
    rate: decided > 0 ? leftWins / decided : 0,
  };
}

/** 20 seeds, alternating sides — the sample every threshold below was read off. */
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7 + 3);

describe('agency — the squad you bring is a real choice', () => {
  /*
   * The composition axis, and the one that replaced "an authored program must
   * beat no program at all". The baseline is no longer a program with no rules
   * but a squad with no answer: four support bodies, whose kits heal, shield
   * and buff and cannot take a structure down.
   *
   * Measured over `SEEDS` (n=20, alternating sides) this is **20-0**, with the
   * balanced squad losing **0** structures against 60. The floor is set far
   * under that on purpose — it guards the property that must never invert, not
   * the margin of the day.
   */
  it('beats a squad that brought no way to hurt anything, across seeds', { timeout: 600_000 }, () => {
    const balanced = allAt(defaultSquad(), 'normal');
    const noDamage = allAt(['cleric', 'cleric', 'arcane_bard', 'arcane_bard'], 'normal');

    const r = headToHead(SEEDS, balanced, noDamage);

    expect(r.rate).toBeGreaterThan(0.75);
    expect(r.leftLost).toBeLessThan(r.rightLost);
  });

  /*
   * **An open balance debt, pinned here so it does not become folklore.**
   *
   * The same harness run against an all-tank squad (`stone_golem` ×2,
   * `ice_sentinel` ×2) reports the balanced squad *losing* 3-17 over the same
   * n=20, 55 structures lost against 17. Durability is currently worth more
   * than the role rule asks a player to pay for it.
   *
   * That is deliberately **not** asserted. It is a number for the kit balance
   * pass (plano §5 / Fase 3), which owns the per-mage win-rate ceilings; an
   * assertion here would either freeze the imbalance as correct or fail for a
   * reason this file cannot fix.
   */
});

describe('agency — posture is a throttle the player controls', () => {
  /*
   * The posture axis. `hold` is the cautious end of the ladder (§3.4): a held
   * kit fires only when the guard opens — our core under pressure, this body
   * nearly dead, or an enemy already in our ground.
   *
   * Over `SEEDS` (n=20, alternating sides) a squad standing at `normal` beats
   * one standing at `hold` **17-3**, losing 26 structures against 47. The floor
   * is 0.6 rather than the observed 0.85: what must never regress is the
   * *direction* — spending your kits cannot be worse than sitting on them.
   */
  it('costs a squad structures to sit on its kits, across seeds', { timeout: 600_000 }, () => {
    const spending = allAt(defaultSquad(), 'normal');
    const sitting = allAt(defaultSquad(), 'hold');

    const r = headToHead(SEEDS, spending, sitting);

    expect(r.rate).toBeGreaterThan(0.6);
    expect(r.leftLost).toBeLessThan(r.rightLost);
  });

  /*
   * **A finding that corrects the plan, pinned so the next reader does not
   * re-derive it.** The refactor plan expected an all-`hold` squad to be the
   * v1.3 equivalent of an empty program — "≈ 0 casts", a mute button and a
   * clean zero baseline. It is not, and it cannot be.
   *
   * `HOLD_GUARD` opens on *our core under 60%*, on *this body under half
   * health*, or on *an intruder in our ground*. Every one of those becomes
   * true in the ordinary course of a match that is going badly — which is
   * exactly when a held kit is supposed to wake up. Measured, `hold` spends
   * about four fifths of what `normal` spends (2696 casts against 3382 over
   * n=20), not nothing.
   *
   * So `hold` is a throttle, and the zero-cast baseline the old file leaned on
   * is gone with the empty program. It is asserted in both directions, because
   * a `hold` that stopped firing entirely would be as wrong as one that
   * ignored its guard.
   */
  it('throttles a held kit without ever muting it', { timeout: 600_000 }, () => {
    const r = headToHead(SEEDS, allAt(defaultSquad(), 'normal'), allAt(defaultSquad(), 'hold'));

    expect(r.rightCasts).toBeLessThan(r.leftCasts);
    expect(r.rightCasts).toBeGreaterThan(r.leftCasts / 2);
  });
});

describe('determinism — the harness is trustworthy', () => {
  it('replays identically from the same seed', { timeout: 120_000 }, () => {
    const sides = (): Record<Team, Side> => ({
      [TEAM_A]: allAt(defaultSquad(), 'normal'),
      [TEAM_B]: allAt(defaultSquad(), 'aggressive'),
    });

    expect(runMatch(2024, sides())).toEqual(runMatch(2024, sides()));
  });

  /*
   * The claim replay equality alone cannot make, and the one the design of
   * `chooseAbility` rests on.
   *
   * `Brain` hands a single `Rng` to every mage's movement and targeting. If
   * choosing an ability drew from that stream, the number of draws it took
   * would depend on which kit a player brought — and swapping one mage would
   * silently re-roll how every *other* mage on the field fights. The player
   * would change one slot of their squad and watch an unrelated fight go
   * differently.
   *
   * `chooseAbility(mage, facts, self)` has no `Rng` in its signature, so the
   * type system carries most of this claim. What it cannot carry is the
   * evaluation *pass* around it, which is what this asserts: run `Brain` over
   * two squads that differ only in posture, and the shared stream must be at
   * the same point after both, because posture changes what is chosen and
   * never how much randomness choosing costs.
   */
  it('takes nothing from the shared rng to decide what a kit spends', () => {
    const streamAfter = (stance: Stance): number => {
      const rng = new Rng(4242);
      const world = new World();
      world.initSquad(TEAM_A, defaultSquad(), Object.fromEntries(defaultSquad().map((r) => [r, stance])));
      world.initSquad(TEAM_B, defaultSquad(), Object.fromEntries(defaultSquad().map((r) => [r, stance])));

      const brain = new Brain(rng);
      const units = new Map<string, Difficulty>();
      for (const id of world.mages.keys()) units.set(id, 'normal');

      // Long enough to cross several evaluation intervals and land real casts,
      // short enough that the two runs have not yet diverged into different
      // *fights* — which would move the stream for legitimate reasons.
      for (let i = 0; i < 60; i++) brain.step(world, units, SIM_DT);

      return rng.float();
    };

    expect(streamAfter('aggressive')).toBe(streamAfter('hold'));
  });
});
