import { describe, expect, it } from 'vitest';
import { Arena, type Obstacle } from '../Arena';
import { defaultSquad } from '../cards';
import { CORE_RADIUS, MAGE_RADIUS, SIM_DT } from '../config';
import {
  TEAM_A,
  TEAM_B,
  type MageInput,
  type Projectile,
  type Structure,
  type Team,
} from '../entities';
import { Rng } from '../rng';
import { ROLE_BEHAVIOR } from '../roles';
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

/** The living enemy Tower a mage at `from` is closest to. */
function closestTowerTo(w: World, from: Vec2): Structure {
  const towers = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower' && s.alive);
  if (towers.length === 0) throw new Error('no living enemy towers');
  return towers.reduce((best, s) =>
    from.distanceTo(s.position) < from.distanceTo(best.position) ? s : best,
  );
}

/** Test-only: structures expose readonly maxHealth, but scenarios need a longer siege. */
function padStructureHealth(s: Structure, hp: number): void {
  (s as { maxHealth: number }).maxHealth = hp;
  s.health = hp;
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
  // Easy bots deliberately stay exposed: they never break off to run or hide.
  // Asserted on the chosen action, not on the sign of the move — a shooting
  // mage works its range (see `footwork`), so backing up a step at knife range
  // is combat footwork on any difficulty, not a retreat.
  it('never retreats or takes cover on easy', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(3, 0);
    bot.position = Vec2.zero;
    bot.health = bot.maxHealth * 0.05;

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'easy']]);
    for (let i = 0; i < 20; i++) {
      brain.step(w, bots, SIM_DT);
      expect(brain.states.get('bot1')?.last.action).not.toBe('retreat');
      expect(brain.states.get('bot1')?.last.action).not.toBe('takeCover');
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

/**
 * Online bots used to walk the straight line to their destination and let the
 * physics sort it out, which parked whole squads inside a Tower or the Nexus.
 * They now plan on the same grid the physics blocks on (GDD §11).
 */
describe('Brain — pathfinding', () => {
  function block(position: Vec2, halfW: number, halfH: number): Obstacle {
    return {
      type: 'fort',
      position,
      isRect: true,
      radius: 0,
      halfW,
      halfH,
      blocksSight: true,
      blocksProjectiles: true,
      blocksMovement: true,
      topHeight: 1.3,
    };
  }

  it('walks out of a dead end instead of pressing into the wall', () => {
    // A pocket open only toward -X, with the target away to +X. Every one of
    // the old ±45°/±90° sidesteps is blocked here, so the pre-A* steering had
    // nothing left but to walk face-first into the wall forever.
    const w = new World(
      new Arena(24, 16, [
        block(new Vec2(0, 1.5), 2, 0.4),
        block(new Vec2(0, -1.5), 2, 0.4),
        block(new Vec2(1.6, 0), 0.4, 1.5),
      ]),
    );
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    bot.position = Vec2.zero;
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(10, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);
    for (let i = 0; i < 240; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    // Left through the pocket's mouth, over the top and down the far side —
    // it is on the target's side of the wall, not wedged against it.
    expect(bot.position.x).toBeGreaterThan(2);
    expect(w.isBlocked(bot.position)).toBe(false);
  });

  it('caches the route it is walking instead of re-planning every tick', () => {
    const w = new World(
      new Arena(24, 16, [
        block(new Vec2(0, 1.5), 2, 0.4),
        block(new Vec2(0, -1.5), 2, 0.4),
        block(new Vec2(1.6, 0), 0.4, 1.5),
      ]),
    );
    w.addMage('bot1', TEAM_A, 'fire', true).position = Vec2.zero;
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(10, 0);

    const brain = new Brain(rng());
    brain.step(w, new Map<string, Difficulty>([['bot1', 'normal']]), SIM_DT);

    const state = brain.states.get('bot1');
    expect(state?.path?.length).toBeGreaterThan(0);
  });
});

/**
 * The client throws in one call; a mage online holds the charge for over a
 * second. Standing still for it — which is what the port did — is most of the
 * match spent motionless, and reads as an AI with no plan at all.
 */
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

  it('walks out of an obstacle it is wedged inside instead of pursuing its target', () => {
    const w = new World(new Arena(24, 16, [rock(Vec2.zero, 1.2)]));
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    bot.position = new Vec2(0.3, 0);
    w.addMage('p1', TEAM_B, 'fire', false).position = new Vec2(-11, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);

    let escaped = false;
    for (let tick = 0; tick < 120 && !escaped; tick++) {
      brain.step(w, bots, SIM_DT);
      escaped = bot.input.move.x > 0.5;
    }

    expect(escaped).toBe(true);
  });

  it('steps around a mage standing directly in its path', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    bot.position = new Vec2(-11, 0);
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

describe('Brain — footwork', () => {
  function fight(botRole: 'fire', botAt: Vec2, targetAt: Vec2, ticks: number): { travelled: number; charged: boolean } {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, botRole, true);
    const target = w.addMage('p1', TEAM_B, botRole, false);
    bot.position = botAt;
    target.position = targetAt;

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);
    let travelled = 0;
    let charged = false;
    let previous = bot.position;
    for (let i = 0; i < ticks; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      travelled += bot.position.distanceTo(previous);
      previous = bot.position;
      charged ||= bot.charging;
    }
    return { travelled, charged };
  }

  it('keeps moving while it holds a charge instead of standing still', () => {
    const { travelled, charged } = fight('fire', Vec2.zero, new Vec2(ENGAGE_RANGE - 1, 0), 90);

    expect(charged).toBe(true);
    expect(travelled).toBeGreaterThan(2);
  });

  it('gives ground when a target closes inside its preferred range', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    const target = w.addMage('p1', TEAM_B, 'fire', false);
    // A damage mage wants 6.5; at 2 it is far too close for comfort.
    bot.position = Vec2.zero;
    target.position = new Vec2(2, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);
    for (let i = 0; i < 60; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    expect(bot.position.distanceTo(target.position)).toBeGreaterThan(2);
  });

  // Re-rolling a random direction every tick, which is what wandering used to
  // do, averages out to twitching in place.
  it('holds one wander destination instead of re-rolling every tick', () => {
    const w = combatWorld();
    const bot = w.addMage('bot1', TEAM_A, 'fire', true);
    bot.position = new Vec2(-6, 0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([['bot1', 'normal']]);
    const start = bot.position;
    for (let i = 0; i < 45; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    expect(brain.states.get('bot1')?.last.action).toBe('wander');
    expect(bot.position.distanceTo(start)).toBeGreaterThan(2);
  });
});

describe('Brain — siege', () => {
  // The tank's stopping point is measured from a structure's surface, so it has
  // to clear a body radius or the bot is asking to stand inside the Core.
  it('stops a tank clear of the Core it is hitting', () => {
    expect(ROLE_BEHAVIOR.tank.advanceStopDistance).toBeGreaterThan(CORE_RADIUS + MAGE_RADIUS);
  });

  /**
   * With nobody to fight, a squad must play the game: walk across the map and
   * break the enemy's structures. It used to mill about its own half instead —
   * orbiting a stand-off point that moved with it, hiding from enemies too far
   * away to shoot it, or grinding on the sliver of fence its own route ran into.
   */
  it('pushes the enemy structures when there is no one to fight', () => {
    const w = new World();
    w.initSquad(TEAM_A, defaultSquad());

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>();
    for (const m of w.mages.values()) bots.set(m.id, 'normal');
    const towers = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower');
    const startX = [...w.mages.values()].map((m) => m.position.x);

    for (let i = 0; i < 60 * 30; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    // Everyone crossed into the enemy half instead of milling around at home…
    for (const m of w.mages.values()) {
      expect(m.position.x, `${m.id} never left its own half`).toBeGreaterThan(0);
    }
    expect(Math.max(...startX)).toBeLessThan(0);
    // …and the objective actually took the beating.
    expect(towers.reduce((sum, t) => sum + t.health, 0)).toBeLessThan(
      towers.reduce((sum, t) => sum + t.maxHealth, 0),
    );
  });

  it('does not chase an enemy across the map while a structure stands', () => {
    const w = new World();
    const bot = w.summon(TEAM_A, 'pyromancer', new Vec2(-14, 0));
    // Far enough to be someone else's problem: past PURSUE_RANGE.
    const stranger = w.summon(TEAM_B, 'pyromancer', new Vec2(14, 12));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    brain.step(w, bots, SIM_DT);
    w.step(SIM_DT);

    // While that enemy is a map away it is not a fight, it is scenery.
    expect(brain.states.get(bot.id)?.last.action).toBe('siege');

    // Current balance lets a single damage mage melt a Tower in well under
    // ten seconds, so pad every targetable Tower so the walk-and-hold is visible.
    for (const s of w.targetableStructuresFor(TEAM_A)) {
      if (s.kind !== 'tower') continue;
      padStructureHealth(s, 400);
    }
    for (let i = 0; i < 60 * 10; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    // It marched at the structure, not the stranger across the map, and held
    // the band a non-anchor works: close enough to throw, outside Tower reach.
    expect(bot.position.distanceTo(stranger.position)).toBeGreaterThan(ENGAGE_RANGE);
    const tower = closestTowerTo(w, bot.position);
    expect(tower.alive).toBe(true);
    const reach = bot.position.distanceTo(tower.position) - tower.radius;
    expect(reach).toBeLessThan(ENGAGE_RANGE);
    expect(bot.position.distanceTo(tower.position)).toBeGreaterThan(tower.range);
  });

  it('walks a tank up to the Nexus, hits it, and never gets stuck in it', () => {
    const w = new World();
    for (const t of w.structuresOf(TEAM_B)) {
      if (t.kind === 'tower') {
        t.health = 0;
        t.alive = false;
      }
    }
    w.step(SIM_DT); // lifts the Core's invulnerability

    const core = w.structuresOf(TEAM_B).find((s) => s.kind === 'core')!;
    const bot = w.summon(TEAM_A, 'stone_golem', new Vec2(core.position.x - 9, core.position.y));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    for (let i = 0; i < 60 * 12; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    expect(w.isBlocked(bot.position)).toBe(false);
    expect(bot.position.distanceTo(core.position)).toBeGreaterThan(CORE_RADIUS + MAGE_RADIUS);
    // It closed the gap and actually did the job it walked there to do.
    expect(bot.position.distanceTo(core.position) - core.radius).toBeLessThan(ENGAGE_RANGE);
    expect(core.health).toBeLessThan(core.maxHealth);
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

/**
 * The behaviours the squad plan buys (`Squad.ts`), and the reason it exists: an
 * AI-vs-AI harness over 12 seeds used to finish 12 draws with *zero* structures
 * destroyed, because both squads met in midfield, traded shots until the clock
 * ran out, and fed the enemy Towers ~13,000 free damage doing it.
 */
describe('Brain — strategy', () => {
  /** A siege world with exactly one targetable Tower, so the plan is unambiguous. */
  function oneObjectiveWorld(): { w: World; objective: Structure } {
    const w = new World();
    const towers = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower');
    // The Core stays invulnerable while the other Tower stands, so this leaves
    // exactly one thing on the board worth walking at.
    towers[0].alive = false;
    return { w, objective: towers[1] };
  }

  function runBrain(w: World, ticks: number, ids: string[]): Brain {
    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>(ids.map((id) => [id, 'normal']));
    for (let i = 0; i < ticks; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }
    return brain;
  }

  it('walks past a healthy stranger in midfield instead of stopping to duel it', () => {
    const { w } = oneObjectiveWorld();
    const bot = w.summon(TEAM_A, 'stone_golem', Vec2.zero);
    // Right in its face, but far from anything either side is trying to hold:
    // killing it wins nothing it does not get back on respawn (GDD §4).
    w.summon(TEAM_B, 'pyromancer', new Vec2(2, 0));

    const brain = runBrain(w, 1, [bot.id]);

    expect(brain.states.get(bot.id)?.last.action).toBe('siege');
  });

  it('stops and fights an enemy defending the structure it came to break', () => {
    const { w, objective } = oneObjectiveWorld();
    // Just outside the Tower's reach, where a damage dealer belongs…
    const bot = w.summon(TEAM_A, 'pyromancer', objective.position.add(new Vec2(-9.6, 0)));
    // …and a defender between it and the Tower.
    w.summon(TEAM_B, 'pyromancer', objective.position.add(new Vec2(-5, 0)));

    const brain = runBrain(w, 1, [bot.id]);

    expect(brain.states.get(bot.id)?.last.action).toBe('attack');
  });

  /*
   * A Tower hits for TOWER_DAMAGE every TOWER_ATTACK_INTERVAL, for free, at
   * whatever of ours is closest. Trading under it means trading with the mage
   * *and* the Tower — the worst exchange on the board, and the one the AI used
   * to take most often.
   */
  it('backs out of Tower fire rather than trade under it', () => {
    const { w, objective } = oneObjectiveWorld();
    const bot = w.summon(TEAM_A, 'pyromancer', objective.position.add(new Vec2(-4, 0)));
    w.summon(TEAM_B, 'pyromancer', objective.position.add(new Vec2(-6, 0)));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    brain.step(w, bots, SIM_DT);
    expect(brain.states.get(bot.id)?.last.action).toBe('retreat');

    for (let i = 0; i < 60 * 4; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }
    expect(bot.position.distanceTo(objective.position)).toBeGreaterThan(objective.range);
  });

  /*
   * A Tower measures range from its centre while a siege measures distance to
   * its surface, so there is a band a mage can shoot it from and not be shot
   * back. A squad with nobody built to soak works that band instead of trading
   * bodies for the structure.
   */
  it('breaks a Tower from outside its reach when no one is built to soak it', () => {
    const { w, objective } = oneObjectiveWorld();
    const bot = w.summon(TEAM_A, 'pyromancer', new Vec2(-14, objective.position.y));

    runBrain(w, 60 * 30, [bot.id]);

    expect(objective.health).toBeLessThan(objective.maxHealth);
    expect(bot.health).toBe(bot.maxHealth);
  });

  it('sends the tank in to take the Tower fire and keeps the squishy behind it', () => {
    const { w, objective } = oneObjectiveWorld();
    // Enough HP that the slow tank can arrive before the squishy finishes the
    // Tower from the safe band alone — otherwise there is no soak to observe.
    padStructureHealth(objective, 400);
    const tank = w.summon(TEAM_A, 'stone_golem', new Vec2(-14, objective.position.y));
    const squishy = w.summon(TEAM_A, 'pyromancer', new Vec2(-14, objective.position.y + 2));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([
      [tank.id, 'normal'],
      [squishy.id, 'normal'],
    ]);
    // Only while the Tower stands: once it falls the squad moves on to the Core
    // and walks straight past the rubble, which says nothing about the siege.
    let tankGap = Infinity;
    let squishyGap = Infinity;
    let squishyHealth = squishy.maxHealth;
    for (let i = 0; i < 60 * 40 && objective.alive; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      tankGap = tank.position.distanceTo(objective.position);
      squishyGap = squishy.position.distanceTo(objective.position);
      squishyHealth = squishy.health;
    }

    expect(objective.alive).toBe(false);
    // The Tower shoots whatever is nearest it can see (World.towerTarget), so
    // "who stands closest" *is* "who takes the damage".
    expect(tankGap).toBeLessThan(squishyGap);
    expect(tank.health).toBeLessThan(tank.maxHealth);
    // The squishy worked the band outside the Tower's reach the whole time.
    expect(squishyGap).toBeGreaterThan(objective.range);
    expect(squishyHealth).toBe(squishy.maxHealth);
  });

  /*
   * A charge takes over a second to fill and the aim is re-derived on every one
   * of those ticks. Re-deriving it from "nearest enemy" turned every shot aimed
   * at a Tower into a shot flung at a mage that might be half a map away, so
   * structures took almost no mage fire at all.
   */
  it('keeps a charge aimed at the structure it was started at', () => {
    const { w, objective } = oneObjectiveWorld();
    const bot = w.summon(TEAM_A, 'pyromancer', objective.position.add(new Vec2(-9.6, 0)));
    // Behind us and well out of throwing range — but still the nearest enemy.
    const distraction = w.summon(TEAM_B, 'pyromancer', objective.position.add(new Vec2(-9.6, 14)));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    let sawCharge = false;
    for (let i = 0; i < 60 * 3; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      if (!bot.charging) continue;
      sawCharge = true;
      expect(bot.input.aim.distanceTo(objective.position)).toBeLessThan(
        bot.input.aim.distanceTo(distraction.position),
      );
    }

    expect(sawCharge).toBe(true);
    expect(objective.health).toBeLessThan(objective.maxHealth);
  });

  /*
   * The bait: a defender parked under its own Tower. Taking it means fighting
   * the mage and the Tower at once for a kill worth nothing, which is the trade
   * the AI used to take by default. Rounding the structure to reach the firing
   * band still clips the arc for a moment — what must not happen is settling
   * inside it and trading there.
   */
  it('does not settle inside the objective Tower to duel the mage guarding it', () => {
    const { w, objective } = oneObjectiveWorld();
    const bot = w.summon(TEAM_A, 'pyromancer', new Vec2(-14, objective.position.y));
    w.summon(TEAM_B, 'pyromancer', objective.position.add(new Vec2(-3, 0)));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    let inside = 0;
    let ticks = 0;
    // A dead Tower shoots nobody, so walking over it afterwards proves nothing.
    for (let i = 0; i < 60 * 25 && objective.alive; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      ticks++;
      if (bot.position.distanceTo(objective.position) <= objective.range) inside++;
    }

    expect(inside / ticks).toBeLessThan(0.2);
    expect(bot.position.distanceTo(objective.position)).toBeGreaterThan(objective.range);
    expect(bot.alive).toBe(true);
    expect(objective.health).toBeLessThan(objective.maxHealth);
  });
});

describe('Brain — roles inside the plan', () => {
  // Supports *can* shoot (low attackUrge), but escorting is still the job: when
  // the squad is pushing and nobody is contesting them, they trail the anchor
  // rather than charging a Tower alone — even if the scored action is `siege`.
  it('does not charge a Tower alone while escorting a push', () => {
    const w = new World();
    w.initSquad(TEAM_A, defaultSquad());

    const supports = [...w.mages.values()].filter(
      (m) => m.team === TEAM_A && ROLE_BEHAVIOR[m.role].escorts,
    );
    expect(supports.length).toBeGreaterThan(0);

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>();
    for (const m of w.mages.values()) if (m.team === TEAM_A) bots.set(m.id, 'normal');

    for (let i = 0; i < 60 * 10; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
      for (const s of supports) {
        expect(s.input.charging, `${s.id} charged while escorting`).toBe(false);
      }
    }
  });
});

/**
 * The kit pass (plano v1.3 §3.4, §7.1). Since the idle pivot nobody plays a
 * card, and since v1.3 there is no team bar to play one from — so the only
 * thing that puts a spell on the field is the Brain walking its own squad and
 * asking each body whether this is the moment.
 */
describe('Brain — spending the squad’s kits', () => {
  /** Two full squads on the default map, every mage bot-driven. */
  function contest(seed = 1): { w: World; brain: Brain; bots: Map<string, Difficulty> } {
    const w = new World();
    w.initSquad(TEAM_A, defaultSquad());
    w.initSquad(TEAM_B, defaultSquad());
    const bots = new Map<string, Difficulty>();
    for (const m of w.mages.values()) bots.set(m.id, 'normal');
    return { w, brain: new Brain(new Rng(seed)), bots };
  }

  function run(w: World, brain: Brain, bots: Map<string, Difficulty>, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }
  }

  function castsOf(w: World, team: Team): number {
    let n = 0;
    for (const count of w.castsBySpell.get(team)?.values() ?? []) n += count;
    return n;
  }

  it('puts spells on the field with nobody playing a card', () => {
    const { w, brain, bots } = contest();

    run(w, brain, bots, 20);

    expect(castsOf(w, TEAM_A)).toBeGreaterThan(0);
    expect(castsOf(w, TEAM_B)).toBeGreaterThan(0);
  });

  it('only ever spends a spell some mage on that side actually carries', () => {
    const { w, brain, bots } = contest();

    run(w, brain, bots, 20);

    for (const team of [TEAM_A, TEAM_B] as const) {
      const carried = new Set<string>();
      for (const m of w.mages.values()) {
        if (m.team === team) for (const a of m.abilities) carried.add(a);
      }
      for (const spellId of w.castsBySpell.get(team)?.keys() ?? []) {
        expect(carried.has(spellId), `${team} cast ${spellId}, which nobody carries`).toBe(true);
      }
    }
  });

  /**
   * The baseline the plan calls "vazio" (§4): a squad told to hold everything
   * is the closest thing v1.3 has to a player who authored nothing, and it has
   * to be visibly worse off than the default rather than merely slower.
   *
   * Measured *within* each match, across paired seats and four seeds — not by
   * comparing team A's count in one 20-second match against team A's count in
   * a different one. Those two matches are different worlds after the first
   * second, so what that comparison reported was partly where the fighting
   * happened to be standing at t=20, and `HOLD_GUARD` unlocks on `intruder`:
   * any change that drags the scrap into the held side's own half hands the
   * held squad casts it would not otherwise have spent, and at n=1 that is
   * enough to read the dial backwards. One side holding and the other not, in
   * the same world, cancels the trajectory; paired seats cancel the map, the
   * same correction `agency.test.ts` already carries.
   */
  it('spends far less on a side ordered to hold than on one left at normal', () => {
    let held = 0;
    let free = 0;
    for (let seed = 1; seed <= 4; seed++) {
      for (const holdsA of [true, false]) {
        const c = contest(seed);
        const holder = holdsA ? TEAM_A : TEAM_B;
        for (const m of c.w.mages.values()) if (m.team === holder) m.stance = 'hold';
        run(c.w, c.brain, c.bots, 20);
        held += castsOf(c.w, holder);
        free += castsOf(c.w, holdsA ? TEAM_B : TEAM_A);
      }
    }

    // A floor, not the measurement: the ratio sits near 0.6-0.75 over a real
    // sweep (n=40 sides), and asserting the ratio itself would make this a
    // balance test that goes red every time a kit is tuned.
    expect(held).toBeLessThan(free);
  });

  /**
   * The rule of gold the Tactician was built around, inherited: the server
   * hands one `Rng` to Brain, so an ability pass that drew from it would make
   * *which mages you brought* change how every mage on the field walks — and
   * the balance harness would be measuring the shuffle instead of the squad.
   */
  it('leaves the mages byte-identical whether or not it had kits to consider', () => {
    const walk = (withKits: boolean): { trace: string; casts: number } => {
      // No enemies, full Core, nobody hurt: `hold` can never clear its guard,
      // so both runs cast nothing and only the *asking* differs.
      const w = new World();
      w.initSquad(TEAM_A, defaultSquad());
      const bots = new Map<string, Difficulty>();
      for (const m of w.mages.values()) {
        bots.set(m.id, 'normal');
        m.stance = 'hold';
        if (!withKits) (m as { abilities: readonly string[] }).abilities = [];
      }

      const brain = new Brain(rng());
      for (let i = 0; i < 600; i++) {
        brain.step(w, bots, SIM_DT);
        w.step(SIM_DT);
      }

      return {
        trace: [...w.mages.values()]
          .map((m) => `${m.id}:${m.position.x},${m.position.y}`)
          .join('|'),
        casts: castsOf(w, TEAM_A),
      };
    };

    const kitted = walk(true);
    const bare = walk(false);

    // Stated rather than assumed: a run that quietly started casting would make
    // the comparison below meaningless.
    expect(kitted.casts).toBe(0);
    expect(kitted.trace).toBe(bare.trace);
  });
});
