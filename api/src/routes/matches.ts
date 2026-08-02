import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuthOrApiKey } from '../middleware/apiKey.js';
import { MatchLog } from '../models/MatchLog.js';
import type { AuthedRequest } from '../types.js';

export const matchesRouter = Router();

const MODES = new Set(['sp-vs-ai', 'pvp']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

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
  });

  res.status(201).json({ id: match._id.toString() });
});
