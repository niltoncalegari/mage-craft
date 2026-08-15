import { Router } from 'express';
import { getRanking } from '../aggregations/stats.js';

export const rankingRouter = Router();

rankingRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const sort = req.query.sort === 'kdr' ? 'kdr' : req.query.sort === 'wins' ? 'wins' : 'rating';

  const entries = await getRanking({ skip: (page - 1) * limit, limit, sort });
  res.json({ page, limit, sort, entries });
});
