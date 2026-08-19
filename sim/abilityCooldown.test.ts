/**
 * The recharge economy that replaced the mana bar (plano v1.3 §3.3).
 *
 * Team mana was one number that everything drank from; a kit is four bodies
 * each holding their own charges. That swap moved three levers, and this file
 * is where each one is pinned down:
 *
 * - **Charges belong to a body's clock.** A mage that cannot act is a mage
 *   whose kit is not coming back, which is what makes killing one — or turning
 *   one to stone — worth more than the seconds it buys.
 * - **Sudden death is the same dial it always was**, pointed at the new
 *   resource: `SUDDEN_DEATH_MANA_MULTIPLIER` became
 *   `SUDDEN_DEATH_COOLDOWN_MULTIPLIER`.
 * - **Fluxo de Mana and Tributo Obscuro still buy tempo**, now out of recharge
 *   instead of out of the bar — one for the side, one for the body.
 */

import { describe, expect, it } from 'vitest';
import { applyEffect } from './effects';
import { TEAM_A, TEAM_B, type Mage } from './entities';
import { SUDDEN_DEATH_COOLDOWN_MULTIPLIER } from './config';
import { Vec2 } from './Vec2';
import { World } from './World';

const SPELL = 'blessing';

/** A Cleric that has just spent Bênção, and the world it stands in. */
function afterCast(): { w: World; cleric: Mage; spent: number } {
  const w = new World();
  const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
  expect(w.castAbility(cleric.id, SPELL, cleric.position).ok).toBe(true);
  return { w, cleric, spent: w.abilityCooldownOf(cleric.id, SPELL) };
}

describe('ability cooldown — whose clock it runs on', () => {
  it('brings a charge back one second per second of ordinary time', () => {
    const { w, cleric, spent } = afterCast();

    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(spent - 1, 5);
  });

  /**
   * Stone is silence: §3.3 puts a petrified mage on the same footing as a dead
   * one. Without this, the counter-play to being turned to stone would be to
   * come back with a full kit.
   */
  it('freezes a charge while its owner is stone', () => {
    const { w, cleric, spent } = afterCast();
    applyEffect(cleric, { kind: 'petrify', magnitude: 1, duration: 5 });

    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBe(spent);
  });

  /**
   * And the line on the other side of it: being knocked about is not being
   * silenced. A squad that lost its recharge every time somebody shoved it
   * would never cast at all.
   */
  it('keeps a charge coming back through a stun', () => {
    const { w, cleric, spent } = afterCast();
    cleric.stunTimer = 5;

    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(spent - 1, 5);
  });
});

describe('ability cooldown — sudden death', () => {
  it('brings every charge back faster once normal time runs out', () => {
    const { w, cleric, spent } = afterCast();
    w.suddenDeath = true;

    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(
      spent - SUDDEN_DEATH_COOLDOWN_MULTIPLIER,
      5,
    );
  });
});

describe('ability cooldown — Fluxo de Mana, re-pointed', () => {
  it('raises a side’s recharge for as long as it lasts', () => {
    const { w, cleric, spent } = afterCast();
    w.attuneCharge(TEAM_A, 2, 10);

    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(spent - 2, 5);
  });

  it('buys the side that paid for it and nobody else', () => {
    const w = new World();
    const mine = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const theirs = w.summon(TEAM_B, 'cleric', new Vec2(10, 0));
    expect(w.castAbility(mine.id, SPELL, mine.position).ok).toBe(true);
    expect(w.castAbility(theirs.id, SPELL, theirs.position).ok).toBe(true);
    const spent = w.abilityCooldownOf(mine.id, SPELL);

    w.attuneCharge(TEAM_A, 2, 10);
    w.step(1);

    expect(w.abilityCooldownOf(mine.id, SPELL)).toBeCloseTo(spent - 2, 5);
    expect(w.abilityCooldownOf(theirs.id, SPELL)).toBeCloseTo(spent - 1, 5);
  });

  it('drops back to ordinary time when the flow runs out', () => {
    const { w, cleric } = afterCast();
    w.attuneCharge(TEAM_A, 2, 1);

    w.step(1);
    const afterFlow = w.abilityCooldownOf(cleric.id, SPELL);
    w.step(1);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(afterFlow - 1, 5);
  });
});

describe('ability cooldown — Tributo Obscuro, re-pointed', () => {
  it('hands one mage seconds back off every charge it is waiting on', () => {
    const { w, cleric, spent } = afterCast();

    w.refundCharge(cleric.id, 3);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBeCloseTo(spent - 3, 5);
  });

  it('never pushes a charge below ready', () => {
    const { w, cleric, spent } = afterCast();

    w.refundCharge(cleric.id, spent + 100);

    expect(w.abilityCooldownOf(cleric.id, SPELL)).toBe(0);
  });

  it('pays the body that bled for it, not its squad', () => {
    const w = new World();
    const payer = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const bystander = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    expect(w.castAbility(payer.id, SPELL, payer.position).ok).toBe(true);
    expect(w.castAbility(bystander.id, 'arcane_shield', bystander.position).ok).toBe(true);
    const untouched = w.abilityCooldownOf(bystander.id, 'arcane_shield');

    w.refundCharge(payer.id, 3);

    expect(w.abilityCooldownOf(bystander.id, 'arcane_shield')).toBe(untouched);
  });
});
