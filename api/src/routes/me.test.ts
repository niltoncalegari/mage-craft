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

const SQUAD_A = ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'];
const SQUAD_B = ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'];

describe('GET /api/me/stats/squads', () => {
  it('ranks compositions by win rate, ignoring the order they were picked in', async () => {
    const { token } = await registerUser(app);
    // Squad A: 2 games, 1 win — and the second one lists the same mages shuffled.
    await reportMatch(token, { won: true, squad: SQUAD_A, structuresDestroyed: 3 });
    await reportMatch(token, { won: false, squad: [...SQUAD_A].reverse(), structuresDestroyed: 1 });
    // Squad B: 2 games, 2 wins.
    await reportMatch(token, { won: true, squad: SQUAD_B, structuresDestroyed: 4 });
    await reportMatch(token, { won: true, squad: SQUAD_B, structuresDestroyed: 2 });

    const res = await request(app).get('/api/me/stats/squads').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.squads).toHaveLength(2);
    expect(res.body.squads[0]).toMatchObject({ games: 2, wins: 2, winRate: 1, structuresDestroyed: 6 });
    expect(res.body.squads[0].squad).toEqual([...SQUAD_B].sort());
    expect(res.body.squads[1]).toMatchObject({ games: 2, wins: 1, winRate: 0.5 });
    expect(res.body.squads[1].signature).toBe([...SQUAD_A].sort().join('+'));
  });

  it('hides a comp played only once, and matches logged without a squad', async () => {
    const { token } = await registerUser(app);
    await reportMatch(token, { won: true, squad: SQUAD_A });
    await reportMatch(token, { won: true }); // pre-builder log, no squad

    const res = await request(app).get('/api/me/stats/squads').set('Authorization', `Bearer ${token}`);

    expect(res.body.squads).toEqual([]);
  });
});

describe('GET /api/me/stats/cards', () => {
  it('sums casts per card across matches, most-cast first', async () => {
    const { token } = await registerUser(app);
    await reportMatch(token, {
      cards: [
        { cardId: 'plague', casts: 3 },
        { cardId: 'blessing', casts: 1 },
      ],
    });
    await reportMatch(token, { cards: [{ cardId: 'blessing', casts: 5 }] });

    const res = await request(app).get('/api/me/stats/cards').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([
      { cardId: 'blessing', casts: 6 },
      { cardId: 'plague', casts: 3 },
    ]);
  });
});
