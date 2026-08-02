import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { registerUser } from '../test/helpers.js';

const app = createApp();

function samplePayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    mode: 'sp-vs-ai',
    won: true,
    kills: 3,
    deaths: 1,
    score: 420,
    difficulty: 'normal',
    timeSeconds: 95,
    livesSpent: 1,
    map: 'arena1.json',
    elements: [{ elementId: 'fire', casts: 10, hits: 6, kills: 3, damageDealt: 180 }],
    ...overrides,
  };
}

describe('POST /api/matches', () => {
  it('accepts a match log authenticated with the caller own JWT', async () => {
    const { token } = await registerUser(app);
    const res = await request(app).post('/api/matches').set('Authorization', `Bearer ${token}`).send(samplePayload());
    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
  });

  it('accepts a match log authenticated with the server API key and an explicit userId', async () => {
    const { userId } = await registerUser(app);
    const res = await request(app)
      .post('/api/matches')
      .set('X-Api-Key', config.matchIngestApiKey)
      .send(samplePayload({ userId, mode: 'pvp' }));
    expect(res.status).toBe(201);
  });

  it('rejects an invalid API key', async () => {
    const { userId } = await registerUser(app);
    const res = await request(app)
      .post('/api/matches')
      .set('X-Api-Key', 'not-the-real-key')
      .send(samplePayload({ userId }));
    expect(res.status).toBe(401);
  });

  it('rejects a request with neither JWT nor API key', async () => {
    const res = await request(app).post('/api/matches').send(samplePayload());
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload', async () => {
    const { token } = await registerUser(app);
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${token}`)
      .send(samplePayload({ difficulty: 'nightmare' }));
    expect(res.status).toBe(400);
  });
});
