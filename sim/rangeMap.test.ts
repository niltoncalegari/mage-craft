import { describe, expect, it } from 'vitest';
import { ALL_ROSTER, rosterFor } from './cards';
import { LAUNCH_HEIGHT, MAGE_RADIUS, OBSTACLE_TOP_HEIGHT, SPAWN_MARGIN } from './config';
import { elementDefFor } from './elements';
import { laneX, RANGE_DISTANCE, rangeMap } from './rangeMap';

/**
 * The firing range is a dev tool, and a dev tool that silently stops working is
 * worse than none — a spell that sails over the wall or drops short of it looks
 * exactly like a spell whose collision broke.
 *
 * What makes it fragile is that the wall (`fort`, 1.3 units tall) only stops a
 * projectile once its arc has come back down, so there is a *window* of
 * distances that works for the whole roster, and any change to an element's
 * arc, gravity or speed can move it. These tests are that window.
 */

/** Where the projectile actually starts, relative to the mage that threw it. */
const MUZZLE_OFFSET = MAGE_RADIUS + SPAWN_MARGIN;
/** Ground distance from the muzzle to the wall's near face. */
const TRAVEL = RANGE_DISTANCE - MUZZLE_OFFSET;

/** Height of a fully charged throw after travelling `distance` on the ground. */
function heightAfter(elementId: string, distance: number): number {
  const def = elementDefFor(elementId as never);
  if (!def) throw new Error(`missing element ${elementId}`);

  // Mirrors World.releaseThrow + updateProjectiles at charge = 1.
  const speed = def.projectileSpeed;
  const vertical = def.launchArc;
  const t = distance / speed;
  return LAUNCH_HEIGHT + vertical * t - 0.5 * def.gravity * t * t;
}

describe('firing range', () => {
  it('gives every roster entry its own lane and its own wall block', () => {
    const map = rangeMap();
    expect(map.objects).toHaveLength(ALL_ROSTER.length);

    const lanes = map.objects.map((o) => o.x);
    expect(new Set(lanes).size).toBe(ALL_ROSTER.length);
    ALL_ROSTER.forEach((_, i) => expect(lanes).toContain(laneX(i)));
  });

  it('keeps every lane inside the map', () => {
    const map = rangeMap();
    for (let i = 0; i < ALL_ROSTER.length; i++) {
      expect(Math.abs(laneX(i))).toBeLessThan(map.width / 2);
    }
  });

  /**
   * The load-bearing one. Every element must arrive at the wall *below* the
   * height a fort blocks to, or it flies over and never collides.
   */
  it('puts the wall where every spell has dropped back under it', () => {
    for (const rosterId of ALL_ROSTER) {
      const entry = rosterFor(rosterId);
      if (!entry) throw new Error(`missing roster entry ${rosterId}`);

      const height = heightAfter(entry.element, TRAVEL);
      expect(height, `${rosterId} (${entry.element}) flies over the wall`).toBeLessThanOrEqual(
        OBSTACLE_TOP_HEIGHT.fort,
      );
    }
  });

  /** ...and must still be airborne when it gets there, rather than landing short. */
  it('puts the wall within reach of even the shortest-ranged spell', () => {
    for (const rosterId of ALL_ROSTER) {
      const entry = rosterFor(rosterId);
      if (!entry) throw new Error(`missing roster entry ${rosterId}`);

      // Checked just shy of the wall: at the face itself a grazing arc can be
      // legitimately at zero.
      const height = heightAfter(entry.element, TRAVEL - 0.25);
      expect(height, `${rosterId} (${entry.element}) lands short of the wall`).toBeGreaterThan(0);
    }
  });
});
