import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { matchesRouter } from './routes/matches.js';
import { meRouter } from './routes/me.js';
import { rankingRouter } from './routes/ranking.js';

/** Builds the Express app without binding a port — used by both server.ts and tests. */
export function createApp(): Express {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/matches', matchesRouter);
  app.use('/api/ranking', rankingRouter);

  return app;
}
