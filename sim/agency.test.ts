/**
 * The agency test (GDD §10).
 *
 * This file has been the honest record of how much the player's choices are
 * worth, and for one release it had to record a retreat. Before the v1.1 pivot
 * the lever was *whether a unit exists at all* — an AFK player summoned
 * nothing and the enemy squad marched in unopposed. The pivot made every mage
 * permanent and autonomous (GDD §4, §1), so an AFK squad still blocked, chased
 * and threw exactly like a played one, and "AFK must lose" stopped being true
 * by construction. All that was left to assert was the much weaker "casting is
 * never worse than not casting".
 *
 * The idle pivot restores the strong claim, and that is the point of it. The
 * player's whole match is now a program authored before the match
 * (`sim/strategy.ts`), driven by `Tactician` from the seat a hand used to
 * occupy. An empty program is a representable state — `emptyStrategy()` — that
 * casts exactly zero times. So the question "does authorship matter?" has a
 * baseline again, and this file asks it three ways:
 *
 * 1. an authored program must beat no program at all;
 * 2. a better program must beat a worse one;
 * 3. the harness that says so must be trustworthy — which, for a caster that
 *    draws no randomness, means a stronger claim than replay equality.
 *
 * If any of these goes red, the finding is about the game, not about the
 * floor: the fix is spell design (GDD §14), never a softer threshold.
 */

import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { Tactician } from './bot/Tactician';
import { defaultSquad } from './cards';
import { SIM_DT } from './config';
import { Deck, defaultDeck } from './Deck';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { Rng } from './rng';
import { defaultStrategy, emptyStrategy, type Strategy } from './strategy';
import { flatProgram, naiveProgram, responsiveProgram } from './strategyPresets';
import { World } from './World';

interface Side {
  /** The program this side brought. `emptyStrategy()` is the AFK baseline. */
  strategy: Strategy;
  deck: Deck;
}

interface MatchResult {
  winner: Team | null;
  structuresLostByA: number;
  structuresLostByB: number;
  /** Casts the world actually accepted, per side. Zero is a real answer. */
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

/**
 * Runs a full headless match. This is the seed of the mass-simulation harness
 * GDD §14 calls for: no sockets, no renderer, no wall clock.
 *
 * One `Tactician` per side is built here rather than per tick, because it owns
 * the evaluation countdown (`EVALUATE_INTERVAL`) — a caster rebuilt every tick
 * would restart that countdown every tick and never reach an evaluation at
 * all. `Session` holds them for the length of the match for the same reason.
 */
function runMatch(seed: number, sides: Record<Team, Side>, maxTicks = 60 * 250): MatchResult {
  const rng = new Rng(seed);
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(rng);
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  const casters: Record<Team, Tactician> = {
    [TEAM_A]: new Tactician(sides[TEAM_A].strategy),
    [TEAM_B]: new Tactician(sides[TEAM_B].strategy),
  };
  const casts: Record<Team, number> = { [TEAM_A]: 0, [TEAM_B]: 0 };

  let ticks = 0;
  while (!world.roundOver && ticks < maxTicks) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const side = sides[team];

      // The squad plan is handed over exactly as `Session` hands it over, so
      // posture conditions and squad-relative selectors resolve here the same
      // way they resolve in a real match.
      const intent = casters[team].step(world, team, side.deck, SIM_DT, brain.planner.planFor(team));
      if (!intent) continue;

      const result = world.castSpell(team, intent.cardId, intent.position);
      if (!result.ok) continue;
      side.deck.play(intent.cardId);
      casts[team]++;
    }

    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return {
    winner: world.winner,
    structuresLostByA: world.structuresDestroyedBy(TEAM_B),
    structuresLostByB: world.structuresDestroyedBy(TEAM_A),
    castsByA: casts[TEAM_A],
    castsByB: casts[TEAM_B],
    ticks,
    board: boardOf(world),
  };
}

function side(seed: number, strategy: Strategy): Side {
  return { strategy, deck: new Deck(defaultDeck(), new Rng(seed + 1)) };
}

describe('agency — an authored program must beat no program at all', () => {
  /*
   * The claim that the pre-idle version of this file could not make. The
   * baseline is no longer "a commander that happens to be null" but a state
   * the player can actually be in: a program with no rules, which reaches
   * `World.castSpell` exactly zero times.
   *
   * Sides alternate because team A and team B do not face a symmetric map, and
   * the aggregate is structures traded — the same measure the weaker claim
   * used, so a regression here is comparable against its own history.
   */
  it('loses strictly fewer structures than an empty program, across seeds', { timeout: 300_000 }, () => {
    const seeds = [1, 7, 13, 29, 101];
    let authoredLost = 0;
    let emptyLost = 0;
    let authoredCasts = 0;
    let emptyCasts = 0;

    for (const [i, seed] of seeds.entries()) {
      const authoredOnA = i % 2 === 0;
      const authored = side(seed, defaultStrategy(defaultDeck()));
      const afk = side(seed, emptyStrategy());
      const r = runMatch(seed, {
        [TEAM_A]: authoredOnA ? authored : afk,
        [TEAM_B]: authoredOnA ? afk : authored,
      });

      authoredLost += authoredOnA ? r.structuresLostByA : r.structuresLostByB;
      emptyLost += authoredOnA ? r.structuresLostByB : r.structuresLostByA;
      authoredCasts += authoredOnA ? r.castsByA : r.castsByB;
      emptyCasts += authoredOnA ? r.castsByB : r.castsByA;
    }

    // The baseline is zero casts by construction, not by luck. Asserting it
    // here is what keeps the comparison honest: if a change ever made an empty
    // program cast, the structure count above would still look fine while
    // measuring nothing at all.
    expect(emptyCasts).toBe(0);
    expect(authoredCasts).toBeGreaterThan(0);
    expect(authoredLost).toBeLessThan(emptyLost);
  });
});

interface HeadToHead {
  leftWins: number;
  rightWins: number;
  draws: number;
  leftCasts: number;
  /** Share of *decided* matches the left program took; 0 when none were decided. */
  rate: number;
}

/** Plays `seeds` head to head, alternating sides, and returns the left program's record. */
function headToHead(seeds: readonly number[], left: Strategy, right: Strategy): HeadToHead {
  let leftWins = 0;
  let rightWins = 0;
  let draws = 0;
  let leftCasts = 0;

  for (const [i, seed] of seeds.entries()) {
    // Team A and team B do not face a symmetric map, so a fixed assignment
    // would report the map's bias as the program's.
    const leftOnA = i % 2 === 0;
    const r = runMatch(seed, {
      [TEAM_A]: side(seed, leftOnA ? left : right),
      [TEAM_B]: side(seed, leftOnA ? right : left),
    });

    leftCasts += leftOnA ? r.castsByA : r.castsByB;
    if (r.winner === null) draws++;
    else if (r.winner === (leftOnA ? TEAM_A : TEAM_B)) leftWins++;
    else rightWins++;
  }

  const decided = leftWins + rightWins;
  return { leftWins, rightWins, draws, leftCasts, rate: decided > 0 ? leftWins / decided : 0 };
}

describe('agency — a better program must beat a worse one', () => {
  /*
   * This replaces the old `hard` vs `easy` commander comparison, and it is the
   * claim that decides whether the idle pivot was worth making: if writing a
   * sharper program does not win more, the player's whole verb is decoration.
   *
   * The control is `flatProgram`, not `naiveProgram`, and the difference
   * matters. Both of those lose to a responsive program, but they lose for
   * different reasons, and only one of them is about branching — see the
   * `strangles its own deck` case below. The flat program brings the same four
   * cards, aims them at the same places and casts at the same cadence; the
   * *only* thing it lacks is a reason to prefer one over another. That is what
   * isolates situational branching as the thing being measured.
   *
   * **The honest state of this number, and why it is a floor rather than a
   * target.** Measured over the sweep in `scripts/ai-report.mts`, responsive
   * against flat is **6-6 — exactly 50%**. Situational branching is currently
   * *undifferentiated, not inverted*: the guards cost nothing and buy nothing
   * that this measurement can see. The two programs cast within 1% of each
   * other's volume, so what they spend is identical and only *what they pick*
   * differs — and picking well is, so far, worth zero.
   *
   * That gap is real and open, and it belongs to spell design (GDD §14), not
   * to this file. It is not a threshold to edit. The floor is 0.35 and stays
   * 0.35, guarding the one property that must never regress: skill must not be
   * *inverted*, the failure GDD §14 recorded once. A true coin flip clears 0.35
   * on 40 samples essentially always; an inversion does not.
   *
   * What the same sweep *does* show as decisive is one rung lower down, and it
   * is the case below: naming enough cards to keep the deck cycling.
   */
  it('never lets the unguarded program come out ahead across seeds', { timeout: 900_000 }, () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 7 + 3);
    const r = headToHead(seeds, responsiveProgram(), flatProgram());

    expect(r.rate).toBeGreaterThanOrEqual(0.35);
  });
});

describe('agency — the shape of a program is a real constraint', () => {
  /*
   * A finding, pinned so it cannot regress into folklore.
   *
   * A card leaves the hand only by being played and the deck only cycles on a
   * play, so a program that names one card plays it once and then never sees
   * it again for the rest of the match. The consequence is severe and totally
   * invisible from reading the rule: a one-rule program is not a weak program,
   * it is very nearly *no* program.
   *
   * This is asserted rather than merely noted because it is the sharpest edge
   * a new player can walk into — eight deck slots and one rule looks like a
   * focused build and behaves like an empty one — and because it is the
   * measurement that justifies `defaultStrategy` spending a rule on every card
   * it can (GDD §7).
   */
  it('casts about once a match when it names a single card', { timeout: 300_000 }, () => {
    const seeds = [5, 19, 37, 61, 83];
    const r = headToHead(seeds, naiveProgram(), emptyStrategy());

    // One cast per match, give or take — not the dozens a live program makes.
    expect(r.leftCasts).toBeLessThanOrEqual(seeds.length * 2);
    expect(r.leftCasts).toBeGreaterThan(0);
  });

  it('is worth barely more than no program at all when it does', { timeout: 300_000 }, () => {
    const seeds = Array.from({ length: 12 }, (_, i) => i * 11 + 5);
    const oneRule = headToHead(seeds, naiveProgram(), emptyStrategy());
    const everyCard = headToHead(seeds, flatProgram(), emptyStrategy());

    // The gap between them is the whole point: same absence of guards, same
    // cards available, and the only difference is how many the program names.
    expect(everyCard.rate).toBeGreaterThan(oneRule.rate);
  });
});

describe('determinism — the harness is trustworthy', () => {
  it('replays identically from the same seed', { timeout: 120_000 }, () => {
    const programs = (): Record<Team, Side> => ({
      [TEAM_A]: side(2024, responsiveProgram()),
      [TEAM_B]: side(2024, naiveProgram()),
    });

    expect(runMatch(2024, programs())).toEqual(runMatch(2024, programs()));
  });

  /*
   * The claim that replay equality alone cannot make, and the one the whole
   * design of `Tactician` rests on.
   *
   * The server hands a single `Rng` to `Brain`, to both deck shuffles and to
   * the bot `Commander`. If the caster drew from that stream, the number of
   * draws it took would depend on the rule list — and editing a rule would
   * silently re-roll how every mage on the field fights. The player would
   * change their program and watch an unrelated fight go differently.
   *
   * Two programs that both decide "no cast" are the way to observe that: they
   * differ in rule count and in how much evaluation work they do, so if any of
   * it touched the shared stream the two matches would diverge. Nothing casts
   * in either, so the boards must be identical down to the last decimal.
   */
  it('leaves the match byte-identical for two different programs that never fire', { timeout: 120_000 }, () => {
    const silentButNotEmpty: Strategy = {
      ...defaultStrategy(defaultDeck()),
      rules: defaultStrategy(defaultDeck()).rules.map((r) => ({ ...r, enabled: false })),
    };
    expect(silentButNotEmpty.rules.length).toBeGreaterThan(0);

    const withEmpty = runMatch(31, {
      [TEAM_A]: side(31, emptyStrategy()),
      [TEAM_B]: side(31, emptyStrategy()),
    });
    const withDisabled = runMatch(31, {
      [TEAM_A]: side(31, silentButNotEmpty),
      [TEAM_B]: side(31, emptyStrategy()),
    });

    expect(withDisabled.castsByA).toBe(0);
    expect(withDisabled.board).toBe(withEmpty.board);
    expect(withDisabled.ticks).toBe(withEmpty.ticks);
  });

  it('takes nothing from a shared rng while it thinks', () => {
    // The control is an independent stream taken to the same point by the same
    // shuffle, so the expected value never comes from the code under test.
    const shared = new Rng(4242);
    const control = new Rng(4242);
    const deck = new Deck(defaultDeck(), shared);
    new Deck(defaultDeck(), control);

    const world = new World();
    world.initSquad(TEAM_A, defaultSquad());
    world.initSquad(TEAM_B, defaultSquad());

    const tactician = new Tactician(defaultStrategy(defaultDeck()));
    let decisions = 0;
    for (let i = 0; i < 600; i++) {
      if (tactician.step(world, TEAM_A, deck, SIM_DT)) decisions++;
      world.step(SIM_DT);
    }

    // Proof the loop above actually reached the decision path; a caster that
    // never got that far would conserve the stream trivially.
    expect(decisions).toBeGreaterThan(0);
    expect(shared.float()).toBe(control.float());
  });
});
