/**
 * The half of the `roots` shape that can be checked without an eye.
 *
 * Where the voxels go and when each one appears is arithmetic; only the look is
 * a matter of taste. The claims worth pinning are the ones whose failure reads
 * as a weaker card rather than as a bug: roots crawling outside the area the
 * card actually catches, a growth that never finishes, a retraction that leaves
 * cubes standing on the field, and a pool too small for the systems that can be
 * alive at once — which in this repo fails silently.
 */

import { describe, expect, it } from 'vitest';
import {
  planRootGrowth,
  rootVoxelScale,
  ROOT_BOUNCE,
  ROOT_SYSTEM_POOL,
  ROOT_VOXEL_POOL,
  ROOT_VOXELS_PER_CAST,
  type RootVoxel,
} from './rootGrowth';

/**
 * A deterministic stand-in for `Math.random`, so a layout can be asserted at
 * all. Cycling rather than constant: a constant 0.5 makes every branch take the
 * same turn and would hide exactly the deduplication this is checking.
 */
function cyclingRand(): () => number {
  const values = [0.13, 0.87, 0.41, 0.66, 0.29, 0.94, 0.52, 0.08, 0.73, 0.35];
  let i = 0;
  return () => values[i++ % values.length];
}

describe('root growth — layout', () => {
  it('keeps every voxel inside the area the card claims', () => {
    const radius = 3;
    const voxels = planRootGrowth(radius, cyclingRand());

    expect(voxels.length).toBeGreaterThan(0);
    for (const v of voxels) {
      expect(Math.hypot(v.x, v.y), `${v.x},${v.y}`).toBeLessThanOrEqual(radius);
    }
  });

  /**
   * The reference this is taken from dedupes through a `visited` set, and it is
   * load-bearing rather than tidy: branches radiate from one point, so without
   * it the voxels nearest the centre are drawn a dozen times over — which costs
   * a dozen instances each and, because the cubes blend additively, shows as a
   * bright blob exactly where the effect should read as thinnest.
   */
  it('never puts two voxels in the same cell', () => {
    const voxels = planRootGrowth(3, cyclingRand());
    const keys = voxels.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.height.toFixed(3)}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never plans more voxels than one cast is budgeted', () => {
    // A radius far past anything in the catalog: the cap has to hold on its own
    // rather than because the card happened to be small.
    expect(planRootGrowth(12, cyclingRand()).length).toBeLessThanOrEqual(ROOT_VOXELS_PER_CAST);
  });

  it('grows outward in time, so the spread reads as travel rather than a pop', () => {
    const voxels = planRootGrowth(3, cyclingRand());
    const far = voxels.filter((v) => !v.flower && Math.hypot(v.x, v.y) > 2);
    const near = voxels.filter((v) => !v.flower && Math.hypot(v.x, v.y) < 1);

    expect(far.length).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(0);

    const earliest = (list: RootVoxel[]): number => Math.min(...list.map((v) => v.time));
    expect(earliest(near)).toBeLessThan(earliest(far));
  });

  it('sits every flower above ground, on the roots rather than beside them', () => {
    const voxels = planRootGrowth(3, cyclingRand());
    const flowers = voxels.filter((v) => v.flower);

    expect(flowers.length).toBeGreaterThan(0);
    for (const f of flowers) expect(f.height).toBeGreaterThan(0);
  });
});

describe('root growth — the growth curve', () => {
  const voxel = (time: number): RootVoxel => ({ x: 0, y: 0, height: 0, time, flower: false });

  it('shows nothing before a voxel’s turn', () => {
    expect(rootVoxelScale(voxel(0.3), 0, 2)).toBe(0);
    expect(rootVoxelScale(voxel(0.3), 0.29, 2)).toBe(0);
  });

  it('reaches full size and stays there', () => {
    const v = voxel(0);
    expect(rootVoxelScale(v, 0.5, 2)).toBe(1);
    expect(rootVoxelScale(v, 1.0, 2)).toBe(1);
  });

  /**
   * The overshoot is what makes a cube read as *pushing* out of the soil rather
   * than fading in, and it is bounded so a root never outgrows its own cell.
   */
  it('overshoots on the way up, but never past the bounce ceiling', () => {
    const v = voxel(0);
    let peak = 0;
    for (let t = 0; t < 0.5; t += 1 / 120) peak = Math.max(peak, rootVoxelScale(v, t, 2));

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(1 + ROOT_BOUNCE);
  });

  it('is fully gone by the time the effect ends, whenever the voxel arrived', () => {
    const life = 2;
    for (const t of [0, 0.15, 0.3, 0.45]) {
      expect(rootVoxelScale(voxel(t), life, life), `voxel at ${t}`).toBe(0);
    }
  });
});

/**
 * `spawnZone` in this renderer returns without drawing when it finds no slot,
 * and the meteor pass added its own cube pool for exactly that reason. Roots
 * hold their instances for the card's whole duration, so two overlapping casts
 * must not silently halve each other.
 */
describe('root growth — pool budget', () => {
  it('has room for every system that can be alive at once', () => {
    expect(ROOT_VOXEL_POOL).toBeGreaterThanOrEqual(ROOT_VOXELS_PER_CAST * ROOT_SYSTEM_POOL);
  });
});
