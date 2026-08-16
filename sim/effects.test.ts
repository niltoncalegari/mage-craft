/**
 * The stacking rules are the part of the effect system a designer edits by
 * changing one word in `balance.json`, and the part whose bugs are invisible
 * in play — a slow that quietly got weaker just feels like the game being
 * inconsistent. These pin each rule to a number.
 */

import { describe, expect, it } from 'vitest';
import {
  absorbWithShield,
  applyEffect,
  chargeRateMultiplier,
  clearEffects,
  damageTakenMultiplier,
  effectOf,
  EFFECT_ORDER,
  hasEffect,
  isEffectKind,
  magnitudeOf,
  moveSpeedMultiplier,
  removeEffect,
  tickEffects,
  type EffectCarrier,
} from './effects';

function carrier(): EffectCarrier {
  return { effects: [] };
}

describe('effects — stacking', () => {
  /**
   * The bug this replaced: `applyProjectileHit` assigned the slow outright, so
   * a Bard's 0.15 graze landing on a target the Ice Sentinel had just slowed
   * to 0.35 *sped the target back up*. It read as the Bard cleansing the enemy.
   */
  it('never lets a weaker slow dilute a stronger one', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.35, duration: 1.25 });
    applyEffect(m, { kind: 'slow', magnitude: 0.15, duration: 0.6 });

    expect(magnitudeOf(m, 'slow')).toBe(0.35);
    expect(effectOf(m, 'slow')?.remaining).toBe(1.25);
  });

  it('lets a weaker application extend a stronger one', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.35, duration: 0.5 });
    applyEffect(m, { kind: 'slow', magnitude: 0.15, duration: 4 });

    expect(magnitudeOf(m, 'slow')).toBe(0.35);
    expect(effectOf(m, 'slow')?.remaining).toBe(4);
  });

  it('stacks burn up to the catalog cap and refreshes its duration', () => {
    const m = carrier();
    for (let i = 0; i < 10; i++) {
      applyEffect(m, { kind: 'burn', duration: 4, tickInterval: 0.5, tickDamage: 4 });
    }
    // balance.json caps burn at 3 stacks; 10 hits must not mean 10x damage.
    expect(effectOf(m, 'burn')?.stacks).toBe(3);
    expect(effectOf(m, 'burn')?.remaining).toBe(4);
  });

  it('keeps the bigger shield pool rather than adding two', () => {
    const m = carrier();
    applyEffect(m, { kind: 'shield', magnitude: 60, duration: 6 });
    applyEffect(m, { kind: 'shield', magnitude: 20, duration: 6 });

    expect(magnitudeOf(m, 'shield')).toBe(60);
  });

  it('clamps a magnitude to the catalog ceiling', () => {
    const m = carrier();
    // Nothing in balance.json is this strong; a future spell might be.
    applyEffect(m, { kind: 'slow', magnitude: 5, duration: 1 });
    expect(magnitudeOf(m, 'slow')).toBeLessThanOrEqual(1);
  });

  /**
   * The list is what the wire serialises, so two worlds that applied the same
   * effects in a different order have to produce byte-identical snapshots.
   */
  it('keeps the list in EFFECT_ORDER regardless of arrival order', () => {
    const a = carrier();
    applyEffect(a, { kind: 'vulnerable', magnitude: 0.25, duration: 4 });
    applyEffect(a, { kind: 'slow', magnitude: 0.35, duration: 1 });
    applyEffect(a, { kind: 'stun', duration: 0.9 });

    const b = carrier();
    applyEffect(b, { kind: 'stun', duration: 0.9 });
    applyEffect(b, { kind: 'vulnerable', magnitude: 0.25, duration: 4 });
    applyEffect(b, { kind: 'slow', magnitude: 0.35, duration: 1 });

    const kinds = (c: EffectCarrier): string[] => c.effects.map((e) => e.kind);
    expect(kinds(a)).toEqual(kinds(b));
    expect(kinds(a)).toEqual(['stun', 'slow', 'vulnerable']);
  });
});

describe('effects — ticking', () => {
  it('drops an effect the moment it runs out, with no float residue', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.35, duration: 0.5 });

    // 29 ticks is 0.483s — still inside the window.
    for (let i = 0; i < 29; i++) tickEffects(m, 1 / 60);
    expect(hasEffect(m, 'slow')).toBe(true);

    // The 30th completes the half second exactly, and it goes.
    tickEffects(m, 1 / 60);
    expect(hasEffect(m, 'slow')).toBe(false);
    expect(m.effects).toHaveLength(0);
  });

  it('yields a DoT tick every interval, scaled by stacks', () => {
    const m = carrier();
    applyEffect(m, { kind: 'burn', duration: 4, tickInterval: 0.5, tickDamage: 4 });
    applyEffect(m, { kind: 'burn', duration: 4, tickInterval: 0.5, tickDamage: 4 });

    let total = 0;
    let ticks = 0;
    for (let i = 0; i < 60 * 4; i++) {
      for (const t of tickEffects(m, 1 / 60) ?? []) {
        total += t.damage;
        ticks++;
      }
    }
    // Two stacks x 4 damage, eight times across a four-second burn.
    expect(ticks).toBe(8);
    expect(total).toBeCloseTo(8 * 8, 5);
  });

  it('returns null rather than an empty array when nothing is running', () => {
    expect(tickEffects(carrier(), 1 / 60)).toBeNull();
  });

  /**
   * Healing over time rides the same cadence machinery as a burn, on its own
   * channel rather than as negative damage. A signed `damage` would have to be
   * threaded correctly through the shield, the vulnerability multiplier and
   * kill credit — three places where "damage below zero" is a silent absurdity
   * — so the tick says which of the two it is and the world reads the one it
   * asked for.
   */
  it('yields heal ticks on their own channel, on the same cadence as a DoT', () => {
    const m = carrier();
    applyEffect(m, { kind: 'regen', duration: 3, tickInterval: 1, tickHeal: 6 });

    let healed = 0;
    let ticks = 0;
    for (let i = 0; i < 60 * 3; i++) {
      for (const t of tickEffects(m, 1 / 60) ?? []) {
        expect(t.damage).toBe(0);
        healed += t.heal;
        ticks++;
      }
    }
    expect(ticks).toBe(3);
    expect(healed).toBeCloseTo(18, 5);
  });

  it('keeps damage and heal on separate channels, so a burn never heals', () => {
    const m = carrier();
    applyEffect(m, { kind: 'burn', duration: 1, tickInterval: 0.5, tickDamage: 4 });

    const due = tickEffects(m, 0.5)!;
    expect(due).toHaveLength(1);
    expect(due[0].damage).toBe(4);
    expect(due[0].heal).toBe(0);
  });

  it('credits the DoT source so a burn can earn a kill', () => {
    const m = carrier();
    applyEffect(m, { kind: 'burn', duration: 1, tickInterval: 0.5, tickDamage: 4, sourceId: 'mage-3' });
    let seen: string | null = null;
    for (let i = 0; i < 60; i++) {
      for (const t of tickEffects(m, 1 / 60) ?? []) seen = t.sourceId;
    }
    expect(seen).toBe('mage-3');
  });
});

describe('effects — derived stats', () => {
  it('multiplies slow and haste rather than letting either win outright', () => {
    const m = carrier();
    expect(moveSpeedMultiplier(m)).toBe(1);

    applyEffect(m, { kind: 'slow', magnitude: 0.5, duration: 1 });
    expect(moveSpeedMultiplier(m)).toBeCloseTo(0.5, 5);

    applyEffect(m, { kind: 'haste', magnitude: 0.4, duration: 1 });
    expect(moveSpeedMultiplier(m)).toBeCloseTo(0.7, 5);
  });

  /**
   * Rooting is its own kind, and it is visible. A pile of slows must never
   * quietly achieve the same thing.
   */
  it('floors move speed at a tenth however deep the slow goes', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.99, duration: 1 });
    expect(moveSpeedMultiplier(m)).toBeGreaterThanOrEqual(0.1);
  });

  /**
   * What Raízes Entrelaçadas buys over Pântano Pegajoso. The floor above is a
   * floor on a *product*, so a hasted target walks out of the deepest slow in
   * the game at a quarter speed; root is an assignment, and haste does not
   * argue with it. Kept distinct from `stun` because a rooted mage still
   * shoots and still casts — it loses the ground, not the turn.
   */
  it('pins move speed to a tenth when rooted, however much haste is running', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.8, duration: 1 });
    applyEffect(m, { kind: 'haste', magnitude: 1.5, duration: 1 });
    // Slow at its cap plus haste at its cap: the floor alone cannot hold this.
    expect(moveSpeedMultiplier(m)).toBeGreaterThan(0.1);

    applyEffect(m, { kind: 'root', magnitude: 1, duration: 1 });
    expect(moveSpeedMultiplier(m)).toBe(0.1);
  });

  it('takes the stronger of the aura and the cast buff, and never adds them', () => {
    const m = carrier();
    applyEffect(m, { kind: 'cast_haste', magnitude: 0.25, duration: 1 });
    // A Bard's aura of the same size must not double it (GDD §9's "não soma").
    expect(chargeRateMultiplier(m, 0.25)).toBeCloseTo(1.25, 5);
    expect(chargeRateMultiplier(m, 0.5)).toBeCloseTo(1.5, 5);
  });

  it('drags charge rate down under dissonance, with a floor', () => {
    const m = carrier();
    applyEffect(m, { kind: 'cast_slow', magnitude: 0.3, duration: 2.5 });
    expect(chargeRateMultiplier(m)).toBeCloseTo(0.7, 5);

    applyEffect(m, { kind: 'cast_slow', magnitude: 0.75, duration: 2.5 });
    expect(chargeRateMultiplier(m)).toBeGreaterThanOrEqual(0.25);
  });

  it('amplifies incoming damage while vulnerable', () => {
    const m = carrier();
    expect(damageTakenMultiplier(m)).toBe(1);
    applyEffect(m, { kind: 'vulnerable', magnitude: 0.25, duration: 4 });
    expect(damageTakenMultiplier(m)).toBeCloseTo(1.25, 5);
  });

  it('drains the shield pool and drops it once empty', () => {
    const m = carrier();
    applyEffect(m, { kind: 'shield', magnitude: 60, duration: 6 });

    expect(absorbWithShield(m, 20)).toBe(0);
    expect(magnitudeOf(m, 'shield')).toBe(40);

    // The overflow passes through, and the spent shield stops being reported.
    expect(absorbWithShield(m, 50)).toBe(10);
    expect(hasEffect(m, 'shield')).toBe(false);
  });
});

describe('effects — housekeeping', () => {
  it('recognises exactly the kinds in EFFECT_ORDER', () => {
    for (const kind of EFFECT_ORDER) expect(isEffectKind(kind)).toBe(true);
    expect(isEffectKind('interrupt')).toBe(false);
    expect(isEffectKind('')).toBe(false);
  });

  it('removes one effect and clears them all', () => {
    const m = carrier();
    applyEffect(m, { kind: 'slow', magnitude: 0.3, duration: 1 });
    applyEffect(m, { kind: 'burn', duration: 4, tickInterval: 0.5, tickDamage: 4 });

    removeEffect(m, 'slow');
    expect(hasEffect(m, 'slow')).toBe(false);
    expect(hasEffect(m, 'burn')).toBe(true);

    clearEffects(m);
    expect(m.effects).toHaveLength(0);
  });
});
