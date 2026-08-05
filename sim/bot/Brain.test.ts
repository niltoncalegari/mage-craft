import { describe, expect, it } from 'vitest';
import { Arena, type Obstacle } from '../Arena';
import { defaultSquad } from '../cards';
import { CORE_RADIUS, MAGE_RADIUS, SIM_DT } from '../config';
import { TEAM_A, TEAM_B, type MageInput, type Projectile } from '../entities';
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
    w.summon(TEAM_B, 'pyromancer', new Vec2(14, 12));

    const brain = new Brain(rng());
    const bots = new Map<string, Difficulty>([[bot.id, 'normal']]);
    brain.step(w, bots, SIM_DT);
    w.step(SIM_DT);

    // While that enemy is a map away it is not a fight, it is scenery.
    expect(brain.states.get(bot.id)?.last.action).toBe('siege');

    for (let i = 0; i < 60 * 10; i++) {
      brain.step(w, bots, SIM_DT);
      w.step(SIM_DT);
    }

    // Ten seconds later it has marched into throwing range of a Tower. (By
    // then the enemy is close too, and fighting it is the right call — what
    // must not happen is the walk there never starting.)
    const reach = Math.min(
      ...w.structuresOf(TEAM_B).map((s) => bot.position.distanceTo(s.position)),
    );
    expect(reach).toBeLessThan(ENGAGE_RANGE);
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
