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

import {
  ALL_DECK_COLORS,
  ALL_SPELLS,
  isSpellId,
  spellFor,
  SPELLS_BY_COLOR,
  type CardId,
  type DeckColor,
} from './spells';
import type { Rng } from './rng';

export const DECK_SIZE = 8;
export const HAND_SIZE = 4;

/**
 * Copies of any one card.
 *
 * Two is what the rotating queue makes meaningful: with a hand of four, two
 * copies in eight means the card comes back around roughly every other hand.
 * Higher is not a stronger deck so much as a shorter one — eight copies of a
 * card collapses a whole strategy program to a single rule, which is the
 * failure mode to design against.
 */
export const MAX_COPIES = 2;

/** Below this a deck has no answers, only a habit. */
export const MIN_DISTINCT = 3;

/**
 * Colours a deck may draw from (GDD §16.4).
 *
 * Two gives a ten-card pool for eight slots: a real cut, a legible identity,
 * and a strategy palette that still fits a phone in landscape. Free choice
 * across the whole catalog would make colour cosmetic.
 *
 * This was written before it could be enforced. While black held a single card,
 * no partner colour could carry it to `DECK_SIZE` inside `MAX_COPIES`, so the
 * rule would have removed Maldição da Lentidão from the game rather than
 * constrained it — see {@link colorLimitIsPlayable}, which is still checked by
 * `Deck.test.ts` and now guards the invariant from the other side.
 */
export const MAX_COLORS = 2;

/**
 * Whether every card that exists could appear in some legal two-colour deck.
 *
 * A card of colour `c` is placeable when some other colour `d` brings enough
 * cards that the pair can fill `DECK_SIZE` within `MAX_COPIES`. Empty colours
 * are vacuous — they hold no card to strand.
 */
export function colorLimitIsPlayable(): boolean {
  const size = (c: DeckColor): number => SPELLS_BY_COLOR[c].length;
  return ALL_DECK_COLORS.filter((c) => size(c) > 0).every((c) =>
    ALL_DECK_COLORS.some((d) => d !== c && (size(c) + size(d)) * MAX_COPIES >= DECK_SIZE),
  );
}

/**
 * The distinct colours a card list draws from, in catalog order.
 *
 * Order is fixed rather than first-seen so the deck builder's mix line reads
 * the same ("Branco + Verde") however the player happened to add the cards.
 * Unknown ids are skipped; `validateDeck` is what rejects them, and this is
 * also called on half-built decks in the UI.
 */
export function colorsOf(cards: readonly string[]): DeckColor[] {
  const present = new Set<DeckColor>();
  for (const id of cards) {
    if (isSpellId(id)) present.add(spellFor(id)!.color);
  }
  return ALL_DECK_COLORS.filter((c) => present.has(c));
}

export type DeckValidation = { ok: true } | { ok: false; reason: string };

/** Enforces the GDD §7 construction rules before a deck is allowed into a match. */
export function validateDeck(cards: readonly string[]): DeckValidation {
  if (cards.length !== DECK_SIZE) {
    return { ok: false, reason: `deck must hold ${DECK_SIZE} cards, got ${cards.length}` };
  }

  const copies = new Map<string, number>();
  for (const id of cards) {
    if (!isSpellId(id)) return { ok: false, reason: `unknown card ${JSON.stringify(id)}` };
    const n = (copies.get(id) ?? 0) + 1;
    if (n > MAX_COPIES) {
      return { ok: false, reason: `at most ${MAX_COPIES} copies of ${spellFor(id)?.name ?? id}` };
    }
    copies.set(id, n);
  }

  if (copies.size < MIN_DISTINCT) {
    return { ok: false, reason: `deck needs at least ${MIN_DISTINCT} different cards, got ${copies.size}` };
  }

  const colors = colorsOf(cards);
  if (colors.length > MAX_COLORS) {
    return { ok: false, reason: `deck may draw from at most ${MAX_COLORS} colours, got ${colors.length}` };
  }

  return { ok: true };
}

/**
 * A playable default for matchmaking, so a player who never opened the deck
 * builder still gets a coherent hand.
 *
 * Hand-authored rather than derived from the catalog: it used to be every
 * card duplicated once, which stopped being a deck the moment the catalog grew
 * past four. White and green, two copies each — legal under the copy rule now
 * and under the colour rule when that turns on, so this does not have to be
 * revisited twice.
 */
export function defaultDeck(): CardId[] {
  return [
    'blessing',
    'blessing',
    'arcane_shield',
    'arcane_shield',
    'plague',
    'plague',
    'sticky_swamp',
    'sticky_swamp',
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
