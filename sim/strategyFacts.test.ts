/**
 * `buildFacts` is where the strategy evaluator meets the live world, and it is
 * the most likely home for a silent determinism bug: every "biggest cluster" and
 * "weakest ally" is a scan that must break ties the same way on both machines.
 */

import { describe, expect, it } from 'vitest';
import { applyEffect } from './effects';
import type { StrategyFacts } from './abilityPolicy';
import { CLUSTER_RADIUS, buildFacts } from './strategyFacts';
import { SIM_DT } from './config';
import { TEAM_A, TEAM_B } from './entities';
import { Vec2 } from './Vec2';
import { World } from './World';

describe('buildFacts — counting the squads', () => {
  it('counts the living on each side from the asking team’s point of view', () => {
    const w = new World();
    w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    w.summon(TEAM_A, 'cleric', new Vec2(-10, 1));
    w.summon(TEAM_B, 'pyromancer', new Vec2(10, 0));

    const mine = buildFacts(w, TEAM_A);
    const theirs = buildFacts(w, TEAM_B);

    expect(mine.allyCount).toBe(2);
    expect(mine.enemyCount).toBe(1);
    expect(theirs.allyCount).toBe(1);
    expect(theirs.enemyCount).toBe(2);
  });

  it('reads the lowest health on each side as a fraction', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    w.summon(TEAM_A, 'cleric', new Vec2(-10, 1));
    hurt.health = hurt.maxHealth * 0.25;

    expect(buildFacts(w, TEAM_A).allyLowestHealthFraction).toBeCloseTo(0.25);
  });

  /*
   * 1, not 0. "Somebody is hurt" must read false on an empty field, or a rule
   * guarded on `ally_health < 0.5` would fire forever after a wipe.
   */
  it('reports full health when nobody on that side is alive', () => {
    const w = new World();
    expect(buildFacts(w, TEAM_A).allyLowestHealthFraction).toBe(1);
    expect(buildFacts(w, TEAM_A).enemyLowestHealthFraction).toBe(1);
  });

  it('collects the effect kinds running on each side', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', new Vec2(10, 0));
    applyEffect(ally, { kind: 'shield', magnitude: 30, duration: 3 });
    applyEffect(enemy, { kind: 'slow', magnitude: 0.5, duration: 3 });

    const f = buildFacts(w, TEAM_A);

    expect(f.allyEffects.has('shield')).toBe(true);
    expect(f.allyEffects.has('slow')).toBe(false);
    expect(f.enemyEffects.has('slow')).toBe(true);
  });
});

describe('buildFacts — clusters', () => {
  it('finds the biggest group and centres the target on it', () => {
    const w = new World();
    // Three packed together, one off on its own.
    w.summon(TEAM_B, 'pyromancer', new Vec2(6, 0));
    w.summon(TEAM_B, 'pyromancer', new Vec2(6, 1));
    w.summon(TEAM_B, 'pyromancer', new Vec2(7, 0));
    w.summon(TEAM_B, 'cleric', new Vec2(-14, 12));

    const f = buildFacts(w, TEAM_A);

    expect(f.enemyClusterSize).toBe(3);
    const at = f.targets.enemy_cluster!;
    expect(at.x).toBeCloseTo((6 + 6 + 7) / 3);
    expect(at.y).toBeCloseTo((0 + 1 + 0) / 3);
  });

  it('counts a lone mage as a cluster of one', () => {
    const w = new World();
    w.summon(TEAM_B, 'pyromancer', new Vec2(6, 0));
    expect(buildFacts(w, TEAM_A).enemyClusterSize).toBe(1);
  });

  it('reports no cluster and no target when that side is empty', () => {
    const w = new World();
    const f = buildFacts(w, TEAM_A);
    expect(f.enemyClusterSize).toBe(0);
    expect(f.targets.enemy_cluster).toBeNull();
  });

  it('does not group mages further apart than the spell radius', () => {
    const w = new World();
    w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));
    w.summon(TEAM_B, 'pyromancer', new Vec2(CLUSTER_RADIUS * 2 + 1, 0));

    expect(buildFacts(w, TEAM_A).enemyClusterSize).toBe(1);
  });
});

describe('buildFacts — targets', () => {
  it('finds the intruder deepest into our own ground, and only past the midline', () => {
    const w = new World();
    // TEAM_A defends the negative x side, so an enemy at x < 0 is in our ground.
    const deep = w.summon(TEAM_B, 'pyromancer', new Vec2(-8, 0));
    w.summon(TEAM_B, 'pyromancer', new Vec2(-2, 0));

    const f = buildFacts(w, TEAM_A);

    expect(f.hasIntruder).toBe(true);
    expect(f.targets.deepest_intruder).toEqual(deep.position);
  });

  it('reports no intruder while the enemy stays on its own half', () => {
    const w = new World();
    w.summon(TEAM_B, 'pyromancer', new Vec2(8, 0));

    const f = buildFacts(w, TEAM_A);

    expect(f.hasIntruder).toBe(false);
    expect(f.targets.deepest_intruder).toBeNull();
  });

  it('picks the weakest ally and the strongest enemy', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    w.summon(TEAM_A, 'cleric', new Vec2(-10, 2));
    hurt.health = 10;

    const tough = w.summon(TEAM_B, 'stone_golem', new Vec2(10, 0));
    w.summon(TEAM_B, 'pyromancer', new Vec2(10, 2));

    const f = buildFacts(w, TEAM_A);

    expect(f.targets.weakest_ally).toEqual(hurt.position);
    expect(f.targets.strongest_enemy).toEqual(tough.position);
  });

  it('picks each side’s most advanced mage as its frontline', () => {
    const w = new World();
    w.summon(TEAM_A, 'pyromancer', new Vec2(-12, 0));
    const tip = w.summon(TEAM_A, 'cleric', new Vec2(2, 0));

    expect(buildFacts(w, TEAM_A).targets.ally_frontline).toEqual(tip.position);
  });

  it('resolves both cores', () => {
    const w = new World();
    const f = buildFacts(w, TEAM_A);

    expect(f.targets.our_core).not.toBeNull();
    expect(f.targets.enemy_core).not.toBeNull();
    expect(f.targets.our_core!.x).toBeLessThan(f.targets.enemy_core!.x);
  });

  it('leaves the plan-only selectors unresolved when no plan is given', () => {
    const w = new World();
    const f = buildFacts(w, TEAM_A);

    expect(f.posture).toBeNull();
    expect(f.targets.our_objective).toBeNull();
    expect(f.targets.squad_rally).toBeNull();
  });

  it('takes posture, objective and rally from the squad plan when there is one', () => {
    const w = new World();
    w.initSquad(TEAM_A, ['stone_golem', 'pyromancer', 'stormcaller', 'cleric']);
    const objective = [...w.structures.values()].find((s) => s.team === TEAM_B)!;
    const rally = new Vec2(-12, 3);

    const f = buildFacts(w, TEAM_A, {
      posture: 'defend',
      objective,
      rally,
      threat: null,
      intruders: [],
      defenderIds: [],
      anchorId: '',
      committed: false,
    });

    expect(f.posture).toBe('defend');
    expect(f.targets.our_objective).toEqual(objective.position);
    expect(f.targets.squad_rally).toEqual(rally);
  });
});

describe('buildFacts — structures and the clock', () => {
  it('reads core health as a fraction and counts living towers', () => {
    const w = new World();
    const f = buildFacts(w, TEAM_A);

    expect(f.ourCoreFraction).toBe(1);
    expect(f.enemyCoreFraction).toBe(1);
    expect(f.ourTowersAlive).toBe(2);
    expect(f.enemyTowersAlive).toBe(2);
  });

  it('follows a tower down', () => {
    const w = new World();
    const tower = [...w.structures.values()].find((s) => s.team === TEAM_B && s.kind === 'tower')!;
    tower.alive = false;
    tower.health = 0;

    expect(buildFacts(w, TEAM_A).enemyTowersAlive).toBe(1);
  });

  it('carries the clock and the mana bank straight through', () => {
    const w = new World();
    w.step(SIM_DT);

    const f = buildFacts(w, TEAM_A);

    expect(f.elapsed).toBeCloseTo(SIM_DT);
    expect(f.suddenDeath).toBe(false);
  });
});

/*
 * Every "best of" scan here walks `sortedMageIds` rather than the map. Today
 * `World` never deletes a mage, so map order happens to equal insertion order
 * and the guard is not yet load-bearing — which is exactly why it needs a test
 * that fails the day someone adds a `mages.delete`, rather than one that passes
 * because ids and insertion order agree.
 */
describe('buildFacts — determinism', () => {
  it('resolves a tie by mage id even when the map is reordered underneath it', () => {
    const w = new World();
    const first = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const second = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 1));
    // Identical health: the tie the scan has to resolve.
    first.health = 50;
    second.health = 50;

    const before = buildFacts(w, TEAM_A).targets.weakest_ally;

    // Re-insert the earlier mage at the back, as a delete/re-add would.
    w.mages.delete(first.id);
    w.mages.set(first.id, first);

    expect(buildFacts(w, TEAM_A).targets.weakest_ally).toEqual(before);
  });

  it('produces identical facts for two identically built worlds', () => {
    const build = (): StrategyFacts => {
      const w = new World();
      w.initSquad(TEAM_A, ['stone_golem', 'pyromancer', 'stormcaller', 'cleric']);
      w.initSquad(TEAM_B, ['ice_sentinel', 'arcane_archer', 'alchemist', 'arcane_bard']);
      for (let i = 0; i < 120; i++) w.step(SIM_DT);
      return buildFacts(w, TEAM_A);
    };

    expect(build()).toEqual(build());
  });
});
