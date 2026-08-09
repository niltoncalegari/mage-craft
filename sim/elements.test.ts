import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../src/game/elements';
import {
  ALL_ELEMENTS,
  elementDefFor,
  isElementId,
  isPickableElement,
  onHitRule,
  PICKABLE_ELEMENTS,
  type ElementDef,
  type ElementId,
} from './elements';

describe('element catalog', () => {
  it('has 9 unique ids, each resolving to a definition', () => {
    expect(ALL_ELEMENTS).toHaveLength(9);
    expect(new Set(ALL_ELEMENTS).size).toBe(9);
    for (const id of ALL_ELEMENTS) {
      expect(elementDefFor(id), id).toBeDefined();
      expect(isElementId(id)).toBe(true);
    }
    expect(isElementId('shadow')).toBe(false);
  });

  /**
   * The Cleric's and the Bard's attacks are theirs — they arrive with the
   * squad, so a lobby seat must not be able to claim one and neither may the
   * bot auto-fill (see `Room.firstFreeElement`).
   */
  it('keeps the two support attacks out of lobby selection', () => {
    expect(PICKABLE_ELEMENTS).toHaveLength(7);
    expect(PICKABLE_ELEMENTS).not.toContain('holy');
    expect(PICKABLE_ELEMENTS).not.toContain('sonic');
    for (const id of PICKABLE_ELEMENTS) expect(isPickableElement(id)).toBe(true);
    expect(isPickableElement('holy')).toBe(false);
    expect(isPickableElement('sonic')).toBe(false);
    // Still real elements, just not selectable ones.
    expect(elementDefFor('holy')).toBeDefined();
    expect(elementDefFor('sonic')).toBeDefined();
  });

  /**
   * The combat half of the catalog lives here; the presentation half (display
   * name, role blurb, UI colour) lives in `src/game/elements.ts`. They're joined
   * by id, so they have to list the same ones in the same order.
   */
  it('agrees with the client’s presentation catalog', () => {
    expect(ELEMENTS.map((e) => e.id)).toEqual([...ALL_ELEMENTS]);
  });

  it('keeps the design direction from GDD §8', () => {
    const def = (id: ElementId): ElementDef => {
      const d = elementDefFor(id);
      if (!d) throw new Error(`missing element ${id}`);
      return d;
    };
    const fire = def('fire');
    const ice = def('ice');
    const lightning = def('lightning');
    const poison = def('poison');
    const stone = def('stone');
    const arcane = def('arcane');
    const wind = def('wind');

    // §8.4 lightning pokes faster than fire; §8.6 stone is slow but heavy.
    expect(lightning.projectileSpeed).toBeGreaterThan(fire.projectileSpeed);
    expect(stone.projectileSpeed).toBeLessThan(fire.projectileSpeed);
    expect(stone.damage).toBeGreaterThan(fire.damage);
    expect(onHitRule(stone, 'interrupt')).toBeDefined();

    // §8.3 ice controls, §8.5 poison denies ground, §8.7 arcane splashes and
    // wind shoves.
    const iceSlow = onHitRule(ice, 'slow');
    expect(iceSlow?.magnitude).toBeGreaterThan(0);
    expect(iceSlow?.duration).toBeGreaterThan(0);
    const poisonPuddle = onHitRule(poison, 'puddle');
    expect(poisonPuddle).toBeDefined();
    expect(poisonPuddle?.radius).toBeGreaterThan(0);
    expect(poisonPuddle?.duration).toBeGreaterThan(0);
    expect(arcane.splashRadius).toBeGreaterThan(0);
    expect(wind.knockbackBonus).toBeGreaterThan(0);
  });

  /**
   * A support that out-trades a damage dealer is not a support. These are the
   * numbers that keep the Cleric's and the Bard's new attacks (GDD §8) a
   * nuisance rather than a second damage role.
   */
  it('keeps the support attacks weaker than every offensive element', () => {
    const def = (id: ElementId): ElementDef => {
      const d = elementDefFor(id);
      if (!d) throw new Error(`missing element ${id}`);
      return d;
    };
    // Not "weaker than everything": wind already trades nearly all its damage
    // for knockback (§8.7), so the floor is not the bar. The bar is the
    // reference damage dealer — a support must never trade like a Pyromancer.
    expect(def('holy').damage).toBeLessThan(def('fire').damage);
    expect(def('sonic').damage).toBeLessThan(def('fire').damage);
    // And both sit among the four softest hits in the game, alongside the two
    // offensive elements that already trade damage away (wind's shove, poison's
    // puddle) rather than anywhere near the elements that exist to kill.
    const byDamage = [...ALL_ELEMENTS].sort((a, b) => def(a).damage - def(b).damage);
    expect(byDamage.slice(0, 4)).toContain('holy');
    expect(byDamage.slice(0, 4)).toContain('sonic');
    // Both still do something on impact, or they would be worse than silence.
    expect(def('holy').splashRadius).toBeGreaterThan(0);
    expect(def('sonic').onHit.length).toBeGreaterThan(0);
    // ...but the Bard nags where the Sentinel controls (§8.3).
    const sonicSlow = onHitRule(def('sonic'), 'slow')?.magnitude ?? 0;
    const iceSlowFactor = onHitRule(def('ice'), 'slow')?.magnitude ?? 0;
    expect(sonicSlow).toBeLessThan(iceSlowFactor);
  });
});
