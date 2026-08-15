import { Router } from 'express';
import { Types } from 'mongoose';
import { applyEloDelta, computeEloDelta } from '../aggregations/elo.js';
import { requireAuthOrApiKey } from '../middleware/apiKey.js';
import { MatchLog } from '../models/MatchLog.js';
import { User } from '../models/User.js';
import type { AuthedRequest } from '../types.js';

export const matchesRouter = Router();

const MODES = new Set(['sp-vs-ai', 'pvp']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

interface CardUsageInput {
  cardId: string;
  casts: number;
}

interface ElementUsageInput {
  elementId: string;
  casts: number;
  hits: number;
  kills: number;
  damageDealt: number;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseElements(value: unknown): ElementUsageInput[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: ElementUsageInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const e = item as Record<string, unknown>;
    if (
      typeof e.elementId !== 'string' ||
      !isNonNegativeNumber(e.casts) ||
      !isNonNegativeNumber(e.hits) ||
      !isNonNegativeNumber(e.kills) ||
      !isNonNegativeNumber(e.damageDealt)
    ) {
      return null;
    }
    parsed.push({
      elementId: e.elementId,
      casts: e.casts,
      hits: e.hits,
      kills: e.kills,
      damageDealt: e.damageDealt,
    });
  }
  return parsed;
}

/** The squad this match was played with. Absent is fine — older clients send none. */
function parseSquad(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((id) => typeof id !== 'string' || id.length === 0)) return null;
  return value as string[];
}

function parseCards(value: unknown): CardUsageInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed: CardUsageInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const c = item as Record<string, unknown>;
    if (typeof c.cardId !== 'string' || !isNonNegativeNumber(c.casts)) return null;
    parsed.push({ cardId: c.cardId, casts: c.casts });
  }
  return parsed;
}

matchesRouter.post('/', requireAuthOrApiKey, async (req: AuthedRequest, res) => {
  const body = req.body as Record<string, unknown>;

  let userId: string;
  if (req.isServerCaller) {
    if (typeof body.userId !== 'string' || !Types.ObjectId.isValid(body.userId)) {
      res.status(400).json({ error: 'userId is required and must be a valid id when authenticating with an API key' });
      return;
    }
    userId = body.userId;
  } else {
    userId = req.userId!;
  }

  if (typeof body.mode !== 'string' || !MODES.has(body.mode)) {
    res.status(400).json({ error: 'mode must be "sp-vs-ai" or "pvp"' });
    return;
  }
  if (typeof body.won !== 'boolean') {
    res.status(400).json({ error: 'won must be a boolean' });
    return;
  }
  if (typeof body.difficulty !== 'string' || !DIFFICULTIES.has(body.difficulty)) {
    res.status(400).json({ error: 'difficulty must be "easy", "normal" or "hard"' });
    return;
  }
  if (typeof body.map !== 'string' || body.map.length === 0) {
    res.status(400).json({ error: 'map is required' });
    return;
  }
  for (const field of ['kills', 'deaths', 'score', 'timeSeconds', 'livesSpent'] as const) {
    if (!isNonNegativeNumber(body[field])) {
      res.status(400).json({ error: `${field} must be a non-negative number` });
      return;
    }
  }
  const elements = parseElements(body.elements);
  if (!elements) {
    res.status(400).json({ error: 'elements must be an array of { elementId, casts, hits, kills, damageDealt }' });
    return;
  }
  const squad = parseSquad(body.squad);
  if (!squad) {
    res.status(400).json({ error: 'squad must be an array of mage ids' });
    return;
  }
  const cards = parseCards(body.cards);
  if (!cards) {
    res.status(400).json({ error: 'cards must be an array of { cardId, casts }' });
    return;
  }
  if (body.structuresDestroyed !== undefined && !isNonNegativeNumber(body.structuresDestroyed)) {
    res.status(400).json({ error: 'structuresDestroyed must be a non-negative number' });
    return;
  }
  if (body.opponentRating !== undefined && !isNonNegativeNumber(body.opponentRating)) {
    res.status(400).json({ error: 'opponentRating must be a non-negative number' });
    return;
  }

  const match = await MatchLog.create({
    userId,
    mode: body.mode,
    won: body.won,
    kills: body.kills,
    deaths: body.deaths,
    score: body.score,
    difficulty: body.difficulty,
    timeSeconds: body.timeSeconds,
    livesSpent: body.livesSpent,
    map: body.map,
    elements,
    squad,
    cards,
    structuresDestroyed: body.structuresDestroyed ?? 0,
  });

  // Rating only moves for real PvP against another rated account — never for
  // sp-vs-ai/practice, and never when the reporting client omits an opponent
  // rating (a bot opponent has none). The server owns the arithmetic; it only
  // trusts the opponent's rating value, same as it already trusts kills/deaths.
  let rating: number | undefined;
  if (body.mode === 'pvp' && typeof body.opponentRating === 'number') {
    const user = await User.findById(userId, { rating: 1 });
    if (user) {
      const delta = computeEloDelta(user.rating, body.opponentRating, body.won);
      rating = applyEloDelta(user.rating, delta);
      user.rating = rating;
      await user.save();
    }
  }

  res.status(201).json({ id: match._id.toString(), rating });
});
