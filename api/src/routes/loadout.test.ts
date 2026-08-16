/**
 * The loadout endpoints, including the parts that exist because the body has a
 * free-form corner in it.
 *
 * A rule's condition is stored opaquely (this service cannot import the game's
 * rule vocabulary), so everything that would normally be caught by a schema has
 * to be caught by hand here: size, depth, and the two families of key that turn
 * a stored document into an operator or a prototype.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { registerUser } from '../test/helpers.js';

const app = createApp();

const SQUAD = ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'];
const DECK = [
  'blessing',
  'blessing',
  'arcane_shield',
  'arcane_shield',
  'plague',
  'plague',
  'sticky_swamp',
  'sticky_swamp',
];

function loadout(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'default',
    name: 'Padrão',
    squad: SQUAD,
    deck: DECK,
    strategy: {
      version: 1,
      name: 'Padrão',
      rules: [
        {
          id: 'answer-cluster',
          enabled: true,
          card: 'plague',
          when: { kind: 'enemy_cluster', op: 'gte', value: 2 },
          at: 'enemy_cluster',
        },
      ],
    },
    ...over,
  };
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

  it('stores a loadout and reads it back whole, condition included', async () => {
    const { token } = await registerUser(app);

    const saved = await put(token, { loadouts: [loadout()], activeLoadoutId: 'default' });
    expect(saved.status).toBe(200);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body.activeLoadoutId).toBe('default');
    expect(res.body.loadouts).toHaveLength(1);
    expect(res.body.loadouts[0].deck).toEqual(DECK);
    // The opaque half has to survive the round trip byte for byte: it is the
    // program, and the game server is what will read it.
    expect(res.body.loadouts[0].strategy.rules[0].when).toEqual({
      kind: 'enemy_cluster',
      op: 'gte',
      value: 2,
    });
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

  it('caps how many rules a program may hold', async () => {
    const { token } = await registerUser(app);
    const rules = Array.from({ length: 13 }, (_, i) => ({
      id: `r${i}`,
      enabled: true,
      card: 'plague',
      when: { kind: 'always' },
      at: 'enemy_cluster',
    }));

    const res = await put(token, {
      loadouts: [loadout({ strategy: { version: 1, name: 'x', rules } })],
    });

    expect(res.status).toBe(400);
  });
});

/*
 * The condition is the only part of the body with no fixed shape, which makes
 * it the only part a client could use to store volume, reach the stack, or
 * smuggle a key that means something to Mongo or to Object.prototype.
 */
describe('PUT /api/me/loadout — the free-form condition', () => {
  function withCondition(when: unknown): Record<string, unknown> {
    return {
      loadouts: [
        loadout({
          strategy: {
            version: 1,
            name: 'x',
            rules: [{ id: 'r1', enabled: true, card: 'plague', when, at: 'enemy_cluster' }],
          },
        }),
      ],
    };
  }

  it('refuses a condition bigger than the cap', async () => {
    const { token } = await registerUser(app);
    const fat = { kind: 'always', padding: 'x'.repeat(600) };

    expect((await put(token, withCondition(fat))).status).toBe(400);
  });

  it('refuses a condition nested past the walk depth', async () => {
    const { token } = await registerUser(app);
    let bomb: unknown = { kind: 'always' };
    for (let i = 0; i < 20; i++) bomb = { kind: 'not', of: bomb };

    expect((await put(token, withCondition(bomb))).status).toBe(400);
  });

  it('refuses a Mongo operator key', async () => {
    const { token } = await registerUser(app);

    // `$gt` inside a stored document is how it later becomes a query nobody wrote.
    expect((await put(token, withCondition({ $gt: 1 }))).status).toBe(400);
    expect((await put(token, withCondition({ 'a.b': 1 }))).status).toBe(400);
  });

  it('refuses a prototype-pollution key, and leaves the prototype alone', async () => {
    const { token } = await registerUser(app);

    // Sent as raw JSON: an object literal would set the prototype rather than
    // create the own property that JSON.parse produces, which is the real shape.
    const res = await request(app)
      .put('/api/me/loadout')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(withCondition(JSON.parse('{"__proto__": {"polluted": true}}'))));

    expect(res.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a legal nested group, which is what the editor actually writes', async () => {
    const { token } = await registerUser(app);
    const group = {
      kind: 'all',
      of: [{ kind: 'intruder' }, { kind: 'not', of: { kind: 'mana', op: 'lt', value: 5 } }],
    };

    expect((await put(token, withCondition(group))).status).toBe(200);

    const res = await request(app).get('/api/me/loadout').set('Authorization', `Bearer ${token}`);
    expect(res.body.loadouts[0].strategy.rules[0].when).toEqual(group);
  });
});
