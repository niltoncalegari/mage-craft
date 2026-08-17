/**
 * The catalog is authored by hand in `balance.json`, so the cheapest guard
 * against a typo is a test that simply imports it: `spells.ts` validates every
 * card at module load and throws. Everything below that is about the shape the
 * builders and the deck rules rely on.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_DECK_COLORS,
  ALL_SPELLS,
  colorsOf,
  isSpellId,
  spellFor,
  SPELLS_BY_COLOR,
} from './spells';
import { isEffectKind } from './effects';
import { isSpellRider } from './spellRiders';

describe('the spell catalog', () => {
  it('loads — which is the assertion, since a bad card throws on import', () => {
    expect(ALL_SPELLS.length).toBeGreaterThan(0);
  });

  it('resolves every listed spell, and nothing else', () => {
    for (const id of ALL_SPELLS) {
      expect(spellFor(id)).toBeDefined();
      expect(isSpellId(id)).toBe(true);
    }
    expect(spellFor('fireball_of_doom')).toBeUndefined();
    expect(isSpellId('fireball_of_doom')).toBe(false);
  });

  it('gives every card a known colour, target and cost', () => {
    for (const id of ALL_SPELLS) {
      const card = spellFor(id)!;
      expect(ALL_DECK_COLORS).toContain(card.color);
      expect(['allies', 'enemies', 'all', 'ground']).toContain(card.target);
      expect(card.cost).toBeGreaterThan(0);
      expect(card.radius).toBeGreaterThan(0);
      expect(card.duration).toBeGreaterThan(0);
    }
  });

  /*
   * The one that earns its keep. An application naming something that is
   * neither a status effect nor a registered rider does not crash — it does
   * nothing, in a match nobody is watching closely.
   */
  it('only applies effects the simulation actually knows how to run', () => {
    for (const id of ALL_SPELLS) {
      const card = spellFor(id)!;
      expect(card.apply.length).toBeGreaterThan(0);
      for (const app of card.apply) {
        expect(isEffectKind(app.effect) || isSpellRider(app.effect)).toBe(true);
      }
    }
  });

  it('partitions the catalog across the colours exactly once each', () => {
    const grouped = ALL_DECK_COLORS.flatMap((c) => SPELLS_BY_COLOR[c]);

    expect(grouped.slice().sort()).toEqual(ALL_SPELLS.slice().sort());
    expect(new Set(grouped).size).toBe(ALL_SPELLS.length);
  });

  it('reads the colours a deck draws from, ignoring anything unknown', () => {
    expect(colorsOf(['blessing', 'arcane_shield'])).toEqual(new Set(['white']));
    expect(colorsOf(['blessing', 'plague'])).toEqual(new Set(['white', 'green']));
    expect(colorsOf(['fireball_of_doom'])).toEqual(new Set());
  });
});

describe('the four cards that predate the data-driven catalog', () => {
  it('keeps Bênção de Ímpeto as haste plus cast haste on allies', () => {
    const card = spellFor('blessing')!;
    expect(card.target).toBe('allies');
    expect(card.apply.map((a) => a.effect)).toEqual(['haste', 'cast_haste']);
  });

  it('keeps Maldição da Lentidão as a slow on enemies', () => {
    const card = spellFor('slow_curse')!;
    expect(card.target).toBe('enemies');
    expect(card.apply.map((a) => a.effect)).toEqual(['slow']);
  });

  it('keeps Escudo Arcano as a shield pool on allies', () => {
    const card = spellFor('arcane_shield')!;
    expect(card.target).toBe('allies');
    expect(card.apply.map((a) => a.effect)).toEqual(['shield']);
  });

  it('keeps Praga as a ground hazard that goes through the shield', () => {
    const card = spellFor('plague')!;
    expect(card.target).toBe('ground');
    expect(card.apply).toHaveLength(1);
    expect(card.apply[0]).toMatchObject({ effect: 'puddle', bypassShield: true });
  });
});
