/**
 * The v1.1 pivot's simulation rules (GDD §4, §5, §6, §7, §9): structures,
 * mana, the permanent squad and spells. These replaced both the original
 * lives-and-elimination model and the v1.0 unit-summoning cards.
 */

import { describe, expect, it } from 'vitest';
import { magnitudeOf } from './effects';
import { defaultSquad } from './cards';
import {
  CHARGE_TIME,
  MANA_MAX,
  MANA_REGEN_INTERVAL,
  MANA_START,
  MATCH_DURATION,
  PLAGUE_TICK_INTERVAL,
  SHIELD_AMOUNT,
  SIM_DT,
  SPELL_CAST_FX_DURATION,
  SQUAD_SIZE,
  TOWER_RANGE,
} from './config';
import { emptyInput, TEAM_A, TEAM_B, type Structure } from './entities';
import { spellFor } from './spells';
import { Vec2 } from './Vec2';
import { World } from './World';

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step(SIM_DT);
}

/** Drives a mage through a full charge and a release, as World.test.ts does. */
function fullyChargeAndRelease(w: World, id: string, target: Vec2): void {
  w.setInput(id, { ...emptyInput(), aim: target, charging: true });
  stepN(w, Math.floor(CHARGE_TIME / SIM_DT) + 5);
  w.setInput(id, { ...emptyInput(), aim: target, release: true });
  w.step(SIM_DT);
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

describe('squad (GDD §4, §7)', () => {
  it('gives each team its full, permanent squad at match start', () => {
    const w = new World();
    w.initSquad(TEAM_A, defaultSquad());
    w.initSquad(TEAM_B, defaultSquad());

    expect([...w.mages.values()].filter((m) => m.team === TEAM_A)).toHaveLength(SQUAD_SIZE);
    expect([...w.mages.values()].filter((m) => m.team === TEAM_B)).toHaveLength(SQUAD_SIZE);
  });

  it('never permanently removes a mage — it respawns instead (GDD §4)', () => {
    const w = new World();
    w.initSquad(TEAM_A, defaultSquad());
    const [mage] = [...w.mages.values()];

    mage.health = 1;
    w.dealDamage(mage, 999, { knockDir: new Vec2(1, 0) });
    expect(mage.alive).toBe(false);

    stepN(w, 60 * 30);

    expect(w.mage(mage.id)).toBeDefined();
    expect(mage.alive).toBe(true);
  });
});

describe('spells (GDD §9)', () => {
  it('spends the spell cost and buffs allies in radius, not the enemy', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.5));

    const result = w.castSpell(TEAM_A, 'blessing', ally.position);

    expect(result).toEqual({ ok: true });
    expect(w.manaOf(TEAM_A)).toBe(MANA_START - spellFor('blessing')!.cost);
    expect(magnitudeOf(ally, 'haste')).toBeGreaterThan(0);
    expect(magnitudeOf(ally, 'cast_haste')).toBeGreaterThan(0);
    expect(magnitudeOf(enemy, 'haste')).toBe(0);
  });

  it('curses enemies in radius, not the caster’s own team', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.5));

    w.castSpell(TEAM_A, 'slow_curse', enemy.position);

    expect(magnitudeOf(enemy, 'slow')).toBeGreaterThan(0);
    expect(magnitudeOf(ally, 'slow')).toBe(0);
  });

  it('shields absorb damage before health', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));

    w.castSpell(TEAM_A, 'arcane_shield', ally.position);
    expect(magnitudeOf(ally, 'shield')).toBe(SHIELD_AMOUNT);

    w.dealDamage(ally, 20);

    expect(ally.health).toBe(ally.maxHealth);
    expect(magnitudeOf(ally, 'shield')).toBe(SHIELD_AMOUNT - 20);
  });

  it('plague ticks damage on anyone standing in the zone, bypassing shield', () => {
    const w = new World();
    const target = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    w.castSpell(TEAM_A, 'arcane_shield', target.position);
    expect(magnitudeOf(target, 'shield')).toBeGreaterThan(0);

    w.castSpell(TEAM_B, 'plague', target.position);
    stepN(w, Math.ceil(PLAGUE_TICK_INTERVAL / SIM_DT) + 2);

    expect(target.health).toBeLessThan(target.maxHealth);
    // Praga ignores the shield entirely — it is not merely absorbed.
    expect(magnitudeOf(target, 'shield')).toBeGreaterThan(0);
  });

  it('refuses a spell the team cannot afford', () => {
    const w = new World();
    w.castSpell(TEAM_A, 'plague', Vec2.zero); // cost 4 of the opening 5 mana

    expect(w.castSpell(TEAM_A, 'slow_curse', Vec2.zero)).toEqual({
      ok: false,
      reason: 'not_enough_mana',
    });
  });

  it('refuses an unknown spell', () => {
    const w = new World();
    expect(w.castSpell(TEAM_A, 'fireball_of_doom', new Vec2(-10, 0))).toEqual({
      ok: false,
      reason: 'unknown_card',
    });
  });

  it('refuses a position outside the arena', () => {
    const w = new World();
    expect(w.castSpell(TEAM_A, 'blessing', new Vec2(9999, 9999))).toEqual({
      ok: false,
      reason: 'out_of_bounds',
    });
  });

  it('can target anywhere on the map, including on top of an enemy structure — no deploy zone since the pivot (GDD §5)', () => {
    const w = new World();
    const core = coreOf(w, TEAM_B);
    expect(w.castSpell(TEAM_A, 'slow_curse', core.position)).toEqual({ ok: true });
  });

  it('leaves a cast marker clients can draw VFX from, and expires it', () => {
    const w = new World();
    const at = new Vec2(-10, 0);

    w.castSpell(TEAM_A, 'blessing', at);

    const fx = [...w.spellCasts.values()];
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ spellId: 'blessing', team: TEAM_A, position: at });
    // A buff applies instantly, so without this marker the wire would carry no
    // trace at all of three of the four spells in the deck.
    expect(fx[0].radius).toBe(spellFor('blessing')!.radius);

    stepN(w, Math.ceil(SPELL_CAST_FX_DURATION / SIM_DT) + 2);
    expect(w.spellCasts.size).toBe(0);
  });

  it('does not record a marker for a rejected cast', () => {
    const w = new World();
    w.castSpell(TEAM_A, 'fireball_of_doom', new Vec2(-10, 0));
    expect(w.spellCasts.size).toBe(0);
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

  /**
   * Supports throw now (GDD §8) — a weak attack of their own, so a Cleric
   * standing behind the line is not a spectator. Each carries its *own*
   * element, which is what makes the two of them tellable apart on the field
   * from the Arcane Archer they used to share `arcane` with.
   */
  it('gives each support its own attack', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const bard = w.summon(TEAM_A, 'arcane_bard', new Vec2(-10, 4));

    // Read each shot right after its own release: a support's projectile is a
    // slow lob, and it has already landed by the time the other has charged.
    fullyChargeAndRelease(w, cleric.id, new Vec2(10, 0));
    const clericShots = [...w.projectiles.values()].map((p) => p.element);

    fullyChargeAndRelease(w, bard.id, new Vec2(10, 4));
    const bardShots = [...w.projectiles.values()].map((p) => p.element);

    expect(clericShots).toContain('holy');
    expect(bardShots).toContain('sonic');
  });

  /** Throwing must not cost the Cleric the thing it is actually for. */
  it('keeps healing while it attacks', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    hurt.health = 20;
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 1.6));

    fullyChargeAndRelease(w, cleric.id, new Vec2(10, 0));

    expect([...w.projectiles.values()].some((p) => p.element === 'holy')).toBe(true);
    expect(hurt.health).toBeGreaterThan(20);
  });
});
