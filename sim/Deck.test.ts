import { describe, expect, it } from 'vitest';
import { ALL_SPELLS, spellFor } from './spells';
import {
  colorLimitIsPlayable,
  Deck,
  DECK_SIZE,
  defaultDeck,
  HAND_SIZE,
  MAX_COPIES,
  validateDeck,
} from './Deck';
import { Rng } from './rng';

describe('deck construction (GDD §9)', () => {
  it('accepts the default deck', () => {
    expect(validateDeck(defaultDeck())).toEqual({ ok: true });
    expect(defaultDeck()).toHaveLength(DECK_SIZE);
  });

  it('rejects a deck of the wrong size', () => {
    const short = defaultDeck().slice(0, 5);
    expect(validateDeck(short).ok).toBe(false);
  });

  /*
   * Unlike the v1.0 unit pool, a repeated spell is expected: the deck is a
   * rotating queue, so a second copy is how you make a card come back sooner
   * (GDD §9). What is capped is how far that goes — see MAX_COPIES.
   */
  it('allows a repeated spell', () => {
    const dupe = defaultDeck();
    expect(dupe.filter((c) => c === dupe[0])).toHaveLength(MAX_COPIES);
    expect(validateDeck(dupe)).toEqual({ ok: true });
  });

  it('rejects more copies of one card than the cycle makes meaningful', () => {
    const stacked = Array<string>(DECK_SIZE).fill('blessing');
    expect(validateDeck(stacked).ok).toBe(false);
  });

  /*
   * A deck of two cards is not a deck, it is a habit — and it collapses a
   * whole strategy program to one rule, which is the thing to design against.
   */
  it('rejects a deck built from too few different cards', () => {
    const thin = ['blessing', 'blessing', 'plague', 'plague', 'blessing', 'blessing', 'plague', 'plague'];
    expect(validateDeck(thin).ok).toBe(false);
  });

  it('rejects an unknown card', () => {
    const bad = defaultDeck();
    bad[0] = 'lich_king' as never;
    expect(validateDeck(bad).ok).toBe(false);
  });
});

describe('hand and cycle', () => {
  it('deals a hand and shows the next card', () => {
    const d = new Deck(defaultDeck());
    expect(d.hand()).toHaveLength(HAND_SIZE);
    // With only 4 spells duplicated (GDD §9), the preview's *value* may equal
    // a card already in hand — it is still a distinct slot in the cycle.
    expect(d.next()).toBeTruthy();
    expect(ALL_SPELLS).toContain(d.next());
  });

  it('cycles a played card to the back and draws the preview', () => {
    const d = new Deck(defaultDeck());
    const played = d.hand()[1];
    const preview = d.next();

    expect(d.play(played)).toBe(true);

    // The played card cycled away from its slot, though a duplicate of the
    // same spell id may still occupy another hand slot (GDD §9).
    expect(d.hand()).toContain(preview);
  });

  it('refuses to play a card that is not in hand', () => {
    const d = new Deck(['blessing', 'blessing', 'blessing', 'blessing', 'slow_curse', 'slow_curse', 'slow_curse', 'slow_curse']);
    // Every hand slot is 'blessing' here, so 'plague' is guaranteed absent.
    expect(d.play('plague')).toBe(false);
    expect(d.holds('plague')).toBe(false);
  });

  it('returns every card eventually, so nothing is stranded', () => {
    const d = new Deck(defaultDeck());
    const seen = new Set<string>();
    for (let i = 0; i < DECK_SIZE; i++) {
      const card = d.hand()[0];
      seen.add(card);
      d.play(card);
    }
    expect(seen).toEqual(new Set(defaultDeck()));
  });

  it('shuffles deterministically from a seed', () => {
    const a = new Deck(defaultDeck(), new Rng(7)).hand();
    const b = new Deck(defaultDeck(), new Rng(7)).hand();
    expect(a).toEqual(b);
  });

  it('reports the cheapest card in hand', () => {
    const d = new Deck(defaultDeck());
    const cheapest = d.cheapestInHand()!;
    const cost = spellFor(cheapest)!.cost;
    for (const id of d.hand()) {
      expect(spellFor(id)!.cost).toBeGreaterThanOrEqual(cost);
    }
  });
});

/*
 * A tripwire, not a behaviour test. The two-colour rule (GDD §16.4) is right
 * for the catalog the GDD calls for and wrong for the one that exists: some
 * colours cannot yet reach DECK_SIZE alongside any other, so enforcing it now
 * would strand their cards rather than constrain them. This fails the moment
 * that stops being true, which is when MAX_COLORS should start being enforced
 * and the note in Deck.ts should go.
 */
describe('the deferred two-colour rule (GDD §16.4)', () => {
  it('is still unplayable, so it is still not enforced', () => {
    expect(colorLimitIsPlayable()).toBe(false);
  });
});
