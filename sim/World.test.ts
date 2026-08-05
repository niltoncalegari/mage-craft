import { describe, expect, it } from 'vitest';
import { Arena } from './Arena';
import { defaultSquad } from './cards';
import { CHARGE_TIME, CORE_RADIUS, MAGE_RADIUS, RESPAWN_DELAY, SIM_DT, SQUAD_SIZE } from './config';
import { elementDefFor } from './elements';
import { emptyInput, TEAM_A, TEAM_B, type MageInput, type Structure, type Team } from './entities';
import { Vec2 } from './Vec2';
import { World } from './World';

/**
 * A world on a bare rectangle. These are unit tests of combat mechanics, so
 * they place mages at explicit coordinates and must not be perturbed by the
 * default map's obstacles or spawn points — Arena.test.ts covers the map.
 */
function combatWorld(): World {
  return new World(new Arena(24, 16));
}

function input(over: Partial<MageInput> = {}): MageInput {
  return { ...emptyInput(), ...over };
}

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step(SIM_DT);
}

function fullyChargeAndRelease(w: World, id: string, target: Vec2): void {
  w.setInput(id, input({ aim: target, charging: true }));
  stepN(w, Math.floor(CHARGE_TIME / SIM_DT) + 5);
  w.setInput(id, input({ aim: target, release: true }));
  w.step(SIM_DT);
}

describe('World — movement', () => {
  it('moves a mage toward its input at roughly MOVE_SPEED', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    const start = m.position;

    w.setInput('p1', input({ move: new Vec2(1, 0) }));
    stepN(w, 30); // 0.5s held

    const delta = m.position.sub(start);
    expect(delta.x).toBeGreaterThan(0);
    expect(Math.abs(delta.length() - 6 * 0.5)).toBeLessThan(0.5);
  });

  // Practice mode gates movement only on Hit/Frozen/Defeated (canAcceptOrders),
  // so holding a charge must not root the mage. This regression bit players
  // online: charging locked you in place.
  it('lets a mage keep moving while charging', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = Vec2.zero;
    const start = m.position;

    w.setInput('p1', input({ move: new Vec2(0, 1), aim: new Vec2(10, 0), charging: true }));
    stepN(w, 30);

    expect(m.charging).toBe(true);
    expect(m.position.sub(start).length()).toBeGreaterThan(1);
  });

  it('lets a mage keep moving while recovering from a throw', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = Vec2.zero;

    w.setInput('p1', input({ aim: new Vec2(10, 0), charging: true }));
    stepN(w, Math.floor(CHARGE_TIME / SIM_DT) + 2);
    w.setInput('p1', input({ aim: new Vec2(10, 0), release: true }));
    w.step(SIM_DT);
    expect(m.recoveryTimer).toBeGreaterThan(0);

    const start = m.position;
    w.setInput('p1', input({ move: new Vec2(0, 1) }));
    stepN(w, 10);

    expect(m.position.sub(start).length()).toBeGreaterThan(0.1);
  });

  // Aiming turns toward the cursor over time rather than snapping (AIM.turnSpeed).
  it('turns facing gradually toward the aim point', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = Vec2.zero;
    m.facing = new Vec2(1, 0);

    w.setInput('p1', input({ aim: new Vec2(-10, 0), charging: true }));
    w.step(SIM_DT);

    // One tick at 15 rad/s is a quarter radian — nowhere near the half turn.
    expect(m.facing.x).toBeGreaterThan(0);
    expect(m.facing.y).not.toBe(0);
  });
});

describe('World — combat', () => {
  it('spawns a projectile on charge + release', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    const aim = m.position.add(new Vec2(10, 0));

    w.setInput('p1', input({ aim, charging: true }));
    stepN(w, Math.floor(CHARGE_TIME / SIM_DT) + 5);
    expect(m.charge).toBe(1);

    w.setInput('p1', input({ aim, release: true }));
    w.step(SIM_DT);

    expect(w.projectiles.size).toBe(1);
    const p = [...w.projectiles.values()][0];
    expect(p.ownerId).toBe('p1');
    expect(p.team).toBe(TEAM_A);
    expect(p.element).toBe('fire');
    expect(m.charge).toBe(0);
    expect(m.charging).toBe(false);
    expect(m.throwCooldown).toBeGreaterThan(0);
  });

  it('applies damage and knockback when a projectile hits', () => {
    const w = combatWorld();
    const attacker = w.addMage('atk', TEAM_A, 'fire', false);
    const target = w.addMage('def', TEAM_B, 'fire', false);
    attacker.position = new Vec2(-2, 0);
    target.position = new Vec2(2, 0);
    const targetStart = target.position;

    fullyChargeAndRelease(w, 'atk', target.position);

    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      w.step(SIM_DT);
      if (target.health < target.maxHealth) hit = true;
    }
    expect(hit).toBe(true);

    // Knockback is a decaying slide over the stun window, not an instant jump
    // on the impact tick — step a bit further to see it.
    stepN(w, 5);
    expect(target.position.distanceTo(targetStart)).toBeGreaterThan(0);
    expect(attacker.throwCooldown).toBeGreaterThan(0);
  });

  it('applies a slow on an ice hit', () => {
    const w = combatWorld();
    const attacker = w.addMage('atk', TEAM_A, 'ice', false);
    const target = w.addMage('def', TEAM_B, 'fire', false);
    attacker.position = new Vec2(-2, 0);
    target.position = new Vec2(2, 0);

    fullyChargeAndRelease(w, 'atk', target.position);
    for (let i = 0; i < 120 && target.slowTimer <= 0; i++) w.step(SIM_DT);

    expect(target.slowTimer).toBeGreaterThan(0);
    expect(target.slowFactor).toBeGreaterThan(0);
  });

  it('spawns a poison puddle that ticks damage on whoever stands in it', () => {
    const w = combatWorld();
    const attacker = w.addMage('atk', TEAM_A, 'poison', false);
    const target = w.addMage('def', TEAM_B, 'fire', false);
    attacker.position = new Vec2(-2, 0);
    target.position = new Vec2(2, 0);

    fullyChargeAndRelease(w, 'atk', target.position);
    for (let i = 0; i < 120 && w.puddles.size === 0; i++) w.step(SIM_DT);
    expect(w.puddles.size).toBe(1);

    const healthAfterImpact = target.health;
    const def = elementDefFor('poison');
    stepN(w, Math.floor((def?.puddleTickInterval ?? 0.3) / SIM_DT) + 5);

    expect(target.health).toBeLessThan(healthAfterImpact);
  });

  it('interrupts the target’s charge on a stone hit', () => {
    const w = combatWorld();
    const attacker = w.addMage('atk', TEAM_A, 'stone', false);
    const target = w.addMage('def', TEAM_B, 'fire', false);
    attacker.position = new Vec2(-2, 0);
    target.position = new Vec2(2, 0);

    w.setInput('def', input({ aim: attacker.position, charging: true }));
    stepN(w, 20);
    expect(target.charge).toBeGreaterThan(0);

    fullyChargeAndRelease(w, 'atk', target.position);
    for (let i = 0; i < 120; i++) {
      w.step(SIM_DT);
      if (target.health < target.maxHealth) break;
    }

    expect(target.charge).toBe(0);
    expect(target.charging).toBe(false);
  });
});

describe('World — respawn and round end', () => {
  it('respawns a defeated mage after the respawn delay (GDD §4: squads are permanent)', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.health = 1;

    w.dealDamage(m, 999, new Vec2(1, 0), 0);

    expect(m.alive).toBe(false);
    expect(m.respawnTimer).toBeGreaterThan(0);

    stepN(w, Math.floor(RESPAWN_DELAY / SIM_DT) + 5);

    expect(m.alive).toBe(true);
    expect(m.health).toBe(m.maxHealth);
    expect(m.immunityTimer).toBeGreaterThan(0);
  });

  it('never drops a mage from the world — a squad has no permanent death', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);

    w.dealDamage(m, 999, new Vec2(1, 0), 0);
    expect(w.mage('p1')).toBeDefined();

    // Long past the respawn delay: the mage should be back, not gone.
    stepN(w, Math.floor(RESPAWN_DELAY / SIM_DT) + 30);

    expect(w.mage('p1')).toBeDefined();
    expect(w.mage('p1')?.alive).toBe(true);
  });

  it('does NOT end the round when a team has no mages standing — structures decide', () => {
    const w = combatWorld();
    w.addMage('a1', TEAM_A, 'fire', false);
    const loser = w.addMage('b1', TEAM_B, 'fire', false);
    loser.alive = false;

    w.step(SIM_DT);

    // Having no units up on the board is a normal state now: they are simply
    // between deaths, waiting to respawn (GDD §4).
    expect(w.roundOver).toBe(false);
  });

  // A one-sided world (or a room still filling its second team) must not look
  // "eliminated" from tick one.
  it('does not end a round before both teams are populated', () => {
    const w = combatWorld();
    w.addMage('a1', TEAM_A, 'fire', false);
    stepN(w, 10);
    expect(w.roundOver).toBe(false);
  });
});

/**
 * Refusing a blocked move keeps a mage out of a wall; it does nothing for one
 * that is already in it. Online squads got stuck inside the Nexus and never
 * moved again for the rest of the match — these are the regressions for it.
 */
describe('World — anti-stuck', () => {
  /** The default (siege) map, so structures are on the board. */
  function siegeWorld(): World {
    return new World();
  }

  function coreOf(w: World, team: Team): Structure {
    return w.structuresOf(team).find((s) => s.kind === 'core')!;
  }

  it('counts live structures as solid, not just obstacles', () => {
    const w = siegeWorld();
    const core = coreOf(w, TEAM_B);

    expect(w.isBlocked(core.position)).toBe(true);
    expect(w.arena.blocksMovementAt(core.position, MAGE_RADIUS)).toBe(false);
  });

  it('pushes a mage that ends up inside a structure back out', () => {
    const w = siegeWorld();
    const core = coreOf(w, TEAM_B);
    const m = w.summon(TEAM_A, 'pyromancer', core.position);

    w.step(SIM_DT);

    expect(w.isBlocked(m.position)).toBe(false);
    expect(m.position.distanceTo(core.position)).toBeGreaterThanOrEqual(CORE_RADIUS);
  });

  it('pushes a mage out of an obstacle it was placed inside', () => {
    const w = siegeWorld();
    const rock = w.arena.obstacles.find((o) => o.type === 'rock')!;
    const m = w.summon(TEAM_A, 'pyromancer', rock.position);

    w.step(SIM_DT);

    expect(w.isBlocked(m.position)).toBe(false);
  });

  // Walking a squad into a Tower used to end with every mage pinned against it,
  // because resolveMove rejected every direction once they were inside.
  it('never leaves a mage stuck inside a blocker while it is being pushed into one', () => {
    const w = siegeWorld();
    const [tower] = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower');
    const m = w.summon(TEAM_A, 'stone_golem', new Vec2(tower.position.x - 3, tower.position.y));

    // Hold "walk into the tower" for a full second.
    w.setInput(m.id, input({ move: new Vec2(1, 0) }));
    stepN(w, 60);

    expect(w.isBlocked(m.position)).toBe(false);
  });

  it('spawns a full squad clear of every structure and obstacle', () => {
    const w = siegeWorld();
    w.initSquad(TEAM_A, defaultSquad());
    w.initSquad(TEAM_B, defaultSquad());

    for (const m of w.mages.values()) {
      expect(w.isBlocked(m.position), `spawn of ${m.id}`).toBe(false);
      expect(w.arena.contains(m.position, MAGE_RADIUS)).toBe(true);
    }
  });

  it('gives the map enough spawn points for a whole squad', () => {
    const w = siegeWorld();
    for (const team of [TEAM_A, TEAM_B]) {
      const seats = w.arena.spawns.filter((s) => s.team === team);
      expect(seats.length).toBeGreaterThanOrEqual(SQUAD_SIZE);
    }
  });

  it('respawns each mage on its own slot, clear of blockers', () => {
    const w = siegeWorld();
    w.initSquad(TEAM_A, defaultSquad());

    for (const m of w.mages.values()) w.dealDamage(m, 9999, Vec2.zero, 0);
    stepN(w, Math.ceil(RESPAWN_DELAY / SIM_DT) + 5);

    const alive = [...w.mages.values()].filter((m) => m.alive);
    expect(alive).toHaveLength(SQUAD_SIZE);
    for (const m of alive) expect(w.isBlocked(m.position), `respawn of ${m.id}`).toBe(false);

    // Distinct slots, not four bodies stacked on spawn 0.
    const spots = new Set(alive.map((m) => `${m.position.x.toFixed(2)},${m.position.y.toFixed(2)}`));
    expect(spots.size).toBe(SQUAD_SIZE);
  });

  // What the AI has to ask before it commits to a direction. A probe one step
  // ahead only sees a wall once you are against it — which is how a squad ends
  // up grinding along a Tower instead of walking round it.
  it('sweeps a whole path for blockers, not just the next step', () => {
    const w = siegeWorld();
    const core = coreOf(w, TEAM_B);
    const near = new Vec2(core.position.x - 6, core.position.y);
    const far = new Vec2(core.position.x + 6, core.position.y);

    expect(w.isBlocked(near)).toBe(false);
    expect(w.isBlockedSegment(near, far)).toBe(true);
    expect(w.isBlockedSegment(near, new Vec2(near.x, near.y + 3))).toBe(false);
  });

  it('reopens the path grid when a structure falls', () => {
    const w = siegeWorld();
    const [tower] = w.structuresOf(TEAM_B).filter((s) => s.kind === 'tower');

    expect(w.pathGrid().isBlocked(tower.position)).toBe(true);

    w.damageStructure(tower, tower.maxHealth);
    expect(tower.alive).toBe(false);

    expect(w.pathGrid().isBlocked(tower.position)).toBe(false);
  });
});
