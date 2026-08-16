/**
 * The tuning file is data, so nothing stops a typo there from silently
 * disabling an element's whole behaviour — a misspelled `"effect": "brun"`
 * type-checks fine and just never fires. These tests are what turns that into
 * a red build.
 */

import { describe, expect, it } from 'vitest';
import { BALANCE, type OnHitRule } from './balance';
import { ALL_ROSTER, isRosterId } from './cards';
import { ALL_ELEMENTS, isElementId } from './elements';
import { ALL_ROLES, isRole } from './roles';
import { ALL_SPELLS, isSpellId } from './spells';

/** Status kinds `effects.ts` resolves, plus the instant riders the applier handles. */
const KNOWN_EFFECTS = new Set([
  'slow',
  'haste',
  'cast_slow',
  'cast_haste',
  'burn',
  'vulnerable',
  'shield',
  'stun',
  'root',
  'regen',
  'interrupt',
  'shield_break',
  'puddle',
]);

/** Riders that carry a status effect, so they must declare how long it lasts. */
const TIMED_EFFECTS = new Set(['slow', 'haste', 'cast_slow', 'cast_haste', 'burn', 'vulnerable', 'stun']);

describe('balance.json', () => {
  it('covers every catalog id, and only real ones', () => {
    expect(Object.keys(BALANCE.elements).sort()).toEqual([...ALL_ELEMENTS].sort());
    expect(Object.keys(BALANCE.roster).sort()).toEqual([...ALL_ROSTER].sort());
    expect(Object.keys(BALANCE.roles).sort()).toEqual([...ALL_ROLES].sort());
    expect(Object.keys(BALANCE.spells).sort()).toEqual([...ALL_SPELLS].sort());

    for (const id of Object.keys(BALANCE.elements)) expect(isElementId(id), id).toBe(true);
    for (const id of Object.keys(BALANCE.roster)) expect(isRosterId(id), id).toBe(true);
    for (const id of Object.keys(BALANCE.roles)) expect(isRole(id), id).toBe(true);
    for (const id of Object.keys(BALANCE.spells)) expect(isSpellId(id), id).toBe(true);
  });

  it('points every roster entry at a real element and role', () => {
    for (const [id, entry] of Object.entries(BALANCE.roster)) {
      expect(isElementId(entry.element), `${id} element`).toBe(true);
      expect(isRole(entry.role), `${id} role`).toBe(true);
      expect(entry.health, `${id} health`).toBeGreaterThan(0);
      expect(entry.moveSpeed, `${id} moveSpeed`).toBeGreaterThan(0);
    }
  });

  it('names only effects the sim knows how to apply', () => {
    for (const [id, element] of Object.entries(BALANCE.elements)) {
      for (const rule of element.onHit ?? []) {
        expect(KNOWN_EFFECTS.has(rule.effect), `${id} -> ${rule.effect}`).toBe(true);
      }
    }
    for (const kind of Object.keys(BALANCE.effects)) {
      expect(KNOWN_EFFECTS.has(kind), kind).toBe(true);
    }
  });

  /**
   * A duration of 0 is the quiet failure mode: the effect is applied and
   * expires on the same tick, so the element looks broken rather than
   * misconfigured.
   */
  it('gives every timed rider a positive duration, and every DoT a tick', () => {
    const rules: [string, OnHitRule][] = Object.entries(BALANCE.elements).flatMap(([id, e]) =>
      (e.onHit ?? []).map((r) => [id, r] as [string, OnHitRule]),
    );

    for (const [id, rule] of rules) {
      const label = `${id} -> ${rule.effect}`;
      if (TIMED_EFFECTS.has(rule.effect) || rule.effect === 'puddle') {
        expect(rule.duration ?? 0, `${label} duration`).toBeGreaterThan(0);
      }
      if (rule.tickDamage !== undefined) {
        expect(rule.tickInterval ?? 0, `${label} tickInterval`).toBeGreaterThan(0);
        expect(rule.tickDamage, `${label} tickDamage`).toBeGreaterThan(0);
      }
      if (rule.trigger) {
        expect(rule.trigger.hits, `${label} trigger.hits`).toBeGreaterThan(1);
        expect(rule.trigger.window, `${label} trigger.window`).toBeGreaterThan(0);
      }
      if (rule.effect === 'puddle') expect(rule.radius ?? 0, `${label} radius`).toBeGreaterThan(0);
    }
  });

  /**
   * The failure this caught: lightning's stun wanted 3 hits inside 2.5s, but a
   * mage cannot fire faster than `throwCooldown + chargeTime` (2.1s) plus the
   * flight, so a lone Stormcaller's streak expired between every shot and the
   * stun was simply unreachable. Nothing failed — the effect just never
   * happened, which is the worst kind of balance bug to find by playing.
   *
   * The bar is one full shot cycle with room to spare: a triggered rider has to
   * be earnable by *one* mage working a target, not only by two of them.
   */
  it('gives every streak rider a window a single mage can actually chain', () => {
    const cadence = BALANCE.sim.throwCooldown + BALANCE.sim.chargeTime;

    for (const [id, element] of Object.entries(BALANCE.elements)) {
      for (const rule of element.onHit ?? []) {
        if (!rule.trigger) continue;
        expect(rule.trigger.window, `${id} -> ${rule.effect} window vs ${cadence}s cadence`).toBeGreaterThan(
          cadence * 1.2,
        );
      }
    }
  });

  it('declares a stacking rule for every status kind a rider can apply', () => {
    for (const element of Object.values(BALANCE.elements)) {
      for (const rule of element.onHit ?? []) {
        if (!TIMED_EFFECTS.has(rule.effect)) continue;
        expect(BALANCE.effects[rule.effect], rule.effect).toBeDefined();
      }
    }
    for (const [kind, rule] of Object.entries(BALANCE.effects)) {
      expect(rule.maxMagnitude, `${kind} maxMagnitude`).toBeGreaterThan(0);
      if (rule.stacking === 'stack_intensity') {
        expect(rule.maxStacks ?? 0, `${kind} maxStacks`).toBeGreaterThan(1);
      }
    }
  });
});
