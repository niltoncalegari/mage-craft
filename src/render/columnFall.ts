/**
 * Where and when the impacts of a `column` cast land.
 *
 * Split out of the renderer because it is the half of the shape that can be
 * checked without an eye: a shower is a claim about *distribution* — several
 * impacts, spread over the area, spread over time — and that claim is
 * arithmetic. Only the drawing needs looking at.
 */

/**
 * Seconds a body spends in the air. Lives here rather than in the renderer
 * because it is half of the pool arithmetic below, and the two must agree.
 */
export const METEOR_FALL_TIME = 0.28;

/**
 * Falling bodies the renderer keeps meshes for.
 *
 * Sized off {@link peakConcurrentMeteors} and held there by a test, because
 * this repo's pools fail *silently* when they run dry — `spawnZone` returns
 * without drawing. A shower quietly dropping half its meteors reads as a
 * weaker card rather than as a bug, which is the worst kind of thing to leave
 * to a guessed constant.
 */
export const METEOR_POOL_SIZE = 8;

/**
 * How many bodies are airborne at the same moment, for a shower of `count`
 * spread over `window` seconds.
 *
 * The impacts are evenly spaced, so one leaves every `window / count` seconds
 * and each lasts `fallTime`.
 */
export function peakConcurrentMeteors(
  count: number,
  window: number,
  fallTime: number = METEOR_FALL_TIME,
): number {
  if (count <= 0) return 0;
  const spacing = window / count;
  if (spacing <= 0) return count;
  return Math.min(count, Math.ceil(fallTime / spacing));
}

/* ---- What a shower costs ---------------------------------------------------
 *
 * The fire it sheds and the debris it throws are cubes out of a pool of their
 * own, and the tuning figures below are the inputs to that pool's size. They
 * live next to the arithmetic rather than in the renderer because a test holds
 * one against the other, and a budget whose inputs sit in a different file is
 * a budget that quietly goes stale.
 */

/** Embers per second shed by a falling stone, and how long one lasts. */
export const METEOR_TRAIL_RATE = 55;
export const METEOR_TRAIL_LIFE = 0.32;
/** Chunks thrown up where a stone breaks, and how long they lie around. */
export const METEOR_DEBRIS_COUNT = 12;
export const METEOR_DEBRIS_LIFE = 0.9;

/** Cube particles the renderer keeps meshes for; see {@link liveParticles}. */
export const VOXEL_POOL_SIZE = 256;

/**
 * How many particles of a repeating emission are alive at once: `perEvent`
 * spawned every `interval` seconds, each lasting `life`.
 *
 * Covers both shapes this file has to budget for — a steady trail is one
 * particle on a very short interval, a debris burst is many on a long one.
 */
export function liveParticles(perEvent: number, interval: number, life: number): number {
  if (perEvent <= 0 || interval <= 0) return 0;
  return perEvent * Math.max(1, Math.ceil(life / interval));
}

export interface ColumnImpact {
  /** Offset from the cast centre, in world units. */
  readonly dx: number;
  readonly dy: number;
  /** Seconds after the cast before this one lands. */
  readonly at: number;
}

export function planColumnFall(
  count: number,
  radius: number,
  window: number,
  rand: () => number = Math.random,
): readonly ColumnImpact[] {
  const impacts: ColumnImpact[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    // sqrt keeps the scatter even over the disc; a flat random clumps at the
    // centre, which is the failure this whole function exists to avoid.
    const dist = Math.sqrt(rand()) * radius;
    impacts.push({
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      at: (i / count) * window,
    });
  }
  return impacts;
}
