/**
 * The loadout endpoints, including the parts that exist because the body has an
 * open-ended corner in it.
 *
 * The postures are stored as a map whose *keys* this service cannot enumerate —
 * it has no access to the roster catalog — so everything a schema would
 * normally catch has to be caught by hand: how many, how long, and the two
 * families of key that turn a stored document into an operator or a prototype.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { registerUser } from '../test/helpers.js';

const app = createApp();

const SQUAD = ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'];
const STANCES = { stone_golem: 'hold', pyromancer: 'aggressive' };

function loadout(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'default', name: 'Padrão', squad: SQUAD, stances: STANCES, ...over };
}

function put(token: string, body: unknown): request.Test {
  return request(app).put('/api/me/loadout').set('Authorization', `Bearer ${token}`).send(body as object);
}

describe('GET /api/me/loadout', () => {
  it('rejects requests without a token', async () => {
    expect((await request(app).get('/api/me/loadout')).status).toBe(401);
  });

  it('is empty for an account that has never saved one', async () => {
    const { token } = await registerUser(app);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loadouts: [], activeLoadoutId: null });
  });
});

describe('PUT /api/me/loadout', () => {
  it('rejects requests without a token', async () => {
    expect((await request(app).put('/api/me/loadout').send({ loadouts: [] })).status).toBe(401);
  });

  it('stores a loadout and reads it back whole, postures included', async () => {
    const { token } = await registerUser(app);

    const saved = await put(token, { loadouts: [loadout()], activeLoadoutId: 'default' });
    expect(saved.status).toBe(200);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body.activeLoadoutId).toBe('default');
    expect(res.body.loadouts).toHaveLength(1);
    expect(res.body.loadouts[0].squad).toEqual(SQUAD);
    // The half this service cannot read has to survive the round trip key for
    // key: the game server is what will decide what any of it means.
    expect(res.body.loadouts[0].stances).toEqual(STANCES);
  });

  it('accepts a loadout with no postures at all', async () => {
    const { token } = await registerUser(app);

    // What a player who never opened the builder sends. Absent is `normal`
    // everywhere, and refusing it would make the default unsendable.
    const res = await put(token, { loadouts: [loadout({ stances: undefined })] });

    expect(res.status).toBe(200);
  });

  it('replaces wholesale rather than merging', async () => {
    const { token } = await registerUser(app);
    await put(token, {
      loadouts: [loadout(), loadout({ id: 'aggro', name: 'Aggro' })],
      activeLoadoutId: 'aggro',
    });

    await put(token, { loadouts: [loadout({ id: 'aggro', name: 'Aggro' })], activeLoadoutId: 'aggro' });

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body.loadouts.map((l: { id: string }) => l.id)).toEqual(['aggro']);
  });

  it('accepts an empty list, which is how a player clears the account copy', async () => {
    const { token } = await registerUser(app);
    await put(token, { loadouts: [loadout()], activeLoadoutId: 'default' });

    expect((await put(token, { loadouts: [], activeLoadoutId: null })).status).toBe(200);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ loadouts: [], activeLoadoutId: null });
  });

  it('refuses an active id that names no submitted loadout', async () => {
    const { token } = await registerUser(app);

    // Otherwise the account reads back pointing at a profile that is not there.
    const res = await put(token, { loadouts: [loadout()], activeLoadoutId: 'ghost' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/activeLoadoutId/);
  });

  it('refuses duplicate loadout ids', async () => {
    const { token } = await registerUser(app);
    expect((await put(token, { loadouts: [loadout(), loadout()] })).status).toBe(400);
  });

  it('caps how many profiles an account may hold', async () => {
    const { token } = await registerUser(app);
    const many = Array.from({ length: 6 }, (_, i) => loadout({ id: `l${i}` }));

    expect((await put(token, { loadouts: many })).status).toBe(400);
  });

  it('caps how many postures a profile may hold', async () => {
    const { token } = await registerUser(app);
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`m${i}`, 'hold']));

    expect((await put(token, { loadouts: [loadout({ stances: many })] })).status).toBe(400);
  });
});

/*
 * The posture map is the only part of the body whose keys this service does not
 * control, which makes it the only part a client could use to store volume or
 * to smuggle a key that means something to Mongo or to Object.prototype. It
 * lands in a Mongoose `Map`, whose keys are written through verbatim.
 */
describe('PUT /api/me/loadout — the open-ended posture map', () => {
  function withStances(stances: unknown): Record<string, unknown> {
    return { loadouts: [loadout({ stances })] };
  }

  it('refuses a value longer than an id could be', async () => {
    const { token } = await registerUser(app);

    expect((await put(token, withStances({ cleric: 'x'.repeat(64) }))).status).toBe(400);
  });

  it('refuses a Mongo operator key', async () => {
    const { token } = await registerUser(app);

    // `$gt` inside a stored document is how it later becomes a query nobody wrote.
    expect((await put(token, withStances({ $gt: 'hold' }))).status).toBe(400);
    expect((await put(token, withStances({ 'a.b': 'hold' }))).status).toBe(400);
  });

  it('refuses a prototype-pollution key, and leaves the prototype alone', async () => {
    const { token } = await registerUser(app);

    // Sent as raw JSON: an object literal would set the prototype rather than
    // create the own property that JSON.parse produces, which is the real shape.
    const res = await request(app)
      .put('/api/me/loadout')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(withStances(JSON.parse('{"__proto__": "hold"}'))));

    expect(res.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a map whose values are not strings', async () => {
    const { token } = await registerUser(app);

    expect((await put(token, withStances({ cleric: { nested: true } }))).status).toBe(400);
    expect((await put(token, withStances(['hold']))).status).toBe(400);
  });

  it('keeps an unknown-but-well-formed posture, and lets the game server judge it', async () => {
    const { token } = await registerUser(app);

    // This service cannot know `berserk` is not a stance, and must not pretend
    // to: storing it and letting `resolveStances` refuse it at match time is
    // the split the whole module is built on.
    expect((await put(token, withStances({ cleric: 'berserk' }))).status).toBe(200);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body.loadouts[0].stances).toEqual({ cleric: 'berserk' });
  });
});
