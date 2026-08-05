/**
 * The pivot's simulation rules (GDD §4, §5, §6): structures, mana and the
 * deploy zone. These are the mechanics that replaced lives-and-elimination.
 */

import { describe, expect, it } from 'vitest';
import { cardFor } from './cards';
import {
  MANA_MAX,
  MANA_REGEN_INTERVAL,
  MANA_START,
  MATCH_DURATION,
  SIM_DT,
  TOWER_RANGE,
} from './config';
import { TEAM_A, TEAM_B, type Structure } from './entities';
import { Vec2 } from './Vec2';
import { World } from './World';

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step(SIM_DT);
}

function towersOf(w: World, team: number): Structure[] {
  return w.structuresOf(team as 0 | 1).filter((s) => s.kind === 'tower');
}

function coreOf(w: World, team: number): Structure {
  return w.structuresOf(team as 0 | 1).find((s) => s.kind === 'core')!;
}

function razeTowers(w: World, team: number): void {
  for (const t of towersOf(w, team)) {
    t.health = 0;
    t.alive = false;
  }
}

describe('structures', () => {
  it('gives each side a Core and two Towers from the map', () => {
    const w = new World();
    expect(towersOf(w, TEAM_A)).toHaveLength(2);
    expect(coreOf(w, TEAM_B)).toBeTruthy();
  });

  it('keeps a Core immune while either of its Towers stands', () => {
    const w = new World();
    const core = coreOf(w, TEAM_B);

    w.step(SIM_DT);
    expect(core.invulnerable).toBe(true);

    w.damageStructure(core, 9999);
    expect(core.alive).toBe(true);
    expect(core.health).toBe(core.maxHealth);
  });

  it('exposes the Core once both Towers are down', () => {
    const w = new World();
    razeTowers(w, TEAM_B);
    w.step(SIM_DT);

    const core = coreOf(w, TEAM_B);
    expect(core.invulnerable).toBe(false);

    w.damageStructure(core, 9999);
    expect(core.alive).toBe(false);
  });

  it('ends the match the instant a Core falls', () => {
    const w = new World();
    razeTowers(w, TEAM_B);
    w.step(SIM_DT);
    w.damageStructure(coreOf(w, TEAM_B), 9999);
    w.step(SIM_DT);

    expect(w.roundOver).toBe(true);
    expect(w.winner).toBe(TEAM_A);
  });

  it('scores normal time on structures destroyed', () => {
    const w = new World();
    const [tower] = towersOf(w, TEAM_B);
    tower.health = 0;
    tower.alive = false;

    w.elapsed = MATCH_DURATION;
    w.step(SIM_DT);

    expect(w.roundOver).toBe(true);
    expect(w.winner).toBe(TEAM_A);
  });

  it('goes to sudden death when normal time ends level', () => {
    const w = new World();
    w.elapsed = MATCH_DURATION;
    w.step(SIM_DT);

    expect(w.roundOver).toBe(false);
    expect(w.suddenDeath).toBe(true);
  });

  it('gives sudden death to the first structure to fall', () => {
    const w = new World();
    w.elapsed = MATCH_DURATION;
    w.step(SIM_DT);
    expect(w.suddenDeath).toBe(true);

    const [tower] = towersOf(w, TEAM_A);
    tower.health = 0;
    tower.alive = false;
    w.step(SIM_DT);

    expect(w.roundOver).toBe(true);
    expect(w.winner).toBe(TEAM_B);
  });

  it('shoots an enemy unit that walks into Tower range', () => {
    const w = new World();
    const [tower] = towersOf(w, TEAM_B);
    // Plant an enemy right next to it; the Tower should answer. Asserting on
    // damage rather than on projectiles in flight, because at this range the
    // bolt has already landed well before the cooldown allows a second one.
    const victim = w.summon(TEAM_A, 'pyromancer', new Vec2(tower.position.x - 3, tower.position.y));
    const full = victim.health;

    stepN(w, 30);

    expect(victim.health).toBeLessThan(full);
  });

  it('does not shoot at a unit beyond its range', () => {
    const w = new World();
    const [tower] = towersOf(w, TEAM_B);
    w.summon(TEAM_A, 'pyromancer', new Vec2(tower.position.x - (TOWER_RANGE + 6), tower.position.y));

    stepN(w, 30);

    expect([...w.projectiles.values()].filter((p) => p.ownerId === tower.id)).toHaveLength(0);
  });
});

describe('mana', () => {
  it('starts both teams at the opening amount', () => {
    const w = new World();
    expect(w.manaOf(TEAM_A)).toBe(MANA_START);
    expect(w.manaOf(TEAM_B)).toBe(MANA_START);
  });

  it('regenerates one mana per interval', () => {
    const w = new World();
    stepN(w, Math.ceil(MANA_REGEN_INTERVAL / SIM_DT) + 2);
    expect(w.manaOf(TEAM_A)).toBe(MANA_START + 1);
  });

  it('caps at the maximum', () => {
    const w = new World();
    stepN(w, Math.ceil((MANA_REGEN_INTERVAL * (MANA_MAX + 4)) / SIM_DT));
    expect(w.manaOf(TEAM_A)).toBe(MANA_MAX);
  });

  it('regenerates twice as fast in sudden death', () => {
    // A couple of ticks of slack keeps this off the exact interval boundary,
    // where float accumulation decides whether the last mana has landed yet.
    const ticks = Math.ceil((MANA_REGEN_INTERVAL * 2) / SIM_DT) + 4;

    const normal = new World();
    stepN(normal, ticks);

    const sudden = new World();
    sudden.suddenDeath = true;
    stepN(sudden, ticks);

    expect(normal.manaOf(TEAM_A) - MANA_START).toBe(2);
    expect(sudden.manaOf(TEAM_A) - MANA_START).toBe(4);
  });
});

describe('deploy', () => {
  it('spends the card cost and puts the unit where it was asked for', () => {
    const w = new World();
    const at = new Vec2(-10, 2);

    const result = w.deploy(TEAM_A, 'pyromancer', at);

    expect(result.ok).toBe(true);
    expect(w.manaOf(TEAM_A)).toBe(MANA_START - cardFor('pyromancer')!.cost);
    if (result.ok) {
      expect(result.mage.position.x).toBeCloseTo(at.x);
      expect(result.mage.role).toBe('damage');
    }
  });

  it('gives the unit the card’s own health and speed, not a global default', () => {
    const w = new World();
    const golem = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 0));
    const dervish = w.summon(TEAM_A, 'wind_dervish', new Vec2(-10, 4));

    expect(golem.maxHealth).toBe(cardFor('stone_golem')!.health);
    expect(golem.moveSpeed).toBeLessThan(dervish.moveSpeed);
  });

  it('refuses a card the team cannot afford', () => {
    const w = new World();
    // Golem costs 5, opening mana is 5 — spend some first.
    w.deploy(TEAM_A, 'arcane_archer', new Vec2(-10, 0));

    expect(w.deploy(TEAM_A, 'stone_golem', new Vec2(-10, 2))).toEqual({
      ok: false,
      reason: 'not_enough_mana',
    });
  });

  it('refuses an unknown card', () => {
    const w = new World();
    expect(w.deploy(TEAM_A, 'lich_king', new Vec2(-10, 0))).toEqual({
      ok: false,
      reason: 'unknown_card',
    });
  });

  it('confines a team to its own half before any Tower falls', () => {
    const w = new World();
    expect(w.canDeployAt(TEAM_A, new Vec2(-10, 0))).toBe(true);
    expect(w.canDeployAt(TEAM_A, new Vec2(6, 0))).toBe(false);
    expect(w.canDeployAt(TEAM_B, new Vec2(10, 0))).toBe(true);
    expect(w.canDeployAt(TEAM_B, new Vec2(-6, 0))).toBe(false);
  });

  it('opens the flank past the midline once its Tower is down', () => {
    const w = new World();
    const topTower = towersOf(w, TEAM_B).find((t) => t.position.y > 0)!;
    const forward = new Vec2(5, topTower.position.y);

    expect(w.canDeployAt(TEAM_A, forward)).toBe(false);

    topTower.health = 0;
    topTower.alive = false;

    expect(w.canDeployAt(TEAM_A, forward)).toBe(true);
    // The other flank stays shut — breaking one side does not open both.
    expect(w.canDeployAt(TEAM_A, new Vec2(5, -topTower.position.y))).toBe(false);
  });

  it('refuses to plant on top of a live enemy structure', () => {
    const w = new World();
    razeTowers(w, TEAM_B);
    w.step(SIM_DT);
    const core = coreOf(w, TEAM_B);

    expect(w.canDeployAt(TEAM_A, core.position)).toBe(false);
  });
});

describe('supports', () => {
  it('heals the most hurt ally in range', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    hurt.health = 20;
    w.summon(TEAM_A, 'cleric', new Vec2(-10, 1.6));

    stepN(w, 60);

    expect(hurt.health).toBeGreaterThan(20);
  });

  it('does not heal across the whole map', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-18, -12));
    hurt.health = 20;
    w.summon(TEAM_A, 'cleric', new Vec2(-2, 12));

    stepN(w, 60);

    expect(hurt.health).toBe(20);
  });

  it('speeds up an ally’s charge with the Bard aura', () => {
    const w = new World();
    const solo = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    w.step(SIM_DT);
    expect(solo.chargeRateBonus).toBe(0);

    w.summon(TEAM_A, 'arcane_bard', new Vec2(-10, 1.6));
    w.step(SIM_DT);

    expect(solo.chargeRateBonus).toBeGreaterThan(0);
  });
});
