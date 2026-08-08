/**
 * The loaded, simulation-ready play space: bounds, obstacles and spawns,
 * parsed from the very same `public/maps/*.json` files the client renders.
 *
 * This is the file that ended the server's duplicate map: there is now exactly
 * one copy of every map on disk, and one implementation of "does this block
 * movement / a projectile / line of sight".
 *
 * Footprints and blocking flags mirror `src/game/Obstacle.ts`'s TEMPLATES;
 * `topHeight` mirrors `src/game/config.ts`'s OBSTACLE_HEIGHT. `Arena.test.ts`
 * asserts both against the client's own tables rather than trusting a comment.
 */

import { MAGE_RADIUS, OBSTACLE_TOP_HEIGHT } from './config';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { clamp, Vec2 } from './Vec2';

export type ObstacleType = 'tree' | 'rock' | 'fort' | 'fence' | 'prop';

/* ---- JSON map schema (mirrors src/game/types.ts MapData) ------------------ */

export interface MapObjectData {
  type: ObstacleType;
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface MapSpawnData {
  /** The client's POV-relative team names, as stored in the map files. */
  team: 'player' | 'enemy';
  x: number;
  y: number;
}

/**
 * A Core/Tower placement (GDD §5). Structures are map *data* like spawns are:
 * the Arena carries the immutable placement, and `World` instantiates the live,
 * damageable entity from it.
 */
export interface MapStructureData {
  kind: 'core' | 'tower';
  /** The client's POV-relative team names, matching `MapSpawnData`. */
  team: 'player' | 'enemy';
  x: number;
  y: number;
}

export interface MapData {
  name?: string;
  width: number;
  height: number;
  objects: MapObjectData[];
  spawns?: MapSpawnData[];
  structures?: MapStructureData[];
}

interface ObstacleTemplate {
  isRect: boolean;
  radius: number;
  width: number;
  height: number;
  blocksSight: boolean;
  blocksProjectiles: boolean;
  blocksMovement: boolean;
  topHeight: number;
}

const TEMPLATES: Readonly<Record<ObstacleType, ObstacleTemplate>> = {
  tree: {
    isRect: false,
    radius: 0.35,
    width: 0,
    height: 0,
    blocksSight: true,
    blocksProjectiles: true,
    blocksMovement: true,
    topHeight: OBSTACLE_TOP_HEIGHT.tree,
  },
  rock: {
    isRect: false,
    radius: 0.6,
    width: 0,
    height: 0,
    blocksSight: true,
    blocksProjectiles: true,
    blocksMovement: true,
    topHeight: OBSTACLE_TOP_HEIGHT.rock,
  },
  fort: {
    isRect: true,
    radius: 0,
    width: 2.4,
    height: 1.2,
    blocksSight: true,
    blocksProjectiles: true,
    blocksMovement: true,
    topHeight: OBSTACLE_TOP_HEIGHT.fort,
  },
  fence: {
    isRect: true,
    radius: 0,
    width: 2,
    height: 0.24,
    blocksSight: false,
    blocksProjectiles: true,
    blocksMovement: true,
    topHeight: OBSTACLE_TOP_HEIGHT.fence,
  },
  prop: {
    isRect: false,
    radius: 0.3,
    width: 0,
    height: 0,
    blocksSight: false,
    blocksProjectiles: false,
    blocksMovement: false,
    topHeight: OBSTACLE_TOP_HEIGHT.prop,
  },
};

/** A simulation-ready arena object. Circles use `radius`; rectangles are axis-aligned and centred on `position`. */
export interface Obstacle {
  type: ObstacleType;
  position: Vec2;

  isRect: boolean;
  radius: number;
  halfW: number;
  halfH: number;

  blocksSight: boolean;
  blocksProjectiles: boolean;
  blocksMovement: boolean;
  topHeight: number;
}

export interface SpawnPoint {
  team: Team;
  pos: Vec2;
}

/** Immutable placement of a Core/Tower; `World` builds the live entity from it. */
export interface StructurePlacement {
  kind: 'core' | 'tower';
  team: Team;
  pos: Vec2;
}

const LOS_SAMPLE_STEP = 0.25;
const SPAWN_FALLBACK_LANES = 6;

export class Arena {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly obstacles: Obstacle[] = [],
    readonly spawns: SpawnPoint[] = [],
    readonly structures: StructurePlacement[] = [],
  ) {}

  /** Builds an Arena from map JSON in the client's schema. */
  static parse(data: MapData): Arena {
    if (!(data.width > 0) || !(data.height > 0)) {
      throw new Error(`sim: map has non-positive size ${data.width}x${data.height}`);
    }

    const obstacles = (data.objects ?? []).map((obj): Obstacle => {
      const tpl = TEMPLATES[obj.type];
      if (!tpl) throw new Error(`sim: unknown obstacle type ${JSON.stringify(obj.type)}`);

      const w = obj.width ?? tpl.width;
      const h = obj.height ?? tpl.height;
      return {
        type: obj.type,
        position: new Vec2(obj.x, obj.y),
        isRect: tpl.isRect,
        radius: tpl.isRect ? 0 : (obj.radius ?? tpl.radius),
        halfW: tpl.isRect ? w / 2 : 0,
        halfH: tpl.isRect ? h / 2 : 0,
        blocksSight: tpl.blocksSight,
        blocksProjectiles: tpl.blocksProjectiles,
        blocksMovement: tpl.blocksMovement,
        topHeight: tpl.topHeight,
      };
    });

    const spawns = (data.spawns ?? []).map(
      (s): SpawnPoint => ({
        team: s.team === 'enemy' ? TEAM_B : TEAM_A,
        pos: new Vec2(s.x, s.y),
      }),
    );

    const structures = (data.structures ?? []).map((s): StructurePlacement => {
      if (s.kind !== 'core' && s.kind !== 'tower') {
        throw new Error(`sim: unknown structure kind ${JSON.stringify(s.kind)}`);
      }
      return {
        kind: s.kind,
        team: s.team === 'enemy' ? TEAM_B : TEAM_A,
        pos: new Vec2(s.x, s.y),
      };
    });

    return new Arena(data.width, data.height, obstacles, spawns, structures);
  }

  /**
   * The `idx`-th spawn for a team, falling back to a generated position along
   * that team's back line when the map defines fewer spawns than the room has
   * seats (rooms go up to 6v6). Lanes that would drop a mage inside an
   * obstacle are skipped.
   */
  spawnFor(team: Team, idx: number): Vec2 {
    let nth = 0;
    for (const s of this.spawns) {
      if (s.team !== team) continue;
      if (nth === idx) return s.pos;
      nth++;
    }

    const x = team === TEAM_B ? this.width / 2 - 4 : -this.width / 2 + 4;
    for (let attempt = 0; attempt < SPAWN_FALLBACK_LANES; attempt++) {
      const lane = (idx + attempt) % SPAWN_FALLBACK_LANES;
      const y =
        (lane - (SPAWN_FALLBACK_LANES - 1) / 2) * (this.height / (SPAWN_FALLBACK_LANES + 2));
      const pos = this.clamp(new Vec2(x, y), MAGE_RADIUS);
      if (!this.blocksMovementAt(pos, MAGE_RADIUS)) return pos;
    }
    return this.clamp(new Vec2(x, 0), MAGE_RADIUS);
  }

  /** Whether a circle of the given radius fits inside the arena bounds. */
  contains(p: Vec2, radius: number): boolean {
    const halfW = this.width / 2 - radius;
    const halfH = this.height / 2 - radius;
    return p.x >= -halfW && p.x <= halfW && p.y >= -halfH && p.y <= halfH;
  }

  /** Keeps a circle of the given radius inside the arena bounds. */
  clamp(p: Vec2, radius: number): Vec2 {
    const halfW = this.width / 2 - radius;
    const halfH = this.height / 2 - radius;
    const x = p.x > halfW ? halfW : p.x < -halfW ? -halfW : p.x;
    const y = p.y > halfH ? halfH : p.y < -halfH ? -halfH : p.y;
    return x === p.x && y === p.y ? p : new Vec2(x, y);
  }

  /** Whether a point has left the arena rectangle entirely. */
  outOfBounds(p: Vec2): boolean {
    return (
      p.x < -this.width / 2 ||
      p.x > this.width / 2 ||
      p.y < -this.height / 2 ||
      p.y > this.height / 2
    );
  }

  /** Whether a circle at `p` would overlap a movement-blocking obstacle. */
  blocksMovementAt(p: Vec2, radius: number): boolean {
    return this.obstacles.some((o) => o.blocksMovement && overlapsCircle(o, p, radius));
  }

  /**
   * The offset that moves a circle of `radius` at `p` clear of every
   * movement-blocking obstacle, or a zero vector when it already is.
   *
   * A mage that ends up *inside* an obstacle can never walk out on its own —
   * every step from in there is blocked too, so it stands there for the rest of
   * the match. This is what gets it out. Inflating `radius` past MAGE_RADIUS
   * also turns it into a "which way is open" probe, which is how bot steering
   * uses it.
   */
  pushOutOfObstacles(p: Vec2, radius: number): Vec2 {
    let push = Vec2.zero;
    for (const o of this.obstacles) {
      if (!o.blocksMovement) continue;
      push = push.add(pushOutOf(o, p, radius));
    }
    return push;
  }

  /**
   * Whether a projectile of the given radius flying at the given height would
   * hit a projectile-blocking obstacle. Shots arcing above an obstacle's
   * `topHeight` pass over it (mirrors the client's CollisionSystem).
   */
  blocksProjectileAt(p: Vec2, radius: number, height: number): boolean {
    return this.obstacles.some(
      (o) => o.blocksProjectiles && height <= o.topHeight && overlapsCircle(o, p, radius),
    );
  }

  /**
   * Whether the segment from -> to is unobstructed by a sight-blocking
   * obstacle (mirrors `src/physics/LineOfSight.ts`). Sampled rather than solved
   * analytically: obstacles are small relative to the step, and this only feeds
   * bot targeting decisions.
   */
  hasLineOfSight(from: Vec2, to: Vec2): boolean {
    const delta = to.sub(from);
    const dist = delta.length();
    if (dist < 1e-9) return true;

    const steps = Math.floor(dist / LOS_SAMPLE_STEP) + 1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const point = new Vec2(from.x + delta.x * t, from.y + delta.y * t);
      for (const o of this.obstacles) {
        if (o.blocksSight && overlapsCircle(o, point, 0)) return false;
      }
    }
    return true;
  }
}

/**
 * The smallest offset that moves a circle of `radius` at `p` clear of `o`, or a
 * zero vector when the two do not overlap. Mirrors the client's
 * `computeCircleCirclePushout` / `computeCircleRectPushout` in MovementSystem.
 */
export function pushOutOf(o: Obstacle, p: Vec2, radius: number): Vec2 {
  if (!o.isRect) return pushOutOfCircle(o.position, o.radius, p, radius);

  const closestX = clamp(p.x, o.position.x - o.halfW, o.position.x + o.halfW);
  const closestY = clamp(p.y, o.position.y - o.halfH, o.position.y + o.halfH);
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq > 1e-12) {
    if (distSq >= radius * radius) return Vec2.zero;
    const dist = Math.sqrt(distSq);
    return new Vec2((dx / dist) * (radius - dist), (dy / dist) * (radius - dist));
  }

  // The centre is inside the rectangle: leave by whichever face is nearest.
  const left = p.x - (o.position.x - o.halfW);
  const right = o.position.x + o.halfW - p.x;
  const down = p.y - (o.position.y - o.halfH);
  const up = o.position.y + o.halfH - p.y;
  const min = Math.min(left, right, down, up);

  if (min === left) return new Vec2(-(radius + left), 0);
  if (min === right) return new Vec2(radius + right, 0);
  if (min === down) return new Vec2(0, -(radius + down));
  return new Vec2(0, radius + up);
}

/** {@link pushOutOf} for a bare circle — Towers and Cores are not obstacles. */
export function pushOutOfCircle(
  centre: Vec2,
  centreRadius: number,
  p: Vec2,
  radius: number,
): Vec2 {
  const delta = p.sub(centre);
  const min = centreRadius + radius;
  const distSq = delta.lengthSq();

  if (distSq >= min * min) return Vec2.zero;
  // Exactly concentric: any direction will do, and one has to be chosen
  // deterministically or two servers would push the same mage different ways.
  if (distSq <= 1e-12) return new Vec2(min, 0);

  const dist = Math.sqrt(distSq);
  return delta.scale((min - dist) / dist);
}

/** Whether a circle at `p` overlaps this obstacle's footprint. */
function overlapsCircle(o: Obstacle, p: Vec2, radius: number): boolean {
  if (!o.isRect) {
    const r = o.radius + radius;
    return p.sub(o.position).lengthSq() <= r * r;
  }
  // Closest point on the rectangle to the circle centre.
  const dx = Math.max(0, Math.abs(p.x - o.position.x) - o.halfW);
  const dy = Math.max(0, Math.abs(p.y - o.position.y) - o.halfH);
  return dx * dx + dy * dy <= radius * radius;
}
