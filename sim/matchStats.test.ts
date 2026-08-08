import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { Commander } from './bot/Commander';
import { defaultSquad } from './cards';
import { SIM_DT } from './config';
import { Deck, defaultDeck } from './Deck';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { summarize } from './matchStats';
import { Rng } from './rng';
import { World } from './World';

/** A full headless match, both sides commanded, mirroring agency.test.ts's harness. */
function playMatch(seed: number, maxTicks = 60 * 250): World {
  const rng = new Rng(seed);
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(rng);
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  const sides: Record<Team, { commander: Commander; deck: Deck }> = {
    [TEAM_A]: { commander: new Commander(new Rng(seed + 1), 'hard'), deck: new Deck(defaultDeck(), new Rng(seed + 2)) },
    [TEAM_B]: { commander: new Commander(new Rng(seed + 3), 'hard'), deck: new Deck(defaultDeck(), new Rng(seed + 4)) },
  };

  let ticks = 0;
  while (!world.roundOver && ticks < maxTicks) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const side = sides[team];
      const intent = side.commander.step(world, team, side.deck, SIM_DT);
      if (!intent) continue;
      if (!world.castSpell(team, intent.cardId, intent.position).ok) continue;
      side.deck.play(intent.cardId);
    }
    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return world;
}

describe('summarize', () => {
  it('reports the same winner and structure count the world holds', () => {
    const world = playMatch(1234);
    const summary = summarize(world);

    expect(summary.winnerTeam).toBe(world.winner ?? -1);
    expect(summary.durationSeconds).toBeCloseTo(world.elapsed);
    expect(summary.suddenDeath).toBe(world.suddenDeath);
    expect(summary.perTeam[TEAM_A].structuresDestroyed).toBe(world.structuresDestroyedBy(TEAM_A));
    expect(summary.perTeam[TEAM_B].structuresDestroyed).toBe(world.structuresDestroyedBy(TEAM_B));
  });

  it('counts the casts both commanders actually spent', () => {
    const summary = summarize(playMatch(99));

    const castsA = summary.perTeam[TEAM_A].casts;
    expect(castsA.length).toBeGreaterThan(0);
    expect(castsA.reduce((n, c) => n + c.casts, 0)).toBeGreaterThan(0);
    // Sorted most-cast first, so the UI can render it without re-sorting.
    expect([...castsA].sort((a, b) => b.casts - a.casts)).toEqual(castsA);
  });

  it('credits a side its opponents deaths, so tower and zone kills are not lost', () => {
    const world = playMatch(7);
    const summary = summarize(world);

    const bDeaths = [...world.mages.values()].filter((m) => m.team === TEAM_B).reduce((n, m) => n + m.deaths, 0);
    expect(summary.perTeam[TEAM_A].kills).toBe(bDeaths);
    expect(summary.perTeam[TEAM_B].deaths).toBe(bDeaths);
  });

  it('reports the squad each side fielded', () => {
    const summary = summarize(playMatch(3));

    expect([...summary.perTeam[TEAM_A].squad].sort()).toEqual([...defaultSquad()].sort());
    expect(summary.perTeam[TEAM_A].mages).toHaveLength(defaultSquad().length);
  });

  it('reports no casts for a world nobody cast in', () => {
    const world = new World();
    world.initSquad(TEAM_A, defaultSquad());
    world.initSquad(TEAM_B, defaultSquad());

    expect(summarize(world).perTeam[TEAM_A].casts).toEqual([]);
  });
});
