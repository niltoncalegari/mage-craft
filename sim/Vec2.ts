/**
 * Immutable 2D vector for the authoritative simulation.
 *
 * Deliberately *not* `src/utils/Vector2` — that one mutates in place to avoid
 * per-frame allocations in the render hot path, which makes aliasing bugs easy
 * (`a.position = b.position` then mutating either). The server sim runs at 60Hz
 * with a handful of entities, so value semantics are free here and remove a
 * whole class of mistakes. Mirrors the semantics of the Go `game.Vec2` this
 * replaced, one method at a time.
 */
export class Vec2 {
  static readonly zero = new Vec2(0, 0);

  constructor(
    readonly x = 0,
    readonly y = 0,
  ) {}

  add(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }

  sub(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  distanceTo(o: Vec2): number {
    return Math.hypot(this.x - o.x, this.y - o.y);
  }

  dot(o: Vec2): number {
    return this.x * o.x + this.y * o.y;
  }

  /** Unit vector in the same direction, or zero when (near) zero-length. */
  normalized(): Vec2 {
    const l = this.length();
    if (l < 1e-9) return Vec2.zero;
    return new Vec2(this.x / l, this.y / l);
  }

  /** Shortens to at most `max`, leaving shorter vectors untouched. */
  clampLength(max: number): Vec2 {
    const l = this.length();
    if (l > max && l > 1e-9) return new Vec2((this.x / l) * max, (this.y / l) * max);
    return this;
  }

  /** Rotates by `radians` counter-clockwise. */
  rotate(radians: number): Vec2 {
    const s = Math.sin(radians);
    const c = Math.cos(radians);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  /**
   * Steps toward `target` by at most `maxDelta`, per component — matching the
   * client's `moveTowards` applied the way MovementSystem accelerates.
   */
  moveTowards(target: Vec2, maxDelta: number): Vec2 {
    return new Vec2(
      moveTowards(this.x, target.x, maxDelta),
      moveTowards(this.y, target.y, maxDelta),
    );
  }

  /**
   * Turns this unit vector toward `target` by at most `maxRadians`, mirroring
   * the client's `rotateTowards` — how a mage turns its body/aim smoothly
   * instead of snapping.
   */
  rotateTowards(target: Vec2, maxRadians: number): Vec2 {
    if (this.lengthSq() < 1e-9) return target;
    if (target.lengthSq() < 1e-9) return this;

    let from = Math.atan2(this.y, this.x);
    const to = Math.atan2(target.y, target.x);
    // `to - from` is in (-2pi, 2pi), so the +3pi shift keeps the dividend
    // positive and `%` behaves like Go's math.Mod here.
    const delta = ((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

    if (Math.abs(delta) <= maxRadians) return target.normalized();
    from += delta > 0 ? maxRadians : -maxRadians;
    return new Vec2(Math.cos(from), Math.sin(from));
  }
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + (delta > 0 ? maxDelta : -maxDelta);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  if (Math.abs(b - a) < 1e-9) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}
