import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { registerUser } from '../test/helpers.js';

const app = createApp();

async function reportMatch(
  token: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<void> {
  await request(app)
    .post('/api/matches')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mode: 'sp-vs-ai',
      won: true,
      kills: 3,
      deaths: 1,
      score: 100,
      difficulty: 'normal',
      timeSeconds: 60,
      livesSpent: 1,
      map: 'arena1.json',
      elements: [{ elementId: 'fire', casts: 5, hits: 3, kills: 3, damageDealt: 90 }],
      ...overrides,
    });
}

describe('GET /api/me', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns profile and aggregated stats across matches', async () => {
    const { token, username } = await registerUser(app);
    await reportMatch(token, { won: true, kills: 3, deaths: 1 });
    await reportMatch(token, { won: false, kills: 1, deaths: 2, elements: [{ elementId: 'ice', casts: 2, hits: 1, kills: 1, damageDealt: 20 }] });

    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(username);
    expect(res.body.stats).toMatchObject({
      matchesPlayed: 2,
      wins: 1,
      losses: 1,
      kills: 4,
      deaths: 3,
      favoriteElement: 'fire',
    });
    expect(res.body.stats.kdr).toBeCloseTo(4 / 3, 5);
  });
});

describe('GET /api/me/matches', () => {
  it('returns the match history, most recent first', async () => {
    const { token } = await registerUser(app);
    await reportMatch(token, { score: 100 });
    await reportMatch(token, { score: 200 });

    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(2);
    expect(res.body.matches[0].score).toBe(200);
  });
});

describe('GET /api/me/stats/elements', () => {
  it('aggregates casts/hits/kills/damage per element across matches', async () => {
    const { token } = await registerUser(app);
    await reportMatch(token, { elements: [{ elementId: 'fire', casts: 5, hits: 3, kills: 2, damageDealt: 90 }] });
    await reportMatch(token, { elements: [{ elementId: 'fire', casts: 4, hits: 2, kills: 1, damageDealt: 40 }] });

    const res = await request(app).get('/api/me/stats/elements').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.elements).toEqual([{ elementId: 'fire', casts: 9, hits: 5, kills: 3, damageDealt: 130 }]);
  });
});
