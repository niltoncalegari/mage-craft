/**
 * Who gets credited for taking a mage off the field (GDD §4).
 *
 * The rule the whole squad dashboard rests on: a mage's `kills` only counts
 * enemies it personally put down, while a *team's* kill total is the opposing
 * team's `deaths`. Those two numbers deliberately disagree — a Tower bolt, a
 * Praga zone and friendly fire all cost a side presence with nobody to credit —
 * and most of what follows pins down exactly which is which.
 */

import { describe, expect, it } from 'vitest';
import { Arena } from './Arena';
import { PLAGUE_TICK_INTERVAL, RESPAWN_DELAY, SIM_DT } from './config';
import { TEAM_A, TEAM_B, type Mage, type Team } from './entities';
import { Vec2 } from './Vec2';
import { World } from './World';

/** Seconds between ticks of the planted puddles below. */
const PUDDLE_TICK = 0.5;

/** A bare rectangle: these tests place mages by hand and want no map furniture. */
function combatWorld(): World {
  return new World(new Arena(30, 20));
}

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step(SIM_DT);
}

/** Total deaths on `team` — which is, by definition, the other side's kill count. */
function deathsOf(w: World, team: Team): number {
  let n = 0;
  for (const m of w.mages.values()) if (m.team === team) n += m.deaths;
  return n;
}

function totalKills(w: World): number {
  let n = 0;
  for (const m of w.mages.values()) n += m.kills;
  return n;
}

/** Drops `victim` with a single blow attributed to `attackerId`. */
function finishOff(w: World, victim: Mage, attackerId: string | null): void {
  w.dealDamage(victim, victim.maxHealth * 2, Vec2.zero, 0, false, attackerId);
}

/**
 * Drops a ground hazard on the field the way a poison flask does, without
 * flying the flask. `ownerId` is the whole point of these tests.
 */
function plantPuddle(w: World, ownerId: string, position: Vec2): void {
  const id = `test-puddle-${w.puddles.size}`;
  w.puddles.set(id, {
    id,
    ownerId,
    position,
    radius: 2,
    duration: 10,
    elapsed: 0,
    tickInterval: PUDDLE_TICK,
    tickDamage: 6,
    tickTimer: 0,
    alive: true,
  });
}

describe('kill credit', () => {
  it('credits the mage whose blow lands the kill', () => {
    const w = combatWorld();
    const killer = w.summon(TEAM_A, 'pyromancer', new Vec2(-4, 0));
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(4, 0));

    finishOff(w, victim, killer.id);

    expect(victim.alive).toBe(false);
    expect(victim.deaths).toBe(1);
    expect(killer.kills).toBe(1);
    expect(killer.deaths).toBe(0);
  });

  it('starts every mage at zero', () => {
    const w = combatWorld();
    const m = w.summon(TEAM_A, 'stone_golem', Vec2.zero);
    expect(m.kills).toBe(0);
    expect(m.deaths).toBe(0);
  });

  it('never credits a mage for killing its own team', () => {
    const w = combatWorld();
    const shooter = w.summon(TEAM_A, 'alchemist', new Vec2(-2, 0));
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(2, 0));

    finishOff(w, ally, shooter.id);

    expect(ally.deaths).toBe(1);
    expect(shooter.kills).toBe(0);
  });

  it('never credits a mage for its own death', () => {
    const w = combatWorld();
    const m = w.summon(TEAM_A, 'pyromancer', Vec2.zero);

    finishOff(w, m, m.id);

    expect(m.deaths).toBe(1);
    expect(m.kills).toBe(0);
  });
});

describe('kills nobody can claim', () => {
  /*
   * The regression most likely to slip back in: a Tower's projectile carries the
   * *structure's* id, which is not a mage id at all.
   */
  it('counts a Tower kill as a death with no killer', () => {
    const w = new World();
    const [tower] = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower');
    const victim = w.summon(TEAM_A, 'pyromancer', new Vec2(tower.position.x - 3, tower.position.y));
    victim.health = 1;

    stepN(w, 60);

    expect(victim.deaths).toBe(1);
    expect(totalKills(w)).toBe(0);
    expect(deathsOf(w, TEAM_A)).toBe(1);
  });

  it('counts a Praga kill as a death with no killer, on either team', () => {
    const w = combatWorld();
    const enemy = w.summon(TEAM_B, 'pyromancer', Vec2.zero);
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(0.8, 0));
    enemy.health = 1;
    ally.health = 1;

    // A curse zone is cast by a *team*, so its puddle owner is the literal
    // 'spell' — and it hurts everyone standing in it, caster's squad included.
    w.castSpell(TEAM_A, 'plague', Vec2.zero);
    stepN(w, Math.ceil(PLAGUE_TICK_INTERVAL / SIM_DT) + 2);

    expect(enemy.deaths).toBe(1);
    expect(ally.deaths).toBe(1);
    expect(totalKills(w)).toBe(0);
  });

  it('does not credit a poison puddle that kills its owner’s own teammate', () => {
    const w = combatWorld();
    const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(-6, 0));
    const ally = w.summon(TEAM_A, 'pyromancer', Vec2.zero);
    ally.health = 1;

    // A flask that missed still contaminates the ground it lands on (GDD §8.5),
    // and that ground does not check whose side you are on.
    plantPuddle(w, alchemist.id, Vec2.zero);
    stepN(w, Math.ceil(PUDDLE_TICK / SIM_DT) + 2);

    expect(ally.deaths).toBe(1);
    expect(alchemist.kills).toBe(0);
  });

  it('credits a poison puddle that kills an enemy to the mage who threw it', () => {
    const w = combatWorld();
    const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(-6, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', Vec2.zero);
    enemy.health = 1;

    plantPuddle(w, alchemist.id, Vec2.zero);
    stepN(w, Math.ceil(PUDDLE_TICK / SIM_DT) + 2);

    expect(enemy.deaths).toBe(1);
    expect(alchemist.kills).toBe(1);
  });
});

describe('a match-long record', () => {
  it('keeps kills and deaths across a respawn', () => {
    const w = combatWorld();
    const killer = w.summon(TEAM_A, 'pyromancer', new Vec2(-4, 0));
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(4, 0));

    finishOff(w, victim, killer.id);
    stepN(w, Math.ceil(RESPAWN_DELAY / SIM_DT) + 5);

    expect(victim.alive).toBe(true);
    expect(victim.health).toBe(victim.maxHealth);
    expect(victim.deaths).toBe(1);
    expect(killer.kills).toBe(1);
  });

  /*
   * The contract the dashboard's team total is computed from. It is asserted
   * here so a future refactor cannot quietly redefine "abates" as the sum of
   * per-mage kills, which would lose every Tower and Praga kill.
   */
  it('holds team kills = the other team’s deaths, even when nobody is credited', () => {
    const w = combatWorld();
    const killer = w.summon(TEAM_A, 'pyromancer', new Vec2(-4, 0));
    const shotDown = w.summon(TEAM_B, 'pyromancer', new Vec2(4, 0));
    const hazardVictim = w.summon(TEAM_B, 'stormcaller', new Vec2(6, 0));

    finishOff(w, shotDown, killer.id);
    finishOff(w, hazardVictim, 'tower-1-0');

    expect(deathsOf(w, TEAM_B)).toBe(2);
    expect(killer.kills).toBe(1);
    // Strictly greater: the hazard kill counts for the team and for no mage.
    expect(deathsOf(w, TEAM_B)).toBeGreaterThan(totalKills(w));
  });

  it('produces the same tally from the same sequence', () => {
    const script = (w: World): void => {
      const a = w.summon(TEAM_A, 'pyromancer', new Vec2(-4, 0));
      const b = w.summon(TEAM_B, 'pyromancer', new Vec2(4, 0));
      const c = w.summon(TEAM_B, 'stormcaller', new Vec2(6, 1));
      finishOff(w, b, a.id);
      finishOff(w, c, a.id);
      finishOff(w, a, b.id);
      stepN(w, 30);
    };

    const tally = (w: World): string =>
      [...w.mages.values()]
        .map((m) => `${m.id}:${m.kills}/${m.deaths}`)
        .sort()
        .join(' ');

    const first = combatWorld();
    const second = combatWorld();
    script(first);
    script(second);

    expect(tally(first)).toBe(tally(second));
    expect(tally(first)).toMatch(/mage-1:2\/1/);
  });
});
