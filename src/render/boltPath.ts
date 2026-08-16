/**
 * The path a `strike` cast's bolt takes, from an open sky down to the spot the
 * card was aimed at.
 *
 * Recursive midpoint displacement, from the reference Nilton built
 * (`raio_complexo_final`): start with a straight line, push each midpoint aside,
 * halve the push, repeat. That is what gives a bolt both a big sweep and fine
 * crackle at once — a single pass of per-point noise gives only one of the two,
 * and the difference is the whole reason lightning does not read as a scribble.
 *
 * Split from the renderer for the same reason as {@link planColumnFall} and
 * {@link planRootGrowth}: whether the arc connects the two points it claims to
 * is arithmetic, and only how it looks getting there is taste.
 */

/**
 * Points in the finished path — three generations of subdivision, 2 → 3 → 5 → 9.
 *
 * The count is a power of two plus one because that is what midpoint
 * displacement produces; {@link LightningBolt} sizes its buffers from this, so
 * the two cannot drift apart.
 */
export const BOLT_GENERATIONS = 3;
export const BOLT_POINTS = 2 ** BOLT_GENERATIONS + 1;

/** How far above the arena a strike starts, in metres. */
export const BOLT_STRIKE_HEIGHT = 14;

/** Lateral push applied at the first generation, before it starts halving. */
export const BOLT_BASE_OFFSET = 1.6;

/**
 * Traces a bolt to `(x, y)` on the gameplay plane, in Three coordinates.
 *
 * Returned flat as xyz triples so it can be handed straight to
 * {@link LightningBolt.updateFrom}, which re-skins a path someone else traced —
 * that is the seam that lets the core bolt and its glow share one arc instead
 * of wandering off on two separate random walks.
 *
 * `rand` is a parameter for the same reason the cast sounds take their detune
 * roll as one: nothing here reaches the simulation, so this is repeatability
 * for the tests rather than determinism for the wire.
 */
export function planBoltPath(
  x: number,
  y: number,
  spread = 1,
  rand: () => number = Math.random,
): Float32Array {
  // The top wanders, which is right for a strike out of an open sky. The bottom
  // does not: that is the spot the card actually caught people at, and it is
  // where the eye reads the card's aim from.
  let points: number[][] = [
    [x + (rand() - 0.5) * BOLT_BASE_OFFSET * 2 * spread, BOLT_STRIKE_HEIGHT, y + (rand() - 0.5) * BOLT_BASE_OFFSET * 2 * spread],
    [x, 0, y],
  ];

  let offset = BOLT_BASE_OFFSET * spread;

  for (let g = 0; g < BOLT_GENERATIONS; g++) {
    const next: number[][] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      next.push(a);
      next.push([
        (a[0] + b[0]) / 2 + (rand() - 0.5) * offset,
        // Height is displaced far less than the ground plane, and never enough
        // to climb: a bolt that doubles back upward stops reading as a fall.
        (a[1] + b[1]) / 2 + (rand() - 0.5) * offset * 0.12,
        (a[2] + b[2]) / 2 + (rand() - 0.5) * offset,
      ]);
    }

    next.push(points[points.length - 1]);
    points = next;
    offset /= 2;
  }

  // Monotone descent, enforced rather than hoped for. The vertical jitter above
  // is small, but a midpoint that happened to rise past its predecessor would
  // put a hook in the arc, and a hook reads as a mistake rather than as energy.
  for (let i = 1; i < points.length; i++) {
    if (points[i][1] > points[i - 1][1]) points[i][1] = points[i - 1][1];
  }

  const out = new Float32Array(BOLT_POINTS * 3);
  for (let i = 0; i < BOLT_POINTS; i++) {
    out[i * 3] = points[i][0];
    out[i * 3 + 1] = points[i][1];
    out[i * 3 + 2] = points[i][2];
  }
  return out;
}
