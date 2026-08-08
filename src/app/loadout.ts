/**
 * What the player brings to a match: a 4-mage squad and an 8-card spell deck.
 *
 * Stored locally rather than on the account because guests have no token
 * (`loginGuest` in ./auth), and a builder half the players cannot use is not a
 * builder. The server is still the authority — it re-validates everything in
 * `resolveDeck`/`resolveSquad` — this store only decides what we *offer*.
 *
 * Validation happens on read, not just on write, so a hand-edited localStorage
 * degrades to the defaults instead of shipping an illegal loadout at the wire.
 */

import { defaultSquad, type RosterId } from '../../sim/cards';
import { defaultDeck, validateDeck } from '../../sim/Deck';
import { validateSquad } from '../../sim/squad';
import type { CardId } from '../../sim/spells';

const LOADOUT_KEY = 'mage-craft.loadout.v1';

export interface Loadout {
  squad: RosterId[];
  deck: CardId[];
}

export function defaultLoadout(): Loadout {
  return { squad: defaultSquad(), deck: defaultDeck() };
}

export function loadLoadout(): Loadout {
  const fallback = defaultLoadout();
  try {
    const raw = localStorage.getItem(LOADOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Loadout> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const squad = Array.isArray(parsed.squad) && validateSquad(parsed.squad).ok ? (parsed.squad as RosterId[]) : fallback.squad;
    const deck = Array.isArray(parsed.deck) && validateDeck(parsed.deck).ok ? (parsed.deck as CardId[]) : fallback.deck;
    return { squad, deck };
  } catch {
    return fallback;
  }
}

export function saveLoadout(loadout: Loadout): void {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
  } catch {
    /* private browsing / quota — the in-memory loadout still plays this session */
  }
}

/** Replaces one half of the loadout, leaving the other as stored. */
export function saveSquad(squad: RosterId[]): void {
  saveLoadout({ ...loadLoadout(), squad });
}

export function saveDeck(deck: CardId[]): void {
  saveLoadout({ ...loadLoadout(), deck });
}
