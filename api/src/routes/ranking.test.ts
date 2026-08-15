import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { registerUser } from '../test/helpers.js';

const app = createApp();

async function reportMatch(token: string, won: boolean, kills: number, deaths: number): Promise<void> {
  await request(app)
    .post('/api/matches')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mode: 'sp-vs-ai',
      won,
      kills,
      deaths,
      score: 100,
      difficulty: 'normal',
      timeSeconds: 60,
      livesSpent: won ? 0 : 1,
      map: 'arena1.json',
      elements: [{ elementId: 'fire', casts: 5, hits: 3, kills, damageDealt: 90 }],
    });
}

describe('GET /api/ranking', () => {
  it('is accessible without auth and ranks players by rating by default', async () => {
    const top = await registerUser(app);
    const bottom = await registerUser(app);
    await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${top.token}`)
      .send({
        mode: 'pvp',
        won: true,
        kills: 5,
        deaths: 1,
        score: 100,
        difficulty: 'normal',
        timeSeconds: 60,
        livesSpent: 0,
        map: 'arena1.json',
        elements: [],
        opponentRating: 1200,
      });
    await reportMatch(bottom.token, true, 1, 3);

    const res = await request(app).get('/api/ranking');
    expect(res.status).toBe(200);
    expect(res.body.entries[0].username).toBe(top.username);
    expect(res.body.entries[0].rating).toBeGreaterThan(res.body.entries[1].rating);
  });

  it('ranks by wins when sort=wins', async () => {
    const top = await registerUser(app);
    const bottom = await registerUser(app);
    await reportMatch(top.token, true, 5, 1);
    await reportMatch(top.token, true, 5, 1);
    await reportMatch(bottom.token, true, 1, 3);

    const res = await request(app).get('/api/ranking?sort=wins');
    expect(res.status).toBe(200);
    expect(res.body.entries[0].username).toBe(top.username);
    expect(res.body.entries[0].wins).toBe(2);
  });

  it('ranks by kdr when sort=kdr', async () => {
    const highKdr = await registerUser(app);
    const lowKdr = await registerUser(app);
    await reportMatch(highKdr.token, true, 10, 1);
    await reportMatch(lowKdr.token, true, 2, 10);

    const res = await request(app).get('/api/ranking?sort=kdr');
    expect(res.status).toBe(200);
    expect(res.body.entries[0].username).toBe(highKdr.username);
  });
});
