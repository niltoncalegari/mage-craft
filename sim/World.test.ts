import { describe, expect, it } from 'vitest';
import { Arena } from './Arena';
import { CHARGE_TIME, CORPSE_LINGER, RESPAWN_DELAY, SIM_DT } from './config';
import { elementDefFor } from './elements';
import { emptyInput, TEAM_A, TEAM_B, type MageInput } from './entities';
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

describe('World — lives and round end', () => {
  it('respawns a mage that still has a life left', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.health = 1;
    // Summons get one life (GDD §4); this covers the respawn path itself.
    m.lives = 2;

    w.dealDamage(m, 999, new Vec2(1, 0), 0);

    expect(m.alive).toBe(false);
    expect(m.lives).toBe(1);
    expect(m.respawnTimer).toBeGreaterThan(0);

    stepN(w, Math.floor(RESPAWN_DELAY / SIM_DT) + 5);

    expect(m.alive).toBe(true);
    expect(m.health).toBe(m.maxHealth);
    expect(m.immunityTimer).toBeGreaterThan(0);
  });

  it('drops a spent summon from the world after the corpse linger', () => {
    const w = combatWorld();
    const m = w.addMage('p1', TEAM_A, 'fire', false);

    w.dealDamage(m, 999, new Vec2(1, 0), 0);
    expect(w.mage('p1')).toBeDefined();

    stepN(w, Math.floor(CORPSE_LINGER / SIM_DT) + 5);

    expect(w.mage('p1')).toBeUndefined();
  });

  it('does NOT end the round when a team runs out of mages — structures decide', () => {
    const w = combatWorld();
    w.addMage('a1', TEAM_A, 'fire', false);
    const loser = w.addMage('b1', TEAM_B, 'fire', false);
    loser.alive = false;
    loser.lives = 0;

    w.step(SIM_DT);

    // Having no units on the board is a normal state now: you simply have not
    // spent mana yet (GDD §4).
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
