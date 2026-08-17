/**
 * These are exhaustiveness tripwires, not spelling tests.
 *
 * Every table here is keyed by a type from `sim/`, so a new selector, fact,
 * posture, effect or deck colour makes the record incomplete and TypeScript
 * catches it at build time — but only for tables that are `Record<K, …>`. What
 * a type cannot catch is the two ways these tables fail in front of a player:
 * an entry left empty, and an entry pasted straight from the identifier. Both
 * render as a rule that talks in `snake_case`.
 */

import { describe, expect, it } from 'vitest';
import { EFFECT_ORDER } from '../../sim/effects';
import { ALL_DECK_COLORS } from '../../sim/spells';
import { ALL_POSTURES, ALL_TARGET_SELECTORS, NUMERIC_RANGE } from '../../sim/strategy';
import { PROGRAM_NUMERIC_CONDITIONS } from '../../sim/abilityPolicy';
import { DECK_COLOR_INK, DECK_COLOR_LABEL, cardInk } from './deckColors';
import {
  ALL_COMPARATORS,
  COMPARATOR_LABEL,
  EFFECT_LABEL,
  FACT_LABEL,
  FACT_ORDER,
  NUMERIC_FIELD,
  POSTURE_LABEL,
  SELECTOR_LABEL,
  selectorLabel,
} from './strategyText';

/**
 * A label is blank, or it still reads as code. `mana` is allowed to be its own
 * label — it is already the word — but nothing may keep an underscore.
 */
function expectSpoken(label: string | undefined, identifier: string): void {
  expect(label, `no label for ${identifier}`).toBeTruthy();
  expect(label, `${identifier} is unlabelled`).not.toContain('_');
}

describe('strategy vocabulary', () => {
  it('names every target selector', () => {
    for (const at of ALL_TARGET_SELECTORS) expectSpoken(SELECTOR_LABEL[at], at);
  });

  it('names every fact the editor offers', () => {
    for (const kind of FACT_ORDER) expectSpoken(FACT_LABEL[kind], kind);
  });

  /**
   * Scoped to the *program's* half of the vocabulary rather than to all of it.
   *
   * Since the v1.3 kits landed, `sim/abilityPolicy.ts` owns one union read by
   * two callers, and each is missing a fact from it: a mage cannot read team
   * `mana`, and this editor — evaluated once per team — has no self to ask
   * `self_health` about. Sweeping the superset here would demand a picker row
   * for a fact `validateStrategy` refuses on the way back in.
   */
  it('offers every numeric fact, with a field spec', () => {
    for (const kind of PROGRAM_NUMERIC_CONDITIONS) {
      expect(FACT_ORDER, `${kind} is missing from the picker`).toContain(kind);
      const field = NUMERIC_FIELD[kind];
      expect(field.step, `${kind} has a stepper that never moves`).toBeGreaterThan(0);
      expect(field.scale, `${kind} scales to nothing`).toBeGreaterThan(0);

      // A new row must open on something the validator will accept, or picking
      // a fact would put the program in an illegal state before it is touched.
      const [min, max] = NUMERIC_RANGE[kind];
      expect(field.start, `${kind} opens outside its own range`).toBeGreaterThanOrEqual(min);
      expect(field.start).toBeLessThanOrEqual(max);
    }
  });

  it('names every comparator, posture and effect', () => {
    for (const op of ALL_COMPARATORS) expectSpoken(COMPARATOR_LABEL[op], op);
    for (const posture of ALL_POSTURES) expectSpoken(POSTURE_LABEL[posture], posture);
    for (const effect of EFFECT_ORDER) expectSpoken(EFFECT_LABEL[effect], effect);
  });

  it('falls back to the wire word for a selector it has never heard of', () => {
    // A server one version ahead names a selector this build lacks. Showing the
    // raw identifier still says which rule aimed where; blanking the line does not.
    expect(selectorLabel('cosmic_ray')).toBe('cosmic_ray');
    expect(selectorLabel('enemy_cluster')).toBe(SELECTOR_LABEL.enemy_cluster);
  });
});

describe('deck colours', () => {
  it('gives every colour a distinct swatch and a name', () => {
    const inks = new Set<string>();
    for (const color of ALL_DECK_COLORS) {
      expectSpoken(DECK_COLOR_LABEL[color], color);
      expect(DECK_COLOR_INK[color], `${color} has no swatch`).toMatch(/^#[0-9a-f]{6}$/i);
      inks.add(DECK_COLOR_INK[color]);
    }
    expect(inks.size, 'two colours share a swatch').toBe(ALL_DECK_COLORS.length);
  });

  it('tints a known card by its colour and an unknown one by the panel accent', () => {
    expect(cardInk('plague')).toBe(DECK_COLOR_INK.green);
    expect(cardInk('nothing_like_this')).toBe('var(--copper)');
  });
});
