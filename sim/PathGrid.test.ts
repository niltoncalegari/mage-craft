/**
 * The server-side path planner (GDD §11). These are unit tests of routing on a
 * hand-built arena; `World.test.ts` covers the predicate it is fed in a match
 * (obstacles *and* live structures) and the anti-stuck behaviour it backs.
 */

import { describe, expect, it } from 'vitest';
import { Arena, type Obstacle } from './Arena';
import { MAGE_RADIUS } from './config';
import { PathGrid } from './PathGrid';
import { Vec2 } from './Vec2';

function wall(position: Vec2, halfW: number, halfH: number): Obstacle {
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

function rock(position: Vec2, radius = 0.6): Obstacle {
  return {
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
  };
}

/** The same predicate `World` supplies: blocking, already inflated by the body radius. */
function gridFor(arena: Arena): PathGrid {
  return new PathGrid(arena, (p) => arena.blocksMovementAt(p, MAGE_RADIUS));
}

describe('PathGrid', () => {
  it('goes straight across open ground', () => {
    const arena = new Arena(24, 16);
    const path = gridFor(arena).findPath(new Vec2(-8, 0), new Vec2(8, 0));

    expect(path).not.toBeNull();
    // Colinear cells are dropped, so an unobstructed run is a single hop that
    // ends exactly on the requested point rather than on a cell centre.
    expect(path![path!.length - 1].x).toBeCloseTo(8);
    expect(path![path!.length - 1].y).toBeCloseTo(0);
    for (const p of path!) expect(Math.abs(p.y)).toBeLessThan(1);
  });

  it('routes around a wall instead of through it', () => {
    // A wall on x = 0 sealing everything below y = 1; the only way past is over
    // the top.
    const arena = new Arena(24, 16, [wall(new Vec2(0, -3.5), 0.4, 4.5)]);
    const path = gridFor(arena).findPath(new Vec2(-8, -4), new Vec2(8, -4));

    expect(path).not.toBeNull();
    expect(path!.some((p) => p.y > 1)).toBe(true);
    for (const p of path!) expect(arena.blocksMovementAt(p, MAGE_RADIUS)).toBe(false);
  });

  it('gives up when the goal is sealed off', () => {
    const arena = new Arena(24, 16, [wall(new Vec2(0, 0), 0.4, 8)]);
    expect(gridFor(arena).findPath(new Vec2(-8, 0), new Vec2(8, 0))).toBeNull();
  });

  it('starts from the nearest free cell when the body is inside a blocker', () => {
    const arena = new Arena(24, 16, [rock(new Vec2(0, 0), 1.5)]);
    const path = gridFor(arena).findPath(new Vec2(0, 0), new Vec2(8, 0));

    expect(path).not.toBeNull();
    for (const p of path!) expect(arena.blocksMovementAt(p, MAGE_RADIUS)).toBe(false);
  });

  it('nearestFree walks a point out of a blocker and leaves clear points alone', () => {
    const arena = new Arena(24, 16, [rock(new Vec2(0, 0), 1.5)]);
    const grid = gridFor(arena);

    const freed = grid.nearestFree(new Vec2(0, 0));
    expect(freed).not.toBeNull();
    expect(arena.blocksMovementAt(freed!, MAGE_RADIUS)).toBe(false);

    expect(grid.isBlocked(new Vec2(0, 0))).toBe(true);
    expect(grid.isBlocked(new Vec2(8, 0))).toBe(false);
  });

  it('does not cut the corner between two diagonal blockers', () => {
    // Blockers at (0.5, 0.5)'s two orthogonal neighbours: a diagonal hop from
    // the cell below-left to the cell above-right would clip both.
    const arena = new Arena(24, 16, [rock(new Vec2(0.5, -0.5)), rock(new Vec2(-0.5, 0.5))]);
    const path = gridFor(arena).findPath(new Vec2(-0.5, -0.5), new Vec2(0.5, 0.5));

    expect(path).not.toBeNull();
    for (const p of path!) expect(arena.blocksMovementAt(p, MAGE_RADIUS)).toBe(false);
    // Reaching it needs a detour, never the single blocked diagonal step.
    expect(path!.length).toBeGreaterThan(1);
  });
});
