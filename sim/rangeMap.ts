/**
 * The firing range: a dev map where every mage in the roster stands in its own
 * lane and throws at a wall.
 *
 * This exists because the arena is a bad place to *judge* a spell. In a real
 * siege you get one element at a time, at whatever distance the bots chose,
 * usually behind someone else — which is fine for playing and useless for
 * answering "does the Golem's boulder read as a rock, and does its impact look
 * like one?". Here all nine fire at once, side by side, into the same wall.
 *
 * Not reachable from a match: `RangeScreen` boots it directly, and nothing in
 * `sim/` imports it.
 */

import { ALL_ROSTER } from './cards';
import type { MapData } from './Arena';

/** Distance between lanes. Wide enough that neighbouring impacts do not overlap. */
export const LANE_SPACING = 2.6;
/**
 * Lanes run left-to-right and the shots fly "up" the screen. The mages are the
 * subject here, so they get the wide axis of a widescreen viewport — stacked
 * the other way the camera framed a tall, narrow map and shrank all nine.
 */
export const FIRING_LINE_Y = 5.5;
/**
 * Centre of the wall blocks; their near face is half a block closer. Negative,
 * so the mages stand nearest the camera and throw *away* from it — a shot
 * coming toward the viewer is foreshortened, which is the one angle that hides
 * a projectile's shape.
 */
export const WALL_Y = -5.25;
const WALL_THICKNESS = 1.0;
/** Breathing room kept behind the firing line and beyond the wall. */
const MARGIN = 3;

/**
 * Why the wall sits where it does, and not wherever.
 *
 * A `fort` blocks projectiles only up to 1.3 world units (`OBSTACLE_TOP_HEIGHT`),
 * and a fully charged throw arcs *over* that near the caster. Measured from the
 * muzzle, solving `1 + arc·t − ½g·t² ≤ 1.3` per element gives the distance by
 * which each arc has dropped back under the wall — the strictest is fire, at
 * ~8.44 — while the shortest-ranged element, the Golem's stone, hits the ground
 * at ~9.85. The whole roster therefore connects only in that ~1.4-unit window,
 * and the wall is placed in the middle of it.
 *
 * That window is narrow enough that the first cut of this map missed it: fire
 * arrived at 1.37 and skimmed over the near face, colliding only against the
 * back half of the block. `rangeMap.test.ts` now pins both ends, so any change
 * to an element's `launchArc`, `gravity` or `projectileSpeed` fails there
 * instead of showing up as a spell that mysteriously does not collide.
 */
export const RANGE_DISTANCE = FIRING_LINE_Y - (WALL_Y + WALL_THICKNESS / 2);

const LANES = ALL_ROSTER.length;
const SPAN = (LANES - 1) * LANE_SPACING;

/** Lane centre for the nth roster entry, in world x. */
export function laneX(index: number): number {
  return index * LANE_SPACING - SPAN / 2;
}

/**
 * One wall block per lane rather than one long wall: separated blocks keep each
 * element's impact burst on its own patch of wall, which is the entire point of
 * standing them in a row.
 */
export function rangeMap(): MapData {
  return {
    name: 'range',
    // Sized to the lanes and to the shot itself; the camera frames the whole
    // arena, so every unit of empty map is spent shrinking what is being judged.
    // (The arena is centred on the origin, so both are twice the half-extent.)
    width: SPAN + LANE_SPACING * 2,
    height: (Math.max(Math.abs(FIRING_LINE_Y), WALL_Y) + MARGIN) * 2,
    objects: Array.from({ length: LANES }, (_, i) => ({
      type: 'fort' as const,
      x: laneX(i),
      y: WALL_Y,
      width: LANE_SPACING * 0.85,
      height: WALL_THICKNESS,
    })),
    // No spawns and no structures: mages are placed by `World.summon`, and a
    // map with no Core never resolves a winner, so the range just runs.
    spawns: [],
    structures: [],
  };
}
