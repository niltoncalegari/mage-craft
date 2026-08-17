/**
 * The player's saved loadouts: squad, deck, and the strategy program that plays
 * the deck (GDD §7). Mounted under `/api/me`, so `requireAuth` already ran.
 *
 * **This service is not the authority on what is legal.** It cannot be: `api/`
 * cannot import `sim/` (its `tsconfig` fixes `rootDir` to `src`, and
 * `sim/balance.ts` reaches outside it), so it has no access to the card
 * catalog, the deck-construction rules or the condition vocabulary. The game
 * server runs `validateDeck`/`validateSquad`/`validateStrategy` before a match
 * and rejects anything illegal there — the same split that already applies to
 * decks and squads.
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
/** Mirrors `STRATEGY_MAX_RULES` in sim/strategy.ts — kept as a number, not an import. */
const MAX_RULES = 12;
const MAX_ID = 32;
const MAX_NAME = 24;
/**
 * Serialized size of one rule's condition.
 *
 * The condition is the one part of a loadout with no fixed shape, so it is the
 * one part a client could use to store arbitrary volume. 512 bytes is far more
 * than the editor can produce — a group of four conditions runs well under
 * 200 — and small enough that twelve of them cannot bloat a user document.
 */
const MAX_WHEN_BYTES = 512;
/** How deep a condition may nest before we stop walking it. */
const MAX_WHEN_DEPTH = 8;
/*
 * Generous ceilings rather than the game's own 4 and 8. The exact numbers are
 * `SQUAD_SIZE` and `DECK_SIZE`, which live in `sim/` and belong to the game
 * server's validation; duplicating them here would mean two places to change
 * and a service that quietly disagrees with the game after one of them moves.
 * These exist only so a list cannot grow without bound.
 */
const MAX_SQUAD = 8;
const MAX_DECK = 16;

/** Keys that make a stored object hostile once it is read back or merged. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface StrategyRuleInput {
  id: string;
  enabled: boolean;
  card: string;
  when: unknown;
  at: string;
}

interface LoadoutInput {
  id: string;
  name: string;
  squad: string[];
  deck: string[];
  strategy: { version: number; name: string; rules: StrategyRuleInput[] };
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
 * Whether an opaque condition is safe to hand to Mongo and to read back.
 *
 * Three separate hazards, none of them about the game's rules:
 *
 * - **Operator injection.** A key starting with `$`, or containing a `.`, is
 *   how Mongo spells an operator and a path. Storing one is how a document
 *   later becomes a query it was never meant to be.
 * - **Prototype pollution.** `JSON.parse` puts a literal `__proto__` key on the
 *   object as an own property, which is inert here but not after anything
 *   merges it into another object.
 * - **Unbounded recursion.** Walking is depth-capped so a deeply nested body
 *   cannot exhaust the stack before the size check ever runs.
 */
function isSafeCondition(value: unknown, depth = 0): boolean {
  if (depth > MAX_WHEN_DEPTH) return false;
  if (value === null) return true;

  const type = typeof value;
  if (type === 'string') return (value as string).length <= 64;
  if (type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isSafeCondition(item, depth + 1));
  if (type !== 'object') return false;

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (!isShortString(key, MAX_ID)) return false;
    if (key.startsWith('$') || key.includes('.')) return false;
    if (FORBIDDEN_KEYS.has(key)) return false;
    if (!isSafeCondition(inner, depth + 1)) return false;
  }
  return true;
}

function parseRules(value: unknown): StrategyRuleInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RULES) return null;

  const rules: StrategyRuleInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const r = item as Record<string, unknown>;

    if (!isShortString(r.id, MAX_ID)) return null;
    if (typeof r.enabled !== 'boolean') return null;
    if (!isShortString(r.card, MAX_ID)) return null;
    if (!isShortString(r.at, MAX_ID)) return null;
    if (!isSafeCondition(r.when)) return null;
    if (JSON.stringify(r.when ?? null).length > MAX_WHEN_BYTES) return null;

    rules.push({ id: r.id, enabled: r.enabled, card: r.card, when: r.when, at: r.at });
  }
  return rules;
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
    const deck = parseIdList(l.deck, MAX_DECK);
    if (!squad || !deck) return null;

    const s = (l.strategy ?? {}) as Record<string, unknown>;
    if (typeof s.version !== 'number' || !Number.isInteger(s.version)) return null;
    if (s.name !== undefined && (typeof s.name !== 'string' || s.name.length > MAX_NAME)) return null;
    const rules = parseRules(s.rules);
    if (!rules) return null;

    parsed.push({
      id: l.id,
      name: l.name,
      squad,
      deck,
      strategy: { version: s.version, name: (s.name as string) ?? '', rules },
    });
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
      error: `loadouts must be at most ${MAX_LOADOUTS} profiles of { id, name, squad, deck, strategy }`,
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
