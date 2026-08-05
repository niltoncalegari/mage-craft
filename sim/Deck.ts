/**
 * Deck, hand and cycle (GDD §7, §9).
 *
 * The rule that makes this interesting is that there is no hidden randomness
 * after the initial shuffle: the deck is a rotating queue, the hand is the
 * front of it, and the next card is always visible. A player who tracks what
 * they have spent knows exactly what is coming.
 *
 * Since the v1.1 pivot every card is a spell (blessing/curse/AoE, GDD §9), not
 * a unit — so the deck-construction rules changed too: with only 4 spells
 * designed so far, a legal deck is those 4 each duplicated once, and
 * duplicates are the point rather than something to forbid (GDD §9, §16.4:
 * revisit this once the spell pool grows past 4).
 */

import { ALL_SPELLS, isSpellId, spellFor, type CardId } from './spells';
import type { Rng } from './rng';

export const DECK_SIZE = 8;
export const HAND_SIZE = 4;

export type DeckValidation = { ok: true } | { ok: false; reason: string };

/** Enforces the GDD §7 construction rules before a deck is allowed into a match. */
export function validateDeck(cards: readonly string[]): DeckValidation {
  if (cards.length !== DECK_SIZE) {
    return { ok: false, reason: `deck must hold ${DECK_SIZE} cards, got ${cards.length}` };
  }
  for (const id of cards) {
    if (!isSpellId(id)) return { ok: false, reason: `unknown card ${JSON.stringify(id)}` };
  }
  return { ok: true };
}

/**
 * A playable default for matchmaking, so a player who never opened the deck
 * builder still gets a coherent hand: the whole spell catalog, each
 * duplicated once (GDD §9's provisional 8-card deck).
 */
export function defaultDeck(): CardId[] {
  return [...ALL_SPELLS, ...ALL_SPELLS];
}

export class Deck {
  /** The rotating cycle; index 0..HAND_SIZE-1 is the hand, HAND_SIZE is the preview. */
  private readonly cycle: CardId[];

  constructor(cards: readonly CardId[], rng?: Rng) {
    this.cycle = [...cards];
    if (rng) this.shuffle(rng);
  }

  /** Fisher-Yates against the seeded PRNG, so a replayed match deals the same. */
  private shuffle(rng: Rng): void {
    for (let i = this.cycle.length - 1; i > 0; i--) {
      const j = Math.floor(rng.float() * (i + 1));
      [this.cycle[i], this.cycle[j]] = [this.cycle[j], this.cycle[i]];
    }
  }

  hand(): CardId[] {
    return this.cycle.slice(0, HAND_SIZE);
  }

  /** The card that will enter the hand next — never hidden (GDD §7). */
  next(): CardId | null {
    return this.cycle[HAND_SIZE] ?? null;
  }

  holds(cardId: string): boolean {
    return this.hand().some((c) => c === cardId);
  }

  /**
   * Moves a played card to the back of the cycle. Returns false when the card
   * is not actually in hand, which the server treats as a rejected cast.
   */
  play(cardId: string): boolean {
    const idx = this.cycle.findIndex((c, i) => i < HAND_SIZE && c === cardId);
    if (idx === -1) return false;
    const [played] = this.cycle.splice(idx, 1);
    this.cycle.push(played);
    return true;
  }

  /** The cheapest card currently in hand — what the bot commander waits for. */
  cheapestInHand(): CardId | null {
    let best: CardId | null = null;
    let bestCost = Infinity;
    for (const id of this.hand()) {
      const card = spellFor(id);
      if (card && card.cost < bestCost) {
        bestCost = card.cost;
        best = id;
      }
    }
    return best;
  }
}

/** Every card, for the deck builder UI. */
export const CARD_POOL: readonly CardId[] = ALL_SPELLS;
