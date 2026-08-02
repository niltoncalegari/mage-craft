import request from 'supertest';
import type { Express } from 'express';

let counter = 0;

/** Registers a fresh user against the given app and returns its token + id. */
export async function registerUser(app: Express): Promise<{ token: string; userId: string; username: string }> {
  counter += 1;
  const username = `player_${counter}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'hunter22' });
  return { token: res.body.token as string, userId: res.body.user.id as string, username };
}
