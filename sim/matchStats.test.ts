import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { defaultSquad } from './cards';
import { SIM_DT } from './config';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { summarize, type MageStat } from './matchStats';
import { Rng } from './rng';
import { Vec2 } from './Vec2';
import { World } from './World';

/**
 * A full headless match, mirroring agency.test.ts's harness.
 *
 * Nothing here plays a hand any more: since v1.3 the spells a side spends come
 * out of its four kits, and `Brain` is the only thing that reaches for them.
 * The loop is what a real match is — two squads and a clock.
 */
function playMatch(seed: number, maxTicks = 60 * 250): World {
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(new Rng(seed));
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  let ticks = 0;
  while (!world.roundOver && ticks < maxTicks) {
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

  it('counts the casts the two squads actually spent', () => {
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

/**
 * Per-mage attribution (plano v1.3 §7.1). The team tally answers "which spells
 * did this side spend"; since v1.3 that is no longer the same question as
 * "which mage earned its place", because a spell now belongs to a body. A
 * post-match screen that could not tell the two apart would leave the player's
 * one real decision — who to bring — unmeasurable.
 */
describe('summarize — what each body spent', () => {
  it('names the owning body beside each spell in the team tally', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    expect(w.castAbility(cleric.id, 'blessing', cleric.position).ok).toBe(true);

    // The team tally keeps `cardId` as its key — that is the shape the match
    // log has stored since before the pivot — and gains the owner beside it, so
    // "which mage earned its place" is answerable without a second table.
    expect(summarize(w).perTeam[TEAM_A].casts).toEqual([
      { cardId: 'blessing', rosterId: 'cleric', casts: 1 },
    ]);
  });

  it('credits a cast to the mage that carried it, and to nobody else', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const golem = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));

    expect(w.castAbility(cleric.id, 'blessing', cleric.position).ok).toBe(true);
    w.step(1);
    expect(w.castAbility(cleric.id, 'consecrated_ground', cleric.position).ok).toBe(true);

    const mages = summarize(w).perTeam[TEAM_A].mages;
    const byRoster = (id: string): MageStat => mages.find((m) => m.rosterId === id)!;

    expect(byRoster('cleric').casts).toBe(2);
    expect(byRoster('stone_golem').casts).toBe(0);
    expect(golem.id).not.toBe(cleric.id);
  });

  /**
   * `castSpell` survives as an effect door for the tests that predate the
   * pivot, and it has no caster to credit — so the two tallies can only be
   * reconciled on a board where every spell came out of somebody's kit, which
   * is what a v1.3 match is.
   */
  it('adds up to the tally the team already kept, when every spell came from a kit', () => {
    const world = new World();
    world.initSquad(TEAM_A, defaultSquad());
    world.initSquad(TEAM_B, defaultSquad());

    const brain = new Brain(new Rng(99));
    const units = new Map<string, Difficulty>();
    for (const id of world.mages.keys()) units.set(id, 'normal');

    for (let i = 0; i < 60 * 30; i++) {
      brain.step(world, units, SIM_DT);
      world.step(SIM_DT);
    }

    const summary = summarize(world);
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const side = summary.perTeam[team];
      const bySpell = side.casts.reduce((n, c) => n + c.casts, 0);
      const byMage = side.mages.reduce((n, m) => n + m.casts, 0);
      expect(bySpell).toBeGreaterThan(0);
      expect(byMage).toBe(bySpell);
    }
  });
});
