/**
 * What the player brings to a match: a 4-mage squad, an 8-card spell deck, and
 * the strategy program that plays the deck (GDD §7).
 *
 * Read synchronously from localStorage, and only from localStorage. That is not
 * an accident of history: `App.tsx` needs a loadout before it can send
 * `join_queue`, and a network round trip there would put a spinner on the
 * Battle button. The account copy is reconciled around this store rather than
 * in front of it — see `syncLoadoutFromServer` / `pushLoadoutToServer`.
 *
 * The server is still the authority. It re-validates all three parts in
 * `resolveDeck`/`resolveSquad`/`resolveStrategy`; this store only decides what
 * we *offer*.
 *
 * Validation happens on read, not just on write, so a hand-edited localStorage
 * degrades to the defaults instead of shipping something illegal at the wire.
 */

import { defaultSquad, type RosterId } from '../../sim/cards';
import { defaultDeck, validateDeck } from '../../sim/Deck';
import { validateSquad } from '../../sim/squad';
import type { CardId } from '../../sim/spells';
import { defaultStrategy, validateStrategy, type Strategy, type StrategyRule } from '../../sim/strategy';
import { ApiClient } from '../net/ApiClient';

const LOADOUT_KEY_V1 = 'mage-craft.loadout.v1';
const LOADOUT_KEY = 'mage-craft.loadout.v2';

/** The id the single shipped profile carries. The shape holds more; the UI offers one. */
export const DEFAULT_LOADOUT_ID = 'default';

export interface Loadout {
  id: string;
  name: string;
  squad: RosterId[];
  deck: CardId[];
  strategy: Strategy;
}

/**
 * Every profile on this device, and which one is armed.
 *
 * A list from the start even though the shell offers exactly one: the account
 * schema stores a list, and a store that had to grow a second shape later would
 * mean a second migration for something already paid for here.
 */
export interface LoadoutStore {
  loadouts: Loadout[];
  activeLoadoutId: string;
}

export function defaultLoadout(): Loadout {
  const deck = defaultDeck();
  return {
    id: DEFAULT_LOADOUT_ID,
    name: 'Padrão',
    squad: defaultSquad(),
    deck,
    strategy: defaultStrategy(deck),
  };
}

function defaultStore(): LoadoutStore {
  return { loadouts: [defaultLoadout()], activeLoadoutId: DEFAULT_LOADOUT_ID };
}

/**
 * Cleans one stored profile into something legal, part by part.
 *
 * Each part falls back on its own rather than the profile being thrown away
 * whole: a corrupt deck is no reason to lose the squad next to it.
 */
function sanitize(raw: unknown, index: number): Loadout {
  const fallback = defaultLoadout();
  if (typeof raw !== 'object' || raw === null) return fallback;
  const l = raw as Partial<Loadout>;

  const squad = Array.isArray(l.squad) && validateSquad(l.squad).ok ? (l.squad as RosterId[]) : fallback.squad;
  const deck = Array.isArray(l.deck) && validateDeck(l.deck).ok ? (l.deck as CardId[]) : fallback.deck;

  return {
    id: typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 32 ? l.id : `loadout-${index}`,
    name: typeof l.name === 'string' && l.name.length > 0 && l.name.length <= 24 ? l.name : fallback.name,
    squad,
    deck,
    strategy: sanitizeStrategy(l.strategy, deck),
  };
}

/**
 * Cleans a program against the deck it will be played with.
 *
 * Orphan rules are dropped before the program is judged, rather than the whole
 * program being reset because of them. A rule naming a card the player no
 * longer brings is already inert — `evaluateStrategy` skips it, because it can
 * never be in hand — so dropping it costs nothing and keeps every rule that
 * still works. Resetting instead would mean editing your deck quietly wiped the
 * program you wrote, which is data loss dressed as validation.
 *
 * Anything still illegal after that is not a deck edit, it is a hand-edited
 * store, and that does fall back to the default.
 */
function sanitizeStrategy(raw: unknown, deck: readonly CardId[]): Strategy {
  if (typeof raw !== 'object' || raw === null) return defaultStrategy(deck);

  const s = raw as Partial<Strategy>;
  const kept = Array.isArray(s.rules)
    ? (s.rules as StrategyRule[]).filter((r) => typeof r?.card === 'string' && deck.includes(r.card))
    : [];
  const trimmed = { ...s, rules: kept } as Strategy;

  return validateStrategy(trimmed, deck).ok ? trimmed : defaultStrategy(deck);
}

/**
 * Turns the v1 `{ squad, deck }` into a v2 profile.
 *
 * v1 predates programs entirely, so the one thing it cannot carry is the only
 * thing that plays the match now. It gets `defaultStrategy(deck)` — the
 * heuristics written out as editable rules — because the alternative for
 * someone who upgrades mid-season is a seat that casts nothing.
 */
function migrateV1(): LoadoutStore | null {
  try {
    const raw = localStorage.getItem(LOADOUT_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { squad?: unknown; deck?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const migrated = sanitize({ ...parsed, id: DEFAULT_LOADOUT_ID, name: 'Padrão' }, 0);
    return { loadouts: [migrated], activeLoadoutId: migrated.id };
  } catch {
    return null;
  }
}

/** Every profile on this device. Always returns at least one. */
export function loadStore(): LoadoutStore {
  try {
    const raw = localStorage.getItem(LOADOUT_KEY);
    if (!raw) {
      const migrated = migrateV1();
      if (migrated) {
        saveStore(migrated);
        return migrated;
      }
      return defaultStore();
    }

    const parsed = JSON.parse(raw) as Partial<LoadoutStore> | null;
    if (!parsed || !Array.isArray(parsed.loadouts) || parsed.loadouts.length === 0) return defaultStore();

    const loadouts = parsed.loadouts.map(sanitize);
    const active = loadouts.some((l) => l.id === parsed.activeLoadoutId)
      ? (parsed.activeLoadoutId as string)
      : loadouts[0].id;
    return { loadouts, activeLoadoutId: active };
  } catch {
    return defaultStore();
  }
}

export function saveStore(store: LoadoutStore): void {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(store));
  } catch {
    /* private browsing / quota — the in-memory loadout still plays this session */
  }
}

/** The armed profile — what a match is actually played with. */
export function loadLoadout(): Loadout {
  const store = loadStore();
  return store.loadouts.find((l) => l.id === store.activeLoadoutId) ?? store.loadouts[0];
}

/** Replaces the armed profile, leaving any others alone. */
export function saveLoadout(loadout: Loadout): void {
  const store = loadStore();
  const index = store.loadouts.findIndex((l) => l.id === store.activeLoadoutId);
  const loadouts = [...store.loadouts];
  if (index === -1) loadouts.push(loadout);
  else loadouts[index] = loadout;
  saveStore({ loadouts, activeLoadoutId: loadout.id });
}

/** Replaces one part of the armed profile, leaving the others as stored. */
export function saveSquad(squad: RosterId[]): void {
  saveLoadout({ ...loadLoadout(), squad });
}

/**
 * Replaces the deck, and re-checks the program against it.
 *
 * Editing a deck can orphan rules that name a card it no longer holds. Running
 * the same cleaning here as on read means the store never *holds* a program
 * that disagrees with its own deck, so the wire and the editor see the same
 * thing the next time either looks.
 */
export function saveDeck(deck: CardId[]): void {
  const current = loadLoadout();
  saveLoadout({ ...current, deck, strategy: sanitizeStrategy(current.strategy, deck) });
}

export function saveStrategy(strategy: Strategy): void {
  saveLoadout({ ...loadLoadout(), strategy });
}

/* ---- the account copy ------------------------------------------------------ */

/*
 * Two directions, one rule, no timestamps: **the server wins on boot, the local
 * copy wins on save.** Both calls are fire-and-forget — a loadout that failed
 * to sync is a loadout that still plays, on the copy this device holds, so
 * neither of them is worth a spinner or an error banner.
 *
 * Merging was considered and rejected: two devices editing the same profile
 * have no correct resolution, and inventing one would need per-part timestamps
 * to produce an answer that is still arbitrary.
 */

/**
 * Pulls the account's loadouts over this device's, on boot.
 *
 * An account with nothing saved yet is seeded from this device instead, so
 * signing in on the machine you have been playing on does not hand you the
 * defaults.
 */
export async function syncLoadoutFromServer(token: string): Promise<void> {
  const remote = await ApiClient.myLoadout(token);
  if (remote.loadouts.length === 0) {
    await pushLoadoutToServer(token);
    return;
  }

  // Cleaned on the way in exactly like localStorage is: the account copy was
  // written by some other build of this client, and it is not more trusted for
  // having made a round trip.
  const loadouts = remote.loadouts.map(sanitize);
  const active = loadouts.some((l) => l.id === remote.activeLoadoutId)
    ? (remote.activeLoadoutId as string)
    : loadouts[0].id;
  saveStore({ loadouts, activeLoadoutId: active });
}

/** Pushes this device's loadouts onto the account, after a save. */
export async function pushLoadoutToServer(token: string): Promise<void> {
  const store = loadStore();
  await ApiClient.putLoadout(token, store);
}
