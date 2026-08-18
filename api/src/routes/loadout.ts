/**
 * The player's saved loadouts: the squad, and a posture for each mage in it
 * (plano v1.3 §3.1, §3.4). Mounted under `/api/me`, so `requireAuth` already ran.
 *
 * **This service is not the authority on what is legal.** It cannot be: `api/`
 * cannot import `sim/` (its `tsconfig` fixes `rootDir` to `src`, and
 * `sim/balance.ts` reaches outside it), so it has no access to the roster
 * catalog, the squad-construction rules or the stance vocabulary. The game
 * server runs `validateSquad`/`resolveStances` before a match and rejects
 * anything illegal there — the same split that has always applied to squads.
 *
 * What this service does enforce is *structure*: how many, how long, how deep.
 * Those are storage limits, not game rules, and they are the ones that have to
 * hold no matter what the client sends.
 */

import { Router } from 'express';
import { User } from '../models/User.js';
import type { AuthedRequest } from '../types.js';

export const loadoutRouter = Router();

/** Named profiles per account. Five is plenty to switch between; more is a list. */
const MAX_LOADOUTS = 5;
const MAX_ID = 32;
const MAX_NAME = 24;
/*
 * Generous ceilings rather than the game's own 4 and 8. The exact numbers are
 * `SQUAD_SIZE` and `DECK_SIZE`, which live in `sim/` and belong to the game
 * server's validation; duplicating them here would mean two places to change
 * and a service that quietly disagrees with the game after one of them moves.
 * These exist only so a list cannot grow without bound.
 */
const MAX_SQUAD = 8;
/**
 * One posture per mage the catalog could ever hold, with room to spare. The
 * exact roster size lives in `sim/`; this exists only so the map cannot grow
 * without bound.
 */
const MAX_STANCES = 32;

/** Keys that make a stored object hostile once it is read back or merged. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface LoadoutInput {
  id: string;
  name: string;
  squad: string[];
  stances: Record<string, string>;
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseIdList(value: unknown, max: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  if (value.some((id) => !isShortString(id, MAX_ID))) return null;
  return value as string[];
}

/**
 * Whether a posture map is safe to hand to Mongo and to read back.
 *
 * The keys are roster ids, which this service deliberately cannot enumerate, so
 * what is checked here is shape rather than meaning — the game server decides
 * whether `cleric` is a mage and whether `hold` is a stance. Three hazards, none
 * of them about the game's rules:
 *
 * - **Operator injection.** A key starting with `$`, or containing a `.`, is
 *   how Mongo spells an operator and a path. Storing one is how a document
 *   later becomes a query it was never meant to be — and this value goes into a
 *   `Map`, whose keys are written straight through.
 * - **Prototype pollution.** `JSON.parse` puts a literal `__proto__` key on the
 *   object as an own property, which is inert here but not after anything
 *   merges it into another object.
 * - **Unbounded growth.** A map with no ceiling is a way to store arbitrary
 *   volume on a user document.
 */
function parseStances(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_STANCES) return null;

  const out: Record<string, string> = {};
  for (const [key, stance] of entries) {
    if (!isShortString(key, MAX_ID)) return null;
    if (key.startsWith('$') || key.includes('.')) return null;
    if (FORBIDDEN_KEYS.has(key)) return null;
    if (!isShortString(stance, MAX_ID)) return null;
    out[key] = stance;
  }
  return out;
}

function parseLoadouts(value: unknown): LoadoutInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOADOUTS) return null;

  const seen = new Set<string>();
  const parsed: LoadoutInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const l = item as Record<string, unknown>;

    if (!isShortString(l.id, MAX_ID) || seen.has(l.id)) return null;
    seen.add(l.id);
    if (!isShortString(l.name, MAX_NAME)) return null;

    const squad = parseIdList(l.squad, MAX_SQUAD);
    const stances = parseStances(l.stances);
    if (!squad || !stances) return null;

    parsed.push({ id: l.id, name: l.name, squad, stances });
  }
  return parsed;
}

loadoutRouter.get('/', async (req: AuthedRequest, res) => {
  const user = await User.findById(req.userId, { loadouts: 1, activeLoadoutId: 1 }).lean();
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({ loadouts: user.loadouts ?? [], activeLoadoutId: user.activeLoadoutId ?? null });
});

/**
 * Total replacement, not a patch.
 *
 * With at most five small documents there is nothing a merge would buy, and a
 * merge would need per-profile timestamps to resolve a conflict it cannot
 * actually resolve — two devices editing the same loadout have no correct
 * answer. Replacement makes the rule sayable in one line, which is the rule the
 * client implements: the server wins on boot, the local copy wins on save.
 */
loadoutRouter.put('/', async (req: AuthedRequest, res) => {
  const body = req.body as Record<string, unknown>;

  const loadouts = parseLoadouts(body.loadouts);
  if (!loadouts) {
    res.status(400).json({
      error: `loadouts must be at most ${MAX_LOADOUTS} profiles of { id, name, squad, stances }`,
    });
    return;
  }

  const activeId = body.activeLoadoutId;
  if (activeId !== null && activeId !== undefined && !isShortString(activeId, MAX_ID)) {
    res.status(400).json({ error: 'activeLoadoutId must be a loadout id or null' });
    return;
  }
  // An active id naming a profile that is not in the same request would leave
  // the account pointing at nothing the moment it is read back.
  if (typeof activeId === 'string' && !loadouts.some((l) => l.id === activeId)) {
    res.status(400).json({ error: 'activeLoadoutId must name one of the submitted loadouts' });
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.userId,
    { loadouts, activeLoadoutId: activeId ?? null },
    { new: true, projection: { loadouts: 1, activeLoadoutId: 1 } },
  ).lean();
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.json({ loadouts: user.loadouts ?? [], activeLoadoutId: user.activeLoadoutId ?? null });
});
