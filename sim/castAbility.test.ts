/**
 * Permission to cast, now that it belongs to a body (plano v1.3 §3.3, §7.1).
 *
 * Until v1.3 a spell was spent by a *team*: `castSpell(team, …)` checked a
 * shared mana bar and a shared cooldown, and any card could go off as long as
 * the side could pay. That is the model the pivot replaces. A spell is now
 * carried by one mage, and every reason it might not go off is a fact about
 * that mage — it is dead, it is stone, it does not own this skill, the skill is
 * still recharging, or the point is further than its arm reaches.
 *
 * The consequence the design is actually buying is the last test here: four
 * mages are four independent budgets, so a squad can act at once. The old model
 * was a queue of four sharing one bar, and the plan is explicit that inverting
 * that is the point rather than a side effect.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { World } from './World';
import { Vec2 } from './Vec2';
import { TEAM_A, TEAM_B, type Mage, type Team } from './entities';
import { applyEffect } from './effects';
import { defaultArena } from './defaultMap';
import { abilityPolicyFor } from './abilityPolicy';
import { rosterFor } from './cards';

const ORIGIN = new Vec2(0, 0);

function world(): World {
  return new World(defaultArena());
}

/** A Pyromancer at the origin — three abilities, none of them shared. */
function pyromancer(w: World, team: Team = TEAM_A): Mage {
  return w.summon(team, 'pyromancer', ORIGIN);
}

describe('castAbility — the body is the permission', () => {
  let w: World;
  let mage: Mage;

  beforeEach(() => {
    w = world();
    mage = pyromancer(w);
  });

  it('lets a mage spend a spell from its own kit', () => {
    const [first] = rosterFor('pyromancer')!.abilities;
    expect(w.castAbility(mage.id, first, ORIGIN)).toEqual({ ok: true });
  });

  it('refuses a spell the mage does not carry', () => {
    // Praga belongs to the Alchemist. Nothing about the Pyromancer's mana,
    // position or cooldowns should be what stops it.
    expect(w.castAbility(mage.id, 'plague', ORIGIN)).toEqual({
      ok: false,
      reason: 'not_owner',
    });
  });

  it('refuses a mage nobody summoned', () => {
    expect(w.castAbility('mage-nobody', 'volcanic_eruption', ORIGIN)).toEqual({
      ok: false,
      reason: 'unknown_mage',
    });
  });

  it('refuses a spell that is not in the catalog', () => {
    expect(w.castAbility(mage.id, 'cosmic_ray', ORIGIN)).toEqual({
      ok: false,
      reason: 'unknown_card',
    });
  });

  /**
   * The single most load-bearing rule of the pivot (§2): a dead mage takes its
   * abilities off the board. It is what makes composition cost something and
   * what makes a death expensive beyond the six seconds.
   */
  it('takes the kit off the board while its owner is down', () => {
    const [first] = rosterFor('pyromancer')!.abilities;
    w.dealDamage(mage, mage.maxHealth + 1, {});
    expect(mage.alive).toBe(false);
    expect(w.castAbility(mage.id, first, ORIGIN)).toEqual({
      ok: false,
      reason: 'mage_dead',
    });
  });

  it('refuses a point beyond the mage’s reach', () => {
    const [first] = rosterFor('pyromancer')!.abilities;
    const reach = abilityPolicyFor(first)!.range;
    const tooFar = new Vec2(reach + 1, 0);
    expect(w.castAbility(mage.id, first, tooFar)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    // And the same point from a mage standing next to it is fine, so the
    // rejection is about distance rather than about the spot.
    const closer = w.summon(TEAM_A, 'pyromancer', new Vec2(reach, 0));
    expect(w.castAbility(closer.id, first, tooFar)).toEqual({ ok: true });
  });

  it('refuses a point outside the arena', () => {
    const [first] = rosterFor('pyromancer')!.abilities;
    const outside = new Vec2(10_000, 0);
    expect(w.castAbility(mage.id, first, outside)).toEqual({
      ok: false,
      reason: 'out_of_bounds',
    });
  });
});

describe('castAbility — charge lives on the mage', () => {
  it('puts the ability, and only that ability, on cooldown', () => {
    const w = world();
    const mage = pyromancer(w);
    const [first, second] = rosterFor('pyromancer')!.abilities;

    expect(w.castAbility(mage.id, first, ORIGIN).ok).toBe(true);
    expect(w.castAbility(mage.id, first, ORIGIN)).toEqual({
      ok: false,
      reason: 'ability_on_cooldown',
    });

    // The sibling is only held by the short per-mage GCD, not by the first
    // ability's much longer recharge — step past the GCD and it goes off.
    w.step(1);
    expect(w.castAbility(mage.id, second, ORIGIN).ok).toBe(true);
  });

  it('makes a mage wait a beat between two of its own abilities', () => {
    const w = world();
    const mage = pyromancer(w);
    const [first, second] = rosterFor('pyromancer')!.abilities;

    expect(w.castAbility(mage.id, first, ORIGIN).ok).toBe(true);
    expect(w.castAbility(mage.id, second, ORIGIN)).toEqual({
      ok: false,
      reason: 'on_gcd',
    });
  });

  it('brings an ability back after its own cooldown, and not before', () => {
    const w = world();
    const mage = pyromancer(w);
    const [first] = rosterFor('pyromancer')!.abilities;
    const cooldown = abilityPolicyFor(first)!.cooldown;

    expect(w.castAbility(mage.id, first, ORIGIN).ok).toBe(true);
    for (let t = 0; t < cooldown - 0.5; t += 0.5) w.step(0.5);
    expect(w.castAbility(mage.id, first, ORIGIN).ok).toBe(false);
    w.step(1);
    expect(w.castAbility(mage.id, first, ORIGIN)).toEqual({ ok: true });
  });

  /**
   * §3.3: "as cargas daquele mago não andam e não disparam". A kit that kept
   * recharging through a death would make dying cheaper the longer you stayed
   * down, which is the opposite of what the respawn timer is for.
   */
  it('freezes the charge while its owner is dead', () => {
    const w = world();
    const mage = pyromancer(w);
    const [first] = rosterFor('pyromancer')!.abilities;
    const cooldown = abilityPolicyFor(first)!.cooldown;

    expect(w.castAbility(mage.id, first, ORIGIN).ok).toBe(true);
    const afterCast = w.abilityCooldownOf(mage.id, first);

    w.dealDamage(mage, mage.maxHealth + 1, {});
    w.step(1);
    expect(w.abilityCooldownOf(mage.id, first)).toBe(afterCast);

    // And it is still holding the same charge a full cooldown later.
    for (let t = 0; t < cooldown; t += 0.5) w.step(0.5);
    expect(w.abilityCooldownOf(mage.id, first)).toBeGreaterThan(0);
  });

  /**
   * The inversion the plan calls "o oposto do modelo CR" (§3.3): the team is
   * the budget, not a queue of four sharing one bar.
   */
  it('lets four mages of one squad act in the same second', () => {
    const w = world();
    w.initSquad(TEAM_A, ['stone_golem', 'pyromancer', 'stormcaller', 'cleric']);

    const fired = [...w.mages.values()]
      .filter((m) => m.team === TEAM_A)
      .map((m) => w.castAbility(m.id, rosterFor(m.rosterId!)!.abilities[0], m.position));

    expect(fired).toHaveLength(4);
    expect(fired.every((r) => r.ok)).toBe(true);
  });

  it('keeps one mage’s cooldowns to itself', () => {
    const w = world();
    const a = pyromancer(w, TEAM_A);
    const b = pyromancer(w, TEAM_B);
    const [first] = rosterFor('pyromancer')!.abilities;

    expect(w.castAbility(a.id, first, a.position).ok).toBe(true);
    expect(w.castAbility(b.id, first, b.position)).toEqual({ ok: true });
  });
});

describe('castAbility — stone silences the body, not the side', () => {
  it('refuses a petrified mage but lets its squadmate cast', () => {
    const w = world();
    const stoned = pyromancer(w, TEAM_A);
    const free = w.summon(TEAM_A, 'cleric', new Vec2(2, 0));
    const [pyro] = rosterFor('pyromancer')!.abilities;
    const [cleric] = rosterFor('cleric')!.abilities;

    applyEffect(stoned, { kind: 'petrify', magnitude: 1, duration: 3 });

    expect(w.castAbility(stoned.id, pyro, ORIGIN)).toEqual({
      ok: false,
      reason: 'mage_petrified',
    });
    expect(w.castAbility(free.id, cleric, free.position)).toEqual({ ok: true });
  });
});
