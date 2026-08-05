/**
 * Deck, hand and cycle (GDD §7).
 *
 * The rule that makes this interesting is that there is no hidden randomness
 * after the initial shuffle: the deck is a rotating queue, the hand is the
 * front of it, and the next card is always visible. A player who tracks what
 * they have spent knows exactly what is coming.
 */

import { ALL_CARDS, cardFor, isCardId, type CardId } from './cards';
import { ROLE_BEHAVIOR, type Role } from './roles';
import type { Rng } from './rng';

export const DECK_SIZE = 8;
export const HAND_SIZE = 4;
/** GDD §7: a deck must be able to field every role. */
export const MIN_PER_ROLE = 1;

export type DeckValidation = { ok: true } | { ok: false; reason: string };

/** Enforces the GDD §7 construction rules before a deck is allowed into a match. */
export function validateDeck(cards: readonly string[]): DeckValidation {
  if (cards.length !== DECK_SIZE) {
    return { ok: false, reason: `deck must hold ${DECK_SIZE} cards, got ${cards.length}` };
  }
  if (new Set(cards).size !== cards.length) {
    return { ok: false, reason: 'deck may not repeat a card' };
  }

  const perRole = new Map<Role, number>();
  for (const id of cards) {
    if (!isCardId(id)) return { ok: false, reason: `unknown card ${JSON.stringify(id)}` };
    const card = cardFor(id);
    if (!card) return { ok: false, reason: `unknown card ${JSON.stringify(id)}` };
    perRole.set(card.role, (perRole.get(card.role) ?? 0) + 1);
  }

  for (const role of Object.keys(ROLE_BEHAVIOR) as Role[]) {
    if ((perRole.get(role) ?? 0) < MIN_PER_ROLE) {
      return { ok: false, reason: `deck needs at least ${MIN_PER_ROLE} ${role} card` };
    }
  }
  return { ok: true };
}

/**
 * A playable default for matchmaking, so a player who never opened the deck
 * builder still gets a coherent hand. One tank, one support, the rest damage.
 */
export function defaultDeck(): CardId[] {
  return [
    'stone_golem',
    'ice_sentinel',
    'pyromancer',
    'stormcaller',
    'arcane_archer',
    'alchemist',
    'wind_dervish',
    'cleric',
  ];
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
      const card = cardFor(id);
      if (card && card.cost < bestCost) {
        bestCost = card.cost;
        best = id;
      }
    }
    return best;
  }
}

/** Every card, for the deck builder UI. */
export const CARD_POOL: readonly CardId[] = ALL_CARDS;
