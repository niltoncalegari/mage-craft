import { describe, expect, it } from 'vitest';
import { Arena, type Obstacle } from '../Arena';
import { SIM_DT } from '../config';
import { TEAM_A, TEAM_B, type MageInput, type Projectile } from '../entities';
import { Rng } from '../rng';
import { Vec2 } from '../Vec2';
import { World } from '../World';
import { Brain, ENGAGE_RANGE, TUNINGS, type Difficulty } from './Brain';

/**
 * A world on a bare rectangle, so these AI unit tests — which place mages at
 * explicit coordinates — aren't perturbed by the default map's obstacles
 * blocking movement or line of sight. Cover seeking is covered separately with
 * an explicit obstacle.
 */
function combatWorld(): World {
  return new World(new Arena(24, 16));
}

function rng(): Rng {
  return new Rng(1);
}

/** One tick of the brain; returns the input it wrote. */
function decideOnce(w: World, botId: string, d: Difficulty): MageInput {
  new Brain(rng()).step(w, new Map([[botId, d]]), SIM_DT);
  const mage = w.mage(botId);
  if (!mage) throw new Error(`no mage ${botId}`);
  return mage.input;
}

describe('Brain — decisions', () => {
  it('wanders with a real move vector when there are no enemies', () => {
    const w = combatWorld();
    w.addMage('bot1', TEAM_A, 'fire', true).position = new Vec2(1, 0);

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.move.lengthSq()).toBeGreaterThan(0.5);
    expect(input.charging).toBe(false);
    expect(input.release).toBe(false);
  });

  it('retreats away from the target at critical health', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(3, 0);
    // Retreat only outscores attacking once health is critical (attack scores
    // 0.95; retreat peaks at 1.1) — the same crossover as the client.
    bot.health = bot.maxHealth * 0.05;

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.move.x).toBeLessThan(0);
    expect(input.charging).toBe(false);
    expect(input.release).toBe(false);
  });

  it('charges an attack at an in-range target when off cooldown', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(ENGAGE_RANGE - 1, 0);

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.charging).toBe(true);
    expect(input.aim.distanceTo(target.position)).toBeLessThan(ENGAGE_RANGE * 0.5);
  });

  it('leads a moving target', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(ENGAGE_RANGE - 1, 0);
    target.velocity = new Vec2(0, 6); // sprinting in +Y

    const input = decideOnce(w, 'bot1', 'hard');

    expect(input.charging).toBe(true);
    expect(input.aim.y).toBeGreaterThan(0);
  });

  /*
   * The point of the whole move/aim split: you can always walk and throw in the
   * original game, so a mage that has picked a target must not root itself to
   * line the shot up. Standing still read as the AI freezing, and it made the
   * squads free hits.
   */
  it('keeps moving while it shoots', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(ENGAGE_RANGE - 2, 0);

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.charging).toBe(true);
    expect(input.move.lengthSq()).toBeGreaterThan(0.5);
  });

  it('circles the target it is shooting at rather than closing on it', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(ENGAGE_RANGE - 2, 0);

    const move = decideOnce(w, 'bot1', 'normal').move.normalized();

    // Perpendicular to the target: neither charging in nor backing off.
    expect(Math.abs(move.dot(new Vec2(1, 0)))).toBeLessThan(0.35);
  });

  it('backs off as it circles a target too close to throw at', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(0.8, 0);

    const move = decideOnce(w, 'bot1', 'normal').move;

    expect(move.x).toBeLessThan(0);
  });

  it('advances instead of attacking when the target is out of range', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = new Vec2(-10, 0);
    target.position = new Vec2(10, 0);

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.charging).toBe(false);
    expect(input.move.x).toBeGreaterThan(0);
  });
});

describe('Brain — charge handling', () => {
  it('releases once charge reaches the difficulty threshold', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(3, 0);
    bot.position = Vec2.zero;
    bot.charging = true;
    bot.charge = TUNINGS.normal.releaseChargeMin;

    expect(decideOnce(w, 'bot1', 'normal').release).toBe(true);
  });

  it('keeps holding below the threshold', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(3, 0);
    bot.position = Vec2.zero;
    bot.charging = true;
    bot.charge = 0.1;

    const input = decideOnce(w, 'bot1', 'normal');
    expect(input.release).toBe(false);
    expect(input.charging).toBe(true);
  });

  // A charging bot must still be able to walk — the same rule that applies to
  // human players (see World.test.ts).
  it('keeps advancing while charging', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = new Vec2(-10, 0);
    target.position = new Vec2(10, 0); // out of range, so it wants to advance
    bot.charging = true;
    bot.charge = 0.1;

    expect(decideOnce(w, 'bot1', 'normal').move.lengthSq()).toBeGreaterThan(0);
  });
});

describe('Brain — dodging', () => {
  it('sidesteps an incoming projectile', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = Vec2.zero;
    target.position = new Vec2(10, 0);
    w.projectiles.set('shot1', {
      id: 'shot1',
      ownerId: target.id,
      team: TEAM_B,
      element: 'fire',
      position: new Vec2(2, 0),
      velocity: new Vec2(-5, 0), // flying straight at the bot
      height: 1,
      heightVelocity: 0,
      gravity: 18,
      damage: 20,
      knockback: 3.5,
      radius: 0.22,
      age: 0,
      alive: true,
    });

    const input = decideOnce(w, 'bot1', 'normal');

    expect(input.move.lengthSq()).toBeGreaterThan(0.5);
    // Perpendicular to the incoming shot, not into or away from it.
    expect(Math.abs(input.move.x)).toBeLessThanOrEqual(0.5);
  });

  it('ignores far and receding projectiles', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    bot.position = new Vec2(-10, 0);
    target.position = new Vec2(10, 0);

    const base: Omit<Projectile, 'id' | 'position' | 'velocity'> = {
      element: 'fire',
      ownerId: target.id,
      team: TEAM_B,
      height: 1,
      heightVelocity: 0,
      gravity: 18,
      damage: 20,
      knockback: 3.5,
      radius: 0.22,
      age: 0,
      alive: true,
    };
    w.projectiles.set('far', {
      ...base,
      id: 'far',
      position: new Vec2(5, 0),
      velocity: new Vec2(-5, 0),
    });
    w.projectiles.set('receding', {
      ...base,
      id: 'receding',
      position: new Vec2(-9, 0),
      velocity: new Vec2(5, 0),
    });

    expect(decideOnce(w, 'bot1', 'normal').move.x).toBeGreaterThan(0);
  });
});

describe('Brain — difficulty and cover', () => {
  // Easy bots deliberately stay exposed: they never retreat or seek cover.
  it('never retreats on easy', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(3, 0);
    bot.position = Vec2.zero;
    bot.health = bot.maxHealth * 0.05;

    for (let i = 0; i < 20; i++) {
      expect(decideOnce(w, 'bot1', 'easy').move.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('heads for cover behind an obstacle rather than straight away', () => {
    const rock: Obstacle = {
      type: 'rock',
      position: new Vec2(-3, 3),
      isRect: false,
      radius: 0.6,
      halfW: 0,
      halfH: 0,
      blocksSight: true,
      blocksProjectiles: true,
      blocksMovement: true,
      topHeight: 1,
    };
    const w = new World(new Arena(24, 16, [rock]));
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(5, 0);
    bot.position = Vec2.zero;
    bot.health = bot.maxHealth * 0.05;

    // The only cover sits up and to the left, so the bot should move that way
    // instead of straight along -X.
    expect(decideOnce(w, 'bot1', 'normal').move.y).toBeGreaterThan(0);
  });
});

describe('Brain — getting unstuck', () => {
  const rock = (position: Vec2, radius: number): Obstacle => ({
    type: 'rock',
    position,
    isRect: false,
    radius,
    halfW: 0,
    halfH: 0,
    blocksSight: true,
    blocksProjectiles: true,
    blocksMovement: true,
    topHeight: 1,
  });

  /*
   * The backstop behind every steering rule: a mage that somehow ends up inside
   * geometry has no clear step in any direction, so it needs to notice it has
   * stopped moving and walk itself out rather than lean on its plan forever.
   */
  it('walks out of an obstacle it is wedged inside instead of pursuing its target', () => {
    const w = new World(new Arena(24, 16, [rock(Vec2.zero, 1.2)]));
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    // Inside the rock, offset toward +X — the short way out.
    bot.position = new Vec2(0.3, 0);
    // Far off to the left, so the bot's own plan is to walk the other way.
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(-11, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);

    // The world is never stepped, so the bot never moves — which is exactly
    // what being wedged looks like from the brain's side.
    let escaped = false;
    for (let tick = 0; tick < 120 && !escaped; tick++) {
      brain.step(w, bots, SIM_DT);
      escaped = bot.input.move.x > 0.5;
    }

    expect(escaped).toBe(true);
  });

  /*
   * Mages don't block each other — the sim pushes overlapping ones apart — but
   * two walking head-on jam in place for seconds, which looks exactly like
   * being stuck on scenery. They have to pass on a side.
   */
  it('steps around a mage standing directly in its path', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    bot.position = new Vec2(-11, 0);
    // Its target is straight ahead and far off; an ally is parked in between.
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(11, 0);
    w.addMage('bot2', TEAM_A, 'fire', true).position = new Vec2(-9.5, 0);

    const move = decideOnce(w, 'bot1', 'normal').move;

    expect(move.x).toBeGreaterThan(0);
    expect(Math.abs(move.y)).toBeGreaterThan(0.2);
  });

  it('does not trigger an escape while it is making progress', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(11, 0);
    bot.position = new Vec2(-11, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);

    for (let tick = 0; tick < 90; tick++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      expect(bot.input.move.x, `tick ${tick}`).toBeGreaterThan(0);
    }
  });
});

describe('Brain — per-bot state', () => {
  it('writes an input for every bot it is given', () => {
    const w = combatWorld();
    const b1 = w.addMage('bot1', TEAM_A, 'fire', true);
    const b2 = w.addMage('bot2', TEAM_A, 'ice', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(ENGAGE_RANGE - 1, 0);
    b1.position = Vec2.zero;
    b2.position = new Vec2(0, 2);

    new Brain(rng()).step(
      w,
      new Map<string, Difficulty>([
        ['bot1', 'normal'],
        ['bot2', 'normal'],
      ]),
      SIM_DT,
    );

    for (const b of [b1, b2]) {
      expect(b.input.charging || b.input.move.lengthSq() > 0, b.id).toBe(true);
    }
  });

  // The decision interval is what stops bots re-deciding every tick, so the
  // brain has to keep per-bot state between steps.
  it('holds decisions between ticks', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(4, 0);
    bot.position = Vec2.zero;

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);

    brain.step(w, bots, SIM_DT);
    const first = brain.states.get('bot1')?.decisionTimer ?? 0;
    brain.step(w, bots, SIM_DT);
    const second = brain.states.get('bot1')?.decisionTimer ?? 0;

    expect(second).toBeLessThan(first);
  });
});
