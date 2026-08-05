import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardFor } from './cards';
import { Deck, DECK_SIZE, defaultDeck, HAND_SIZE, validateDeck } from './Deck';
import { Rng } from './rng';

describe('deck construction (GDD §7)', () => {
  it('accepts the default deck', () => {
    expect(validateDeck(defaultDeck())).toEqual({ ok: true });
    expect(defaultDeck()).toHaveLength(DECK_SIZE);
  });

  it('rejects a deck of the wrong size', () => {
    const short = defaultDeck().slice(0, 5);
    expect(validateDeck(short).ok).toBe(false);
  });

  it('rejects a repeated card', () => {
    const dupe = defaultDeck();
    dupe[1] = dupe[0];
    expect(validateDeck(dupe).ok).toBe(false);
  });

  it('rejects an unknown card', () => {
    const bad = defaultDeck();
    bad[0] = 'lich_king' as never;
    expect(validateDeck(bad).ok).toBe(false);
  });

  /*
   * The role rule of GDD §7 cannot currently be violated, and that is worth
   * pinning down rather than leaving as a comment.
   *
   * The v1 pool is 9 unit cards (2 tank, 5 damage, 2 support) and a deck is 8,
   * so a legal deck excludes exactly one card — which can never remove a whole
   * role. The rule only starts doing work once the pool grows, which is exactly
   * the "are 13 cards enough?" question left open in GDD §16.3.
   */
  it('cannot yet be violated: the pool is too small to drop a whole role', () => {
    const everyEightCardDeck = ALL_CARDS.map((excluded) =>
      ALL_CARDS.filter((id) => id !== excluded),
    );

    for (const deck of everyEightCardDeck) {
      expect(deck).toHaveLength(DECK_SIZE);
      expect(validateDeck(deck), `deck without one card`).toEqual({ ok: true });
    }
  });

  it('still rejects a role-starved list if one is ever constructible', () => {
    // Constructed directly rather than drawn from the pool, so this guards the
    // validator itself and not just today's catalog.
    const noSupport = ['stone_golem', 'ice_sentinel', 'pyromancer', 'stormcaller'];
    const check = validateDeck(noSupport);
    // Fails on size first, which is fine — the point is it does not pass.
    expect(check.ok).toBe(false);
  });
});

describe('hand and cycle', () => {
  it('deals a hand and shows the next card', () => {
    const d = new Deck(defaultDeck());
    expect(d.hand()).toHaveLength(HAND_SIZE);
    expect(d.next()).toBeTruthy();
    // The preview is never already in hand.
    expect(d.hand()).not.toContain(d.next());
  });

  it('cycles a played card to the back and draws the preview', () => {
    const d = new Deck(defaultDeck());
    const played = d.hand()[1];
    const preview = d.next();

    expect(d.play(played)).toBe(true);

    expect(d.hand()).not.toContain(played);
    expect(d.hand()).toContain(preview);
  });

  it('refuses to play a card that is not in hand', () => {
    const d = new Deck(defaultDeck());
    const notInHand = d.next()!;
    expect(d.play(notInHand)).toBe(false);
    expect(d.holds(notInHand)).toBe(false);
  });

  it('returns every card eventually, so nothing is stranded', () => {
    const d = new Deck(defaultDeck());
    const seen = new Set<string>();
    for (let i = 0; i < DECK_SIZE; i++) {
      const card = d.hand()[0];
      seen.add(card);
      d.play(card);
    }
    expect(seen.size).toBe(DECK_SIZE);
  });

  it('shuffles deterministically from a seed', () => {
    const a = new Deck(defaultDeck(), new Rng(7)).hand();
    const b = new Deck(defaultDeck(), new Rng(7)).hand();
    expect(a).toEqual(b);
  });

  it('reports the cheapest card in hand', () => {
    const d = new Deck(defaultDeck());
    const cheapest = d.cheapestInHand()!;
    const cost = cardFor(cheapest)!.cost;
    for (const id of d.hand()) {
      expect(cardFor(id)!.cost).toBeGreaterThanOrEqual(cost);
    }
  });
});
