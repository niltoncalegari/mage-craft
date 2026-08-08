import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createObstacle } from '../src/game/Obstacle';
import { OBSTACLE_HEIGHT } from '../src/game/config';
import type { ObstacleType as ClientObstacleType } from '../src/game/types';
import { Arena, type MapData, type Obstacle, type ObstacleType } from './Arena';
import { MAGE_RADIUS, SIM_DT } from './config';
import { TEAM_A, TEAM_B } from './entities';
import { defaultArena, DEFAULT_MAP_NAME } from './defaultMap';
import { emptyInput } from './entities';
import { Vec2 } from './Vec2';
import { World } from './World';

const MAPS_DIR = join(process.cwd(), 'public', 'maps');
const ALL_TYPES: ObstacleType[] = ['tree', 'rock', 'fort', 'fence', 'prop'];

function obstacle(over: Partial<Obstacle> & Pick<Obstacle, 'type' | 'position'>): Obstacle {
  return {
    isRect: false,
    radius: 0,
    halfW: 0,
    halfH: 0,
    blocksSight: false,
    blocksProjectiles: false,
    blocksMovement: false,
    topHeight: 1,
    ...over,
  };
}

/**
 * The guard that replaced the Go server's duplicate-map test.
 *
 * There is only one copy of each map now, so drift between *files* is
 * impossible — but the sim keeps its own obstacle footprint table (the client's
 * lives in `Obstacle.ts` as closures over `Shape`, which the sim doesn't use).
 * These assertions check that table against the client's real one, so a
 * gameplay footprint can't silently differ between practice mode and online.
 */
describe('Arena — parity with the client’s obstacle tables', () => {
  it.each(ALL_TYPES)('matches the client footprint and height for %s', (type) => {
    const parsed = Arena.parse({
      width: 40,
      height: 30,
      objects: [{ type, x: 0, y: 0 }],
    });
    const mine = parsed.obstacles[0];
    const theirs = createObstacle(0, { type: type as ClientObstacleType, x: 0, y: 0 });

    expect(mine.blocksSight).toBe(theirs.blocksSight);
    expect(mine.blocksProjectiles).toBe(theirs.blocksProjectiles);
    expect(mine.blocksMovement).toBe(theirs.blocksMovement);
    expect(mine.topHeight).toBe(OBSTACLE_HEIGHT[type as ClientObstacleType]);

    if (theirs.collision.kind === 'circle') {
      expect(mine.isRect).toBe(false);
      expect(mine.radius).toBe(theirs.collision.radius);
    } else if (theirs.collision.kind === 'rect') {
      expect(mine.isRect).toBe(true);
      expect(mine.halfW).toBe(theirs.collision.halfW);
      expect(mine.halfH).toBe(theirs.collision.halfH);
    } else {
      throw new Error(`unexpected collision shape ${theirs.collision.kind}`);
    }
  });

  it('parses every map the client ships', () => {
    const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const data = JSON.parse(readFileSync(join(MAPS_DIR, file), 'utf8')) as MapData;
      const arena = Arena.parse(data);
      expect(arena.width, file).toBeGreaterThan(0);
      expect(arena.height, file).toBeGreaterThan(0);
      expect(arena.obstacles.length, file).toBe(data.objects.length);
    }
  });
});

describe('Arena — default map', () => {
  it('loads obstacles and spawns for both teams', () => {
    const a = defaultArena();

    expect(DEFAULT_MAP_NAME).toBe('siege1.json');
    expect(a.width).toBeGreaterThan(0);
    expect(a.height).toBeGreaterThan(0);
    expect(a.obstacles.length).toBeGreaterThan(0);
    expect(a.spawns.some((s) => s.team === TEAM_A)).toBe(true);
    expect(a.spawns.some((s) => s.team === TEAM_B)).toBe(true);
  });

  it('gives each team a Core and two Towers (GDD §5)', () => {
    const a = defaultArena();

    for (const team of [TEAM_A, TEAM_B]) {
      const mine = a.structures.filter((s) => s.team === team);
      expect(mine.filter((s) => s.kind === 'core')).toHaveLength(1);
      expect(mine.filter((s) => s.kind === 'tower')).toHaveLength(2);
    }
  });

  it('places the two sides symmetrically, so neither starts closer', () => {
    const a = defaultArena();
    const depth = (team: number): number[] =>
      a.structures
        .filter((s) => s.team === team)
        .map((s) => Math.abs(s.pos.x))
        .sort((x, y) => x - y);

    expect(depth(TEAM_A)).toEqual(depth(TEAM_B));
  });

  it('keeps every spawn inside the arena and out of obstacles', () => {
    const a = defaultArena();
    for (const s of a.spawns) {
      expect(a.blocksMovementAt(s.pos, MAGE_RADIUS), `spawn ${JSON.stringify(s.pos)}`).toBe(false);
      expect(a.contains(s.pos, MAGE_RADIUS), `spawn ${JSON.stringify(s.pos)}`).toBe(true);
    }
  });

  // Rooms go up to 6v6 but the map defines fewer spawns per team.
  it('falls back inside the arena when the map runs out of spawns', () => {
    const a = defaultArena();
    expect(a.contains(a.spawnFor(TEAM_A, 99), MAGE_RADIUS)).toBe(true);
  });
});

describe('Arena — blocking', () => {
  it('blocks movement inside an obstacle and allows open ground', () => {
    const a = new Arena(24, 16, [
      obstacle({ type: 'rock', position: new Vec2(3, 0), radius: 0.6, blocksMovement: true }),
    ]);

    expect(a.blocksMovementAt(new Vec2(3, 0), MAGE_RADIUS)).toBe(true);
    expect(a.blocksMovementAt(new Vec2(8, 0), MAGE_RADIUS)).toBe(false);
  });

  it('lets projectiles arc over a low obstacle', () => {
    const a = new Arena(24, 16, [
      obstacle({
        type: 'fence',
        position: new Vec2(2, 0),
        isRect: true,
        halfW: 2.5,
        halfH: 0.12,
        blocksProjectiles: true,
        topHeight: 0.85,
      }),
    ]);

    expect(a.blocksProjectileAt(new Vec2(2, 0), 0.2, 0.5)).toBe(true);
    expect(a.blocksProjectileAt(new Vec2(2, 0), 0.2, 2.0)).toBe(false);
  });

  it('blocks line of sight through a sight blocker only', () => {
    const a = new Arena(24, 16, [
      obstacle({
        type: 'fort',
        position: new Vec2(0, 0),
        isRect: true,
        halfW: 2.5,
        halfH: 0.6,
        blocksSight: true,
      }),
    ]);

    expect(a.hasLineOfSight(new Vec2(-5, 0), new Vec2(5, 0))).toBe(false);
    expect(a.hasLineOfSight(new Vec2(-5, 6), new Vec2(5, 6))).toBe(true);
  });
});

describe('World — obstacle collision', () => {
  const wall = (): Arena =>
    new Arena(24, 16, [
      obstacle({
        type: 'fort',
        position: new Vec2(2, 0),
        isRect: true,
        halfW: 0.6,
        halfH: 3,
        blocksMovement: true,
        blocksSight: true,
        blocksProjectiles: true,
      }),
    ]);

  it('stops a mage walking straight into a wall', () => {
    const w = new World(wall());
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = Vec2.zero;

    w.setInput('p1', { ...emptyInput(), move: new Vec2(1, 0) });
    for (let i = 0; i < 60; i++) w.step(SIM_DT);

    expect(m.position.x).toBeLessThanOrEqual(2 - 0.6 - MAGE_RADIUS + 0.01);
  });

  it('slides along a wall instead of sticking when pushed diagonally', () => {
    const w = new World(wall());
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = Vec2.zero;

    w.setInput('p1', { ...emptyInput(), move: new Vec2(1, 1).normalized() });
    for (let i = 0; i < 30; i++) w.step(SIM_DT);

    expect(m.position.y).toBeGreaterThan(0.5);
  });

  /*
   * Movement never walks into a blocker, but knockback, mage separation and
   * spawning can all leave a mage overlapping one — and from in there every
   * step is blocked too, so without this it stands inside the rock for the rest
   * of the match.
   */
  it('pushes a mage that ends up inside an obstacle back out of it', () => {
    const w = new World(wall());
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = new Vec2(2, 0); // dead centre of the wall

    w.step(SIM_DT);

    expect(w.blockedAt(m.position)).toBe(false);
  });

  it('lets a freed mage walk away instead of staying wedged', () => {
    const w = new World(wall());
    const m = w.addMage('p1', TEAM_A, 'fire', false);
    m.position = new Vec2(2, 0);

    w.setInput('p1', { ...emptyInput(), move: new Vec2(-1, 0) });
    for (let i = 0; i < 60; i++) w.step(SIM_DT);

    expect(m.position.x).toBeLessThan(0);
  });

  it('never separates two mages into an obstacle', () => {
    const w = new World(wall());
    const a = w.addMage('p1', TEAM_A, 'fire', false);
    const b = w.addMage('p2', TEAM_A, 'fire', false);
    // Stacked just clear of the wall: the separation push is straight at it.
    a.position = new Vec2(2 - 0.6 - MAGE_RADIUS - 0.05, 0);
    b.position = new Vec2(a.position.x - 0.05, 0);

    for (let i = 0; i < 30; i++) w.step(SIM_DT);

    expect(w.blockedAt(a.position)).toBe(false);
    expect(w.blockedAt(b.position)).toBe(false);
  });
});
