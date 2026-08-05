import { describe, expect, it } from 'vitest';
import { ALL_SPELLS, spellFor } from './spells';
import { Deck, DECK_SIZE, defaultDeck, HAND_SIZE, validateDeck } from './Deck';
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
   * Unlike the v1.0 unit pool, a repeated spell is expected and allowed: with
   * only 4 spells designed so far (GDD §9), the provisional 8-card deck is
   * those 4 each duplicated once. Revisit once the pool grows (GDD §16.4).
   */
  it('allows a repeated spell', () => {
    const dupe = defaultDeck();
    dupe[1] = dupe[0];
    expect(validateDeck(dupe)).toEqual({ ok: true });
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
    expect(seen).toEqual(new Set(ALL_SPELLS));
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
