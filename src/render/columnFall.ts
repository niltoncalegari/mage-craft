/**
 * Where and when the impacts of a `column` cast land.
 *
 * Split out of the renderer because it is the half of the shape that can be
 * checked without an eye: a shower is a claim about *distribution* — several
 * impacts, spread over the area, spread over time — and that claim is
 * arithmetic. Only the drawing needs looking at.
 */

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
