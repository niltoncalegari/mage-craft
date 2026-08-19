/**
 * What the player brings to a match: a 4-mage squad and a posture for each of
 * them (plano v1.3 §3.1, §3.4).
 *
 * Read synchronously from localStorage, and only from localStorage. That is not
 * an accident of history: `App.tsx` needs a loadout before it can send
 * `join_queue`, and a network round trip there would put a spinner on the
 * Battle button. The account copy is reconciled around this store rather than
 * in front of it — see `syncLoadoutFromServer` / `pushLoadoutToServer`.
 *
 * The server is still the authority. It re-validates both parts in
 * `resolveSquad`/`resolveStances`; this store only decides what we *offer*.
 *
 * Validation happens on read, not just on write, so a hand-edited localStorage
 * degrades to the defaults instead of shipping something illegal at the wire.
 */

import { isStance, type Stance } from '../../sim/abilityPolicy';
import { defaultSquad, isRosterId, type RosterId } from '../../sim/cards';
import { validateSquad } from '../../sim/squad';
import { ApiClient } from '../net/ApiClient';

const LOADOUT_KEY_V1 = 'mage-craft.loadout.v1';
const LOADOUT_KEY_V2 = 'mage-craft.loadout.v2';
const LOADOUT_KEY = 'mage-craft.loadout.v3';

/** The id the single shipped profile carries. The shape holds more; the UI offers one. */
export const DEFAULT_LOADOUT_ID = 'default';

export interface Loadout {
  id: string;
  name: string;
  squad: RosterId[];
  /**
   * Keyed by roster id rather than by squad slot, so re-ordering the squad or
   * benching a mage and bringing it back does not shuffle the postures the
   * player set. A mage with no entry stands at the sim's default posture.
   */
  stances: Partial<Record<RosterId, Stance>>;
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
  return {
    id: DEFAULT_LOADOUT_ID,
    name: 'Padrão',
    squad: defaultSquad(),
    stances: {},
  };
}

function defaultStore(): LoadoutStore {
  return { loadouts: [defaultLoadout()], activeLoadoutId: DEFAULT_LOADOUT_ID };
}

/**
 * Cleans one stored profile into something legal, part by part.
 *
 * Each part falls back on its own rather than the profile being thrown away
 * whole: a corrupt posture map is no reason to lose the squad next to it.
 */
function sanitize(raw: unknown, index: number): Loadout {
  const fallback = defaultLoadout();
  if (typeof raw !== 'object' || raw === null) return fallback;
  const l = raw as Partial<Loadout>;

  const squad = Array.isArray(l.squad) && validateSquad(l.squad).ok ? (l.squad as RosterId[]) : fallback.squad;

  return {
    id: typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 32 ? l.id : `loadout-${index}`,
    name: typeof l.name === 'string' && l.name.length > 0 && l.name.length <= 24 ? l.name : fallback.name,
    squad,
    stances: sanitizeStances(l.stances),
  };
}

/**
 * Keeps the entries that name a real mage and a real posture, and drops the
 * rest.
 *
 * Dropped entry by entry rather than reset whole, for the reason orphan rules
 * used to be: one unreadable key is not a reason to forget every posture the
 * player set. An entry for a mage that is not currently in the squad is *kept*
 * — benching someone and bringing them back should not silently reset them.
 */
function sanitizeStances(raw: unknown): Partial<Record<RosterId, Stance>> {
  if (typeof raw !== 'object' || raw === null) return {};

  const out: Partial<Record<RosterId, Stance>> = {};
  for (const [id, stance] of Object.entries(raw as Record<string, unknown>)) {
    if (isRosterId(id) && isStance(stance)) out[id] = stance;
  }
  return out;
}

/**
 * Carries a v1 `{ squad, deck }` or a v2 `{ loadouts: [{ squad, deck, strategy }] }`
 * forward to v3.
 *
 * Both older shapes are read for exactly one thing — the squad — because that
 * is the only part of them v1.3 still fields. The deck and the program are
 * dropped rather than translated: there is no hand to play and no rule to fire,
 * so nothing they said has a v3 meaning to be preserved into. Postures come out
 * empty, which reads as every mage at `normal` — the right default for someone
 * upgrading mid-season, who never chose one.
 */
function migrateOlder(): LoadoutStore | null {
  try {
    const v2 = localStorage.getItem(LOADOUT_KEY_V2);
    if (v2) {
      const parsed = JSON.parse(v2) as Partial<LoadoutStore> | null;
      if (parsed && Array.isArray(parsed.loadouts) && parsed.loadouts.length > 0) {
        const loadouts = parsed.loadouts.map(sanitize);
        const active = loadouts.some((l) => l.id === parsed.activeLoadoutId)
          ? (parsed.activeLoadoutId as string)
          : loadouts[0].id;
        return { loadouts, activeLoadoutId: active };
      }
    }

    const v1 = localStorage.getItem(LOADOUT_KEY_V1);
    if (!v1) return null;
    const parsed = JSON.parse(v1) as { squad?: unknown } | null;
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
      const migrated = migrateOlder();
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

/** Replaces the postures, leaving the squad and everything else as stored. */
export function saveStances(stances: Partial<Record<RosterId, Stance>>): void {
  saveLoadout({ ...loadLoadout(), stances: sanitizeStances(stances) });
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
