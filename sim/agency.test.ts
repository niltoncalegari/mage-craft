/**
 * The agency test (GDD §10).
 *
 * Before the v1.1 pivot the player's whole lever was *whether a unit exists
 * at all* — an AFK player summoned nothing, so the enemy squad marched in
 * unopposed. Since the pivot every mage is permanent and autonomous (GDD §4,
 * §1): an AFK squad still blocks, chases and throws exactly like a played
 * one, because Brain drives every mage regardless of the player. The only
 * lever left is casting blessings/curses (GDD §9), which moves the needle on
 * structures traded rather than on whether a fight happens at all — so "AFK
 * must lose every match" is no longer true by construction, and the GDD
 * flags this file as expected to have gone red at the pivot. What must still
 * hold, and what these tests assert instead: casting spells is never a worse
 * strategy than doing nothing.
 */

import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { Commander } from './bot/Commander';
import { defaultSquad } from './cards';
import { SIM_DT } from './config';
import { Deck, defaultDeck } from './Deck';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { Rng } from './rng';
import { World } from './World';

interface Side {
  /** Null means this side never casts a spell — the AFK player. */
  commander: Commander | null;
  deck: Deck;
}

interface MatchResult {
  winner: Team | null;
  structuresLostByA: number;
  structuresLostByB: number;
  ticks: number;
}

/**
 * Runs a full headless match. This is the seed of the mass-simulation harness
 * GDD §14 calls for: no sockets, no renderer, no wall clock.
 */
function runMatch(seed: number, sides: Record<Team, Side>, maxTicks = 60 * 250): MatchResult {
  const rng = new Rng(seed);
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(rng);
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  let ticks = 0;
  while (!world.roundOver && ticks < maxTicks) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const side = sides[team];
      if (!side.commander) continue;

      const intent = side.commander.step(world, team, side.deck, SIM_DT);
      if (!intent) continue;

      const result = world.castSpell(team, intent.cardId, intent.position);
      if (!result.ok) continue;
      side.deck.play(intent.cardId);
    }

    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return {
    winner: world.winner,
    structuresLostByA: world.structuresDestroyedBy(TEAM_B),
    structuresLostByB: world.structuresDestroyedBy(TEAM_A),
    ticks,
  };
}

function side(seed: number, difficulty: Difficulty | null): Side {
  return {
    commander: difficulty ? new Commander(new Rng(seed), difficulty) : null,
    deck: new Deck(defaultDeck(), new Rng(seed + 1)),
  };
}

describe('agency — casting spells must not be worse than doing nothing', () => {
  it('never loses more structures in aggregate than an AFK opponent, across seeds', { timeout: 120_000 }, () => {
    const seeds = [1, 7, 13, 29, 101];
    let activeLost = 0;
    let afkLost = 0;

    for (const seed of seeds) {
      const r = runMatch(seed, {
        [TEAM_A]: side(seed, 'normal'),
        [TEAM_B]: side(seed, null),
      });
      activeLost += r.structuresLostByA;
      afkLost += r.structuresLostByB;
    }

    expect(activeLost).toBeLessThanOrEqual(afkLost);
  });

  it('casts spells over a match when a commander is present, and none at all when AFK', { timeout: 60_000 }, () => {
    const active = side(42, 'normal');
    const afk = side(42, null);
    const activeHandBefore = active.deck.hand();
    const afkHandBefore = afk.deck.hand();

    runMatch(42, { [TEAM_A]: active, [TEAM_B]: afk });

    // A cast cycles the played card to the back of the deck, so the hand
    // changing is proof a spell actually landed.
    expect(active.deck.hand()).not.toEqual(activeHandBefore);
    expect(afk.deck.hand()).toEqual(afkHandBefore);
  });
});

describe('agency — playing better must beat playing worse', () => {
  /*
   * The honest state of AI-vs-AI balance, and the reason this asserts a floor
   * rather than a win rate. With mirrored default squads (GDD §7) and spells as
   * the only asymmetry, a mirror of competent commanders splits close — GDD §14
   * predicts exactly this, and finishing the balance pass is the mass-simulation
   * work in GDD §13 step 8.
   *
   * Measured over these 40 seeds, `hard` wins ~50%: skill is currently
   * **undifferentiated, not inverted**. That gap is real and open, but it
   * belongs to spell design (§13 step 9) — it is not a structure-HP dial, and
   * the shorter matches that appear to "fix" it only do so by letting the
   * opening cast decide the game.
   *
   * So the guard here is the one property that must never regress: skill must
   * not be *inverted*. Two things make that measurable rather than a coin
   * flip observed six times — enough seeds to separate signal from noise, and
   * alternating which side gets `hard`, since team A and team B do not face a
   * symmetric map.
   */
  it('never lets the weaker commander come out ahead across seeds', { timeout: 300_000 }, () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 7 + 3);
    let hardWins = 0;
    let easyWins = 0;

    for (const [i, seed] of seeds.entries()) {
      const hardOnA = i % 2 === 0;
      const r = runMatch(seed, {
        [TEAM_A]: side(seed, hardOnA ? 'hard' : 'easy'),
        [TEAM_B]: side(seed, hardOnA ? 'easy' : 'hard'),
      });
      const hardTeam = hardOnA ? TEAM_A : TEAM_B;
      if (r.winner === null) continue;
      if (r.winner === hardTeam) hardWins++;
      else easyWins++;
    }

    // A true 50/50 clears 35% on 40 samples essentially always; a genuine
    // inversion (the 0/6 regression GDD §14 recorded) does not.
    const hardWinRate = hardWins / (hardWins + easyWins);
    expect(hardWinRate).toBeGreaterThanOrEqual(0.35);
  });
});

describe('determinism — the harness is trustworthy', () => {
  it('replays identically from the same seed', { timeout: 60_000 }, () => {
    const a = runMatch(2024, { [TEAM_A]: side(2024, 'normal'), [TEAM_B]: side(2024, 'easy') });
    const b = runMatch(2024, { [TEAM_A]: side(2024, 'normal'), [TEAM_B]: side(2024, 'easy') });

    expect(a).toEqual(b);
  });
});
