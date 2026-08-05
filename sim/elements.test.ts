import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../src/game/elements';
import {
  ALL_ELEMENTS,
  elementDefFor,
  isElementId,
  type ElementDef,
  type ElementId,
} from './elements';

describe('element catalog', () => {
  it('has 7 unique ids, each resolving to a definition', () => {
    expect(ALL_ELEMENTS).toHaveLength(7);
    expect(new Set(ALL_ELEMENTS).size).toBe(7);
    for (const id of ALL_ELEMENTS) {
      expect(elementDefFor(id), id).toBeDefined();
      expect(isElementId(id)).toBe(true);
    }
    expect(isElementId('shadow')).toBe(false);
  });

  /**
   * The combat half of the catalog lives here; the presentation half (display
   * name, role blurb, UI colour) lives in `src/game/elements.ts`. They're joined
   * by id, so they have to list the same 7 in the same order.
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
    expect(stone.interruptsCharge).toBe(true);

    // §8.3 ice controls, §8.5 poison denies ground, §8.7 arcane splashes and
    // wind shoves.
    expect(ice.slowFactor).toBeGreaterThan(0);
    expect(ice.slowDuration).toBeGreaterThan(0);
    expect(poison.spawnsPuddle).toBe(true);
    expect(poison.puddleRadius).toBeGreaterThan(0);
    expect(poison.puddleDuration).toBeGreaterThan(0);
    expect(arcane.splashRadius).toBeGreaterThan(0);
    expect(wind.knockbackBonus).toBeGreaterThan(0);
  });
});
