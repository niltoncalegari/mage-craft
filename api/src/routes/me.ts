import { Router } from 'express';
import { getUserCardStats, getUserElementStats, getUserSquadStats, getUserSummary } from '../aggregations/stats.js';
import { requireAuth } from '../middleware/auth.js';
import { MatchLog } from '../models/MatchLog.js';
import { User } from '../models/User.js';
import type { AuthedRequest } from '../types.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', async (req: AuthedRequest, res) => {
  const user = await User.findById(req.userId, { username: 1, email: 1, createdAt: 1 }).lean();
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  const summary = await getUserSummary(req.userId!);
  res.json({
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    stats: summary,
  });
});

meRouter.get('/matches', async (req: AuthedRequest, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const matches = await MatchLog.find({ userId: req.userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  res.json({ page, limit, matches });
});

meRouter.get('/stats/elements', async (req: AuthedRequest, res) => {
  const elements = await getUserElementStats(req.userId!);
  res.json({ elements });
});

meRouter.get('/stats/squads', async (req: AuthedRequest, res) => {
  const squads = await getUserSquadStats(req.userId!);
  res.json({ squads });
});

meRouter.get('/stats/cards', async (req: AuthedRequest, res) => {
  const cards = await getUserCardStats(req.userId!);
  res.json({ cards });
});
