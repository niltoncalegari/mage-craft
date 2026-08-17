/**
 * The benchmark programs are only worth what they measure, and both ways they
 * can stop measuring anything are silent.
 *
 * A rule naming a card the deck does not carry is not an error — `evaluateStrategy`
 * simply skips it — so a preset can quietly become a shorter program than it
 * reads as. And a deck that breaks a deck-building rule would never be legal for
 * a player, which makes any result taken over it a result about a game nobody
 * can play. Neither shows up as a failure in the report: they show up as a
 * number that looks fine.
 */

import { describe, expect, it } from 'vitest';
import { defaultDeck, validateDeck } from './Deck';
import { ALL_DECK_COLORS, colorsOf, isSpellId } from './spells';
import { validateStrategy } from './strategy';
import {
  conditionalDeck,
  conditionalDeckWithoutStone,
  conditionalFlatProgram,
  conditionalResponsiveProgram,
  flatProgram,
  naiveProgram,
  responsiveProgram,
} from './strategyPresets';

const DECKS = {
  default: defaultDeck(),
  conditional: conditionalDeck(),
  'conditional without stone': conditionalDeckWithoutStone(),
};

describe('the benchmark decks are decks a player could build', () => {
  for (const [name, deck] of Object.entries(DECKS)) {
    it(`${name} passes the same validation the deck builder runs`, () => {
      expect(validateDeck(deck), name).toEqual({ ok: true });
    });

    it(`${name} names only cards that exist`, () => {
      for (const id of deck) expect(isSpellId(id), `${name}: ${id}`).toBe(true);
    });
  }

  it('draws the conditional deck from colours the catalog actually has', () => {
    for (const color of colorsOf(conditionalDeck())) {
      expect(ALL_DECK_COLORS).toContain(color);
    }
  });

  /**
   * The stone-free control has to differ in exactly one card, or it stops being
   * a control: any second difference and a gap between the two decks could be
   * attributed to either change.
   */
  it('differs from its own control by one card and nothing else', () => {
    const a = conditionalDeck();
    const b = conditionalDeckWithoutStone();
    expect(b).toHaveLength(a.length);
    expect(a.filter((id, i) => id !== b[i])).toEqual(['petrify']);
  });
});

describe('the benchmark programs are programs, not decoration', () => {
  const OVER_DEFAULT = { responsiveProgram, flatProgram, naiveProgram };
  const OVER_CONDITIONAL = { conditionalResponsiveProgram, conditionalFlatProgram };

  for (const [name, make] of Object.entries(OVER_DEFAULT)) {
    it(`${name} is valid against the deck it is written for`, () => {
      expect(validateStrategy(make(), defaultDeck())).toEqual({ ok: true });
    });
  }

  for (const [name, make] of Object.entries(OVER_CONDITIONAL)) {
    it(`${name} is valid against the conditional deck`, () => {
      expect(validateStrategy(make(), conditionalDeck())).toEqual({ ok: true });
    });
  }

  /**
   * The correction the Tier 1 measurement already had to make once, kept as a
   * test so it cannot be undone by an edit to either program. The control must
   * differ from the responsive program **only** in its guards: if it also plays
   * different cards, the comparison measures variety instead of situational
   * play, which is what the first attempt at this accidentally did.
   */
  it('varies the guards and nothing else between the pair', () => {
    const guarded = conditionalResponsiveProgram();
    const flat = conditionalFlatProgram();

    const cards = (s: ReturnType<typeof conditionalFlatProgram>): string[] =>
      s.rules.map((r) => r.card).sort();
    expect(cards(flat)).toEqual(cards(guarded));

    const places = (s: ReturnType<typeof conditionalFlatProgram>): string[] =>
      [...s.rules].sort((a, b) => a.card.localeCompare(b.card)).map((r) => r.at);
    expect(places(flat)).toEqual(places(guarded));

    // And the control really is unguarded, or there is nothing to compare.
    for (const r of flat.rules) expect(r.when.kind, r.card).toBe('always');
  });

  it('leaves no rule inert, in either program', () => {
    const deck = new Set<string>(conditionalDeck());
    for (const make of [conditionalResponsiveProgram, conditionalFlatProgram]) {
      for (const r of make().rules) {
        expect(deck.has(r.card), `${make.name}: ${r.card}`).toBe(true);
        expect(r.enabled, `${make.name}: ${r.id}`).toBe(true);
      }
    }
  });
});
