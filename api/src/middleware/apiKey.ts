import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthedRequest } from '../types.js';

interface AccessTokenPayload {
  sub: string;
}

/**
 * Accepts either a user JWT (today: the client reporting its own SP-vs-AI
 * matches) or the server-to-server `X-Api-Key` (future: the Go match server
 * reporting PvP matches without a per-user JWT). See
 * docs/accounts-ranking-dashboard.md §4.
 */
export function requireAuthOrApiKey(req: AuthedRequest, res: Response, next: NextFunction): void {
  const apiKey = req.header('x-api-key');
  if (apiKey) {
    if (apiKey !== config.matchIngestApiKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
    req.isServerCaller = true;
    next();
    return;
  }

  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing Authorization header or X-Api-Key' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
