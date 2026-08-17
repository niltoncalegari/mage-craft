/**
 * Where the voxels of a `roots` cast go, and when each one pushes out of the
 * soil.
 *
 * Split out of the renderer on the same grounds as {@link planColumnFall}: the
 * shape is half arithmetic and half taste, and the arithmetic half is the part
 * that can be held to a number. A root system is a claim about *spread* —
 * branches radiating from the cast point, thickest at the middle, arriving
 * outward over time — and none of that needs an eye to check.
 *
 * The layout is a voxel random walk snapped to a grid, deduplicated through a
 * visited set. That is not a stylistic choice: branches all start at one point,
 * so without the set the cells near the centre are written a dozen times over,
 * which costs a dozen instances each and, because the cubes blend additively,
 * shows as a bright blob precisely where the effect should read as thinnest.
 */

/**
 * Edge of one cube, in metres.
 *
 * The first cut used 0.26, which is eleven cells across a three-metre disc, and
 * it read as masonry: at that resolution a branch cannot bend inside its own
 * width, so every root is a wall. Voxel is the house style — the meteor is
 * voxel, and the reference this grew from is voxel — but voxel is a *grain*,
 * not a size, and the grain has to be finer than the shape it is describing.
 */
export const ROOT_VOXEL_SIZE = 0.15;

/** Branches radiating from the cast point, and how many cells each one walks. */
export const ROOT_BRANCHES = 20;
export const ROOT_STEPS = 16;

/**
 * How much a branch thins along its length: the tip ends at `1 - ROOT_TAPER` of
 * a full cell.
 *
 * A root that ends in a full cube has no direction — it just stops. Thinning
 * gives the branch a reading order, which is what makes the growth look like it
 * travelled outward rather than appeared all at once. Floored well above zero,
 * because a taper that reaches nothing is a branch that quietly ends early.
 */
export const ROOT_TAPER = 0.55;

/** Chance a root cell puts a flower above it, and how far along a branch it may start. */
export const ROOT_FLOWER_CHANCE = 0.14;
export const ROOT_FLOWER_MIN_STEP = 3;

/**
 * Hard ceiling on the voxels one cast may plan.
 *
 * The walk is random, so its natural size varies; a pool sized off the average
 * would come up short exactly when a cast happened to sprawl, and this repo's
 * pools fail *silently*. Capping the plan instead means the shortfall is a
 * slightly sparser root system rather than an effect that half-draws.
 */
export const ROOT_VOXELS_PER_CAST = 288;

/**
 * Root systems that may be alive at once.
 *
 * Raízes Entrelaçadas lasts two seconds against a global cast cooldown of 0.75,
 * so one team can have three overlapping in the worst case. Both teams casting
 * it at once is possible but not worth doubling the pool for: the fourth system
 * replaces the oldest, which is the same rule every other pool here uses.
 */
export const ROOT_SYSTEM_POOL = 3;

/** Instances the renderer keeps. Held against the two figures above by a test. */
export const ROOT_VOXEL_POOL = ROOT_VOXELS_PER_CAST * ROOT_SYSTEM_POOL;

/** How fast a cube reaches full size once its turn comes, and how far it overshoots. */
export const ROOT_GROW_RATE = 12;
export const ROOT_BOUNCE = 0.4;

/** Seconds at the end of the effect spent pulling back into the ground. */
export const ROOT_RETRACT_TIME = 0.45;
/** Retraction rate, and how much a late voxel lingers past an early one. */
export const ROOT_RETRACT_RATE = 5;
export const ROOT_RETRACT_STAGGER = 0.3;

/** One cube of a root system, in metres relative to the cast point. */
export interface RootVoxel {
  /** Gameplay ground plane, relative to the centre of the cast. */
  readonly x: number;
  readonly y: number;
  /** Above the ground. Roots crawl low; flowers sit a cell higher. */
  readonly height: number;
  /** Seconds after the cast at which this cube appears. */
  readonly time: number;
  /** Flowers are drawn in the accent colour and slightly smaller. */
  readonly flower: boolean;
  /** Size of this cube as a fraction of a full cell; see {@link ROOT_TAPER}. */
  readonly taper: number;
}

function snap(v: number): number {
  return Math.round(v / ROOT_VOXEL_SIZE) * ROOT_VOXEL_SIZE;
}

function keyOf(x: number, y: number, height: number): string {
  return `${x.toFixed(3)},${y.toFixed(3)},${height.toFixed(3)}`;
}

/**
 * Plans one root system inside `radius`.
 *
 * `rand` is a parameter rather than `Math.random` for the same reason the
 * cast sounds take their detune roll as one: a layout whose only check is
 * "it looked right once" is a layout that drifts. Nothing here reaches the
 * simulation, so this is repeatability for the tests, not determinism for the
 * wire.
 */
export function planRootGrowth(radius: number, rand: () => number = Math.random): RootVoxel[] {
  const out: RootVoxel[] = [];
  const visited = new Set<string>();
  // Roots stay under knee height: the card holds feet, and cubes at chest level
  // would hide the bodies the player is watching to read his own program.
  const ceiling = 0.42;

  for (let b = 0; b < ROOT_BRANCHES && out.length < ROOT_VOXELS_PER_CAST; b++) {
    let px = 0;
    let py = 0;
    let ph = 0;
    const angle = (b / ROOT_BRANCHES) * Math.PI * 2 + rand() * 0.5;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    let dh = 0.25;
    const delay = rand() * 0.08;

    for (let step = 0; step < ROOT_STEPS && out.length < ROOT_VOXELS_PER_CAST; step++) {
      px += dx * ROOT_VOXEL_SIZE;
      py += dy * ROOT_VOXEL_SIZE;
      ph += dh * ROOT_VOXEL_SIZE;

      // Wander, then renormalise, so a branch curls instead of running straight.
      dx += (rand() - 0.5) * 0.8;
      dy += (rand() - 0.5) * 0.8;
      dh += (rand() - 0.5) * 0.6;
      const len = Math.hypot(dx, dy, dh) || 1;
      dx /= len;
      dy /= len;
      dh /= len;

      if (ph < 0) {
        ph = 0;
        dh = Math.abs(dh);
      }
      if (ph > ceiling) dh -= 0.3;

      const vx = snap(px);
      const vy = snap(py);
      const vh = snap(ph);

      // Clipped rather than clamped: a branch that would leave the card's area
      // simply stops, so the system never claims ground the spell did not catch.
      if (Math.hypot(vx, vy) > radius) break;

      const key = keyOf(vx, vy, vh);
      if (visited.has(key)) continue;
      visited.add(key);

      const time = delay + step * 0.012;
      const taper = 1 - (step / ROOT_STEPS) * ROOT_TAPER;
      out.push({ x: vx, y: vy, height: vh, time, flower: false, taper });

      if (step >= ROOT_FLOWER_MIN_STEP && rand() < ROOT_FLOWER_CHANCE) {
        pushFlower(out, visited, vx, vy, vh + ROOT_VOXEL_SIZE, time + 0.1, radius, taper, rand);
      }
    }
  }

  return out;
}

/**
 * A flower: a small cross of cubes over a root cell.
 *
 * Four cells rather than the reference's six. That shape was built for a garden
 * seen from twenty metres up; here it sits on a three-metre disc under a squad
 * of mages, and the two extra arms only ever cost instances that the cap would
 * rather spend on reach.
 */
function pushFlower(
  out: RootVoxel[],
  visited: Set<string>,
  x: number,
  y: number,
  height: number,
  time: number,
  radius: number,
  taper: number,
  rand: () => number,
): void {
  const s = ROOT_VOXEL_SIZE;
  const offsets: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [s, 0, 0],
    [-s, 0, 0],
    [0, s, 0],
  ];

  for (const [ox, oy, oh] of offsets) {
    if (out.length >= ROOT_VOXELS_PER_CAST) return;
    const fx = x + ox;
    const fy = y + oy;
    const fh = height + oh;
    if (Math.hypot(fx, fy) > radius) continue;

    const key = keyOf(fx, fy, fh);
    if (visited.has(key)) continue;
    visited.add(key);
    // A bloom is the one part that does not thin away — it is the accent the
    // eye lands on, and a tapered flower at the tip of a branch is invisible.
    out.push({ x: fx, y: fy, height: fh, time: time + rand() * 0.1, flower: true, taper: Math.max(taper, 0.8) });
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How big a cube is, `elapsed` seconds into an effect that lasts `life`.
 *
 * Three phases: nothing before its turn, a bounce on the way up, and a
 * staggered retraction at the end. The overshoot is what makes a cube read as
 * pushing out of the soil rather than fading in, and the stagger is what makes
 * the system withdraw toward its centre instead of blinking out — the tips
 * arrived last and leave last.
 */
export function rootVoxelScale(voxel: RootVoxel, elapsed: number, life: number): number {
  const remaining = life - elapsed;
  if (remaining < ROOT_RETRACT_TIME) {
    return clamp01((remaining - voxel.time * ROOT_RETRACT_STAGGER) * ROOT_RETRACT_RATE);
  }

  if (elapsed < voxel.time) return 0;

  const grow = Math.min(1, (elapsed - voxel.time) * ROOT_GROW_RATE);
  return grow < 1 ? grow + Math.sin(grow * Math.PI) * ROOT_BOUNCE : 1;
}
