/**
 * The v1.1 pivot's simulation rules (GDD §4, §5, §6, §7, §9): structures,
 * mana, the permanent squad and spells. These replaced both the original
 * lives-and-elimination model and the v1.0 unit-summoning cards.
 */

import { describe, expect, it } from 'vitest';
import { damageTakenMultiplier, hasEffect, magnitudeOf, moveSpeedMultiplier, removeEffect } from './effects';
import { defaultSquad } from './cards';
import {
  CHARGE_TIME,
  EXECUTE_THRESHOLD,
  HEAL_INTERRUPT_DURATION,
  MANA_MAX,
  MANA_REGEN_INTERVAL,
  MANA_START,
  MATCH_DURATION,
  PLAGUE_TICK_INTERVAL,
  SHIELD_AMOUNT,
  SIM_DT,
  SPELL_CAST_FX_DURATION,
  SPELL_GLOBAL_COOLDOWN,
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

  it('keeps a Core immune while both of its Towers stand', () => {
    const w = new World();
    const core = coreOf(w, TEAM_B);

    w.step(SIM_DT);
    expect(core.invulnerable).toBe(true);

    w.damageStructure(core, 9999);
    expect(core.alive).toBe(true);
    expect(core.health).toBe(core.maxHealth);
  });

  it('exposes the Core once either Tower falls', () => {
    const w = new World();
    const [tower] = towersOf(w, TEAM_B);
    tower.health = 0;
    tower.alive = false;
    w.step(SIM_DT);

    const core = coreOf(w, TEAM_B);
    expect(core.invulnerable).toBe(false);

    w.damageStructure(core, 9999);
    expect(core.alive).toBe(false);
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

  it('scales structure damage by the siege multiplier', () => {
    const w = new World();
    const [tower] = towersOf(w, TEAM_B);
    const before = tower.health;
    const raw = 2;
    w.damageStructure(tower, raw);
    const expected = Math.max(0, before - raw * w.siegeMultiplier());
    expect(tower.health).toBeCloseTo(expected);
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

  /**
   * The card the green deck buys instead of a second Pântano Pegajoso. The
   * swamp is the wide soft zone; the roots are the tight hard lock, and the
   * difference has to survive contact with the sim: a rooted mage is pinned to
   * the floor no matter what haste is on it, and — unlike a stun — it is still
   * awake. Losing the ground is not losing the turn.
   */
  it('roots enemies where they stand without taking their turn away', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.5));

    // Haste first, so the assertion cannot pass by the slow floor alone.
    w.castSpell(TEAM_B, 'blessing', enemy.position);
    expect(moveSpeedMultiplier(enemy)).toBeGreaterThan(1);

    w.castSpell(TEAM_A, 'entangling_roots', enemy.position);

    expect(moveSpeedMultiplier(enemy)).toBe(0.1);
    expect(enemy.stunTimer).toBe(0);
    expect(moveSpeedMultiplier(ally)).toBeGreaterThanOrEqual(1);
  });

  /**
   * Green's answer to Escudo Arcano, and deliberately the worse card to cast
   * late. A shield is worth most the instant before the hit lands; a regen is
   * worth nothing then and everything between fights. The sim has to make that
   * true rather than merely say it, so the healing arrives on a cadence and the
   * overflow is thrown away.
   */
  it('heals an ally on a cadence and stops at full health', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    // Less than the card's whole output (4 ticks x 8), so the last tick has an
    // overflow to throw away and the clamp is actually exercised.
    w.dealDamage(ally, 20);
    const hurt = ally.health;

    w.castSpell(TEAM_A, 'rejuvenating_breeze', ally.position);

    // Gradual, not a lump sum: nothing has arrived before the first interval.
    stepN(w, 2);
    expect(ally.health).toBe(hurt);

    stepN(w, Math.ceil(1 / SIM_DT));
    expect(ally.health).toBeGreaterThan(hurt);
    expect(ally.health).toBeLessThan(ally.maxHealth);

    // Run past the card's duration; the overflow is discarded, not banked.
    stepN(w, Math.ceil(6 / SIM_DT));
    expect(ally.health).toBe(ally.maxHealth);
  });

  /**
   * White's third card, and the one that stacks two slow goods rather than one
   * fast one. Escudo Arcano is a wall that arrives whole and is gone when spent;
   * this pays out over four seconds in two currencies at once, which is why it
   * is the more expensive card and the worse panic button.
   */
  it('consecrates ground under its own line only, healing and bracing at once', () => {
    const w = new World();
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const enemy = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.5));
    w.dealDamage(ally, 30);
    const hurt = ally.health;

    w.castSpell(TEAM_A, 'consecrated_ground', ally.position);

    // Standing well inside the radius, and still not caught: this is a buff.
    expect(magnitudeOf(enemy, 'fortify')).toBe(0);
    expect(damageTakenMultiplier(enemy)).toBe(1);

    expect(damageTakenMultiplier(ally)).toBeLessThan(1);
    stepN(w, Math.ceil(1 / SIM_DT));
    expect(ally.health).toBeGreaterThan(hurt);
  });

  /**
   * The first card that changes what a mage's *own* attacks are worth, rather
   * than what happens to it. Red already had Campo de Sobrecarga making a
   * target softer; this makes a shooter harder, and the two have to be
   * separable — a bug that swapped them would buff whoever you aimed at.
   */
  it('makes an empowered mage hit harder, and leaves the rest of the squad alone', () => {
    const w = new World();
    const frenzied = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    const plainAlly = w.summon(TEAM_A, 'pyromancer', new Vec2(10, 0));
    const target = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));

    w.castSpell(TEAM_A, 'blood_frenzy', frenzied.position);

    target.health = target.maxHealth;
    w.dealDamage(target, 20, { attackerId: frenzied.id });
    const empowered = target.maxHealth - target.health;

    target.health = target.maxHealth;
    w.dealDamage(target, 20, { attackerId: plainAlly.id });
    const plain = target.maxHealth - target.health;

    expect(plain).toBe(20);
    expect(empowered).toBeCloseTo(28, 5);
  });

  /**
   * The first card in the game whose value depends on the situation rather than
   * on the target. Campo de Sobrecarga is worth the same against a full-health
   * mage and a dying one; this is worth nothing against the first and a great
   * deal against the second, which is the whole point — a program that writes
   * `SE vida do inimigo mais ferido ≤ 40% ENTÃO Marca` beats one that fires it
   * on sight, and until now no card rewarded asking.
   */
  it('pays only against a target already below the execute threshold', () => {
    const w = new World();
    const healthy = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));
    const dying = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.5));

    w.castSpell(TEAM_A, 'executioners_mark', healthy.position);
    expect(magnitudeOf(healthy, 'marked')).toBeGreaterThan(0);
    expect(magnitudeOf(dying, 'marked')).toBeGreaterThan(0);

    // Well above the threshold: the mark is inert and the hit is just a hit.
    healthy.health = healthy.maxHealth;
    w.dealDamage(healthy, 10);
    expect(healthy.maxHealth - healthy.health).toBe(10);

    // Under it: the same 10 lands for half again as much.
    dying.health = dying.maxHealth * (EXECUTE_THRESHOLD - 0.05);
    const before = dying.health;
    w.dealDamage(dying, 10);
    expect(before - dying.health).toBeCloseTo(15, 5);
  });

  /**
   * Blue's first card, and the only one in the game that is a bad idea half the
   * time. Petrifying the enemy carry buys silence and pays for it by making that
   * carry unkillable for the same window — so this is the card that punishes a
   * program which fires on sight hardest, because the wrong moment is not merely
   * wasteful, it is a rescue.
   */
  it('turns a mage to stone: it neither acts nor can be hurt, until it wears off', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));

    w.castSpell(TEAM_A, 'petrify', victim.position);
    const full = victim.health;

    w.dealDamage(victim, 40);
    expect(victim.health).toBe(full);
    expect(moveSpeedMultiplier(victim)).toBe(0.1);

    // `state` is assigned in updateMage, so it takes a tick to show.
    w.step(SIM_DT);
    expect(victim.state).toBe('petrified');

    // Past the duration the stone is gone and so is the protection.
    stepN(w, Math.ceil(3 / SIM_DT));
    w.dealDamage(victim, 40);
    expect(victim.health).toBeLessThan(full);
  });

  /**
   * The reach of Petrificar, and the reason it is worth four mana.
   *
   * A squad that is entirely stone has no one left to channel through, so the
   * player it belongs to cannot cast at all until someone cracks. That is the
   * only hard lock in the game — nothing else stops a program from firing — and
   * it is reachable exactly when the enemy has bunched up inside one area
   * spell, which is the situation the card is asking you to wait for.
   *
   * Guarded on *living* mages: a team wiped to the last man is not petrified,
   * it is dead, and blocking its casts would turn a lost fight into an
   * unrecoverable one for a reason nobody could see.
   */
  it('locks a team out of casting only while its whole living squad is stone', () => {
    const w = new World();
    const a = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));
    const b = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0.6));
    w.summon(TEAM_A, 'pyromancer', new Vec2(10, 0));

    expect(w.castSpell(TEAM_B, 'blessing', a.position)).toEqual({ ok: true });
    stepN(w, Math.ceil(SPELL_GLOBAL_COOLDOWN / SIM_DT) + 2);

    // One area cast catching both of them is what buys the lock.
    w.castSpell(TEAM_A, 'petrify', a.position);
    expect(hasEffect(a, 'petrify')).toBe(true);
    expect(hasEffect(b, 'petrify')).toBe(true);

    expect(w.castSpell(TEAM_B, 'blessing', a.position)).toEqual({
      ok: false,
      reason: 'squad_petrified',
    });

    // One of them cracking is enough to get the program running again.
    removeEffect(b, 'petrify');
    expect(w.castSpell(TEAM_B, 'blessing', b.position)).toEqual({ ok: true });
  });

  it('never locks a team that simply has no one standing', () => {
    const w = new World();
    // No squad at all: vacuously "all petrified" is the trap this guards.
    expect(w.castSpell(TEAM_A, 'blessing', Vec2.zero)).toEqual({ ok: true });
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

/*
 * The global cooldown exists because the caster is about to stop being a pair
 * of human hands. A Tactician runs inside the 60 Hz tick, so a full mana bank
 * spent on 2-cost cards is five casts in five consecutive ticks — something no
 * player could ever do through the HUD. Rate-limiting inside the Tactician
 * would not do: this is the one seam every caster goes through (submitCast,
 * Commander, Tactician, and every headless harness), so it is the only place
 * the limit cannot be bypassed.
 */
describe('spells — the global cast cooldown', () => {
  it('refuses a second cast from the same team inside the cooldown', () => {
    const w = new World();
    expect(w.castSpell(TEAM_A, 'blessing', Vec2.zero)).toEqual({ ok: true });

    expect(w.castSpell(TEAM_A, 'blessing', Vec2.zero)).toEqual({
      ok: false,
      reason: 'on_cooldown',
    });
  });

  it('allows the next cast once the cooldown has run out', () => {
    const w = new World();
    w.castSpell(TEAM_A, 'blessing', Vec2.zero);
    stepN(w, Math.ceil(SPELL_GLOBAL_COOLDOWN / SIM_DT) + 1);

    expect(w.castSpell(TEAM_A, 'blessing', Vec2.zero)).toEqual({ ok: true });
  });

  it('is per team — one side casting does not lock the other out', () => {
    const w = new World();
    w.castSpell(TEAM_A, 'blessing', Vec2.zero);

    expect(w.castSpell(TEAM_B, 'blessing', Vec2.zero)).toEqual({ ok: true });
  });

  it('does not start on a rejected cast', () => {
    const w = new World();
    // A misnamed card must not cost the team its next cast window.
    w.castSpell(TEAM_A, 'fireball_of_doom', Vec2.zero);

    expect(w.castSpell(TEAM_A, 'blessing', Vec2.zero)).toEqual({ ok: true });
  });

  it('reports what is wrong with the request before it reports timing', () => {
    const w = new World();
    // Plague costs 4 of the opening 5, so the second cast is both broke and
    // on cooldown. "Not enough mana" is the one the caster can act on, and it
    // is what the pre-cooldown behaviour reported.
    w.castSpell(TEAM_A, 'plague', Vec2.zero);

    expect(w.castSpell(TEAM_A, 'slow_curse', Vec2.zero)).toEqual({
      ok: false,
      reason: 'not_enough_mana',
    });
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

  /**
   * The counterplay a continuous 8 HP/s aura had none of (GDD §9): a hit heavy
   * enough to shove the Cleric cuts the healing. *Momentarily* is the whole
   * point — the heal has to come back on its own, or a single wind blade would
   * take the Cleric out of the fight for good.
   */
  it('cuts the Cleric’s heal while it is being shoved, then lets it resume', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    hurt.health = 20;
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 1.6));
    const dervish = w.summon(TEAM_B, 'wind_dervish', new Vec2(-4, 1.6));

    fullyChargeAndRelease(w, dervish.id, cleric.position);
    for (let i = 0; i < 120 && cleric.healInterruptTimer === 0; i++) w.step(SIM_DT);
    expect(cleric.healInterruptTimer, 'the blade has to land').toBeGreaterThan(0);

    const shoved = hurt.health;
    stepN(w, Math.floor(HEAL_INTERRUPT_DURATION / 2 / SIM_DT));
    expect(hurt.health, 'no healing while the Cleric is off balance').toBe(shoved);

    stepN(w, Math.ceil(HEAL_INTERRUPT_DURATION / SIM_DT));
    expect(hurt.health, 'the heal returns by itself').toBeGreaterThan(shoved);
  });

  /**
   * Only the heavy hits qualify (`HEAL_INTERRUPT_KNOCKBACK`). Chip damage must
   * not shut a Cleric down, or the interrupt stops being a shove and becomes a
   * silence anybody can apply.
   */
  it('keeps healing through a hit too light to shove it', () => {
    const w = new World();
    const hurt = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
    hurt.health = 20;
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 1.6));
    const stormcaller = w.summon(TEAM_B, 'stormcaller', new Vec2(-4, 1.6));

    fullyChargeAndRelease(w, stormcaller.id, cleric.position);
    for (let i = 0; i < 120 && cleric.health === cleric.maxHealth; i++) w.step(SIM_DT);
    expect(cleric.health, 'the bolt has to land').toBeLessThan(cleric.maxHealth);

    const hit = hurt.health;
    stepN(w, 20);
    expect(cleric.healInterruptTimer).toBe(0);
    expect(hurt.health).toBeGreaterThan(hit);
  });
});
