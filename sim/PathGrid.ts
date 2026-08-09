/**
 * An 8-way A* grid over the arena's movement blockers — the server-side
 * counterpart of the client's `src/physics/Pathfinding.ts`.
 *
 * Practice mode has had a path planner since the beginning; online bots did
 * not, so they walked straight into a Tower (or the Core) and ground against it
 * forever. This is the lean port that closes that gap.
 *
 * The one design difference from the client's grid: blocking is not read off
 * the obstacle list here, it is a *predicate* supplied by the caller. `World`
 * closes over its own `isBlocked` — obstacles **and** live structures — so the
 * planner and the physics can never disagree about what is solid, which is the
 * bug this file exists to kill. The predicate is expected to already account
 * for the mage's radius, exactly as `World.isBlocked` does.
 */

import type { Arena } from './Arena';
import { Vec2 } from './Vec2';

/**
 * Half a world unit per cell — one body radius.
 *
 * The client's grid uses whole units, which it gets away with because its
 * obstacles are small and its MovementSystem pushes bodies out of them every
 * frame. On the siege map, fences and Towers sit off the whole-unit lattice,
 * and a cell that coarse routes mages through gaps a body cannot fit down.
 */
export const PATH_CELL_SIZE = 0.5;

const UNVISITED = 0;
const OPEN = 1;
const CLOSED = 2;

/** Binary heap over cell indices, ordered by an externally owned score array. */
class MinHeap {
  private readonly items: number[] = [];

  constructor(private readonly scores: Float64Array) {}

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(value: number): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): number {
    const first = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return first;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.scores[this.items[parent]] <= this.scores[this.items[child]]) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;

      if (left < this.items.length && this.scores[this.items[left]] < this.scores[this.items[best]]) {
        best = left;
      }
      if (right < this.items.length && this.scores[this.items[right]] < this.scores[this.items[best]]) {
        best = right;
      }
      if (best === parent) break;

      this.swap(parent, best);
      parent = best;
    }
  }

  private swap(a: number, b: number): void {
    const item = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = item;
  }
}

export class PathGrid {
  readonly columns: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly blockedCells: Uint8Array;

  /*
   * Search scratch, allocated once and refilled per query: a bot re-plans
   * whenever its destination moves, and 60Hz × a squad each allocating four
   * typed arrays is churn the sim does not need.
   */
  private readonly gScore: Float64Array;
  private readonly fScore: Float64Array;
  private readonly parent: Int32Array;
  private readonly state: Uint8Array;
  private readonly open: MinHeap;

  constructor(
    arena: Arena,
    private readonly isBlockedAt: (p: Vec2) => boolean,
    private readonly cellSize = PATH_CELL_SIZE,
  ) {
    this.columns = Math.max(1, Math.ceil(arena.width / cellSize));
    this.rows = Math.max(1, Math.ceil(arena.height / cellSize));
    this.minX = -arena.width / 2;
    this.minY = -arena.height / 2;

    const count = this.columns * this.rows;
    this.blockedCells = new Uint8Array(count);
    this.gScore = new Float64Array(count);
    this.fScore = new Float64Array(count);
    this.parent = new Int32Array(count);
    this.state = new Uint8Array(count);
    this.open = new MinHeap(this.fScore);

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const centre = this.cellCentre(x, y);
        if (isBlockedAt(centre)) this.blockedCells[this.index(x, y)] = 1;
      }
    }
  }

  /**
   * World-space waypoints from `from` to `to`, excluding the starting point,
   * or null when no route exists. A start or goal sitting inside a blocker is
   * snapped to the nearest free cell rather than failing outright — a mage
   * shoved into a Tower still has to be able to walk out.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const start = this.nearestFreeCell(from);
    const goalCell = this.worldToCellClamped(to);
    const goal = this.nearestFreeCell(to);
    if (!start || !goal) return null;

    const startIndex = this.index(start.x, start.y);
    const goalIndex = this.index(goal.x, goal.y);
    if (startIndex === goalIndex) return [to];

    const count = this.columns * this.rows;
    this.gScore.fill(Number.POSITIVE_INFINITY);
    this.fScore.fill(Number.POSITIVE_INFINITY);
    this.parent.fill(-1);
    this.state.fill(UNVISITED, 0, count);
    this.open.clear();

    this.gScore[startIndex] = 0;
    this.fScore[startIndex] = heuristic(start.x, start.y, goal.x, goal.y);
    this.open.push(startIndex);
    this.state[startIndex] = OPEN;

    while (this.open.length > 0) {
      const current = this.open.pop();
      if (this.state[current] === CLOSED) continue;
      if (current === goalIndex) {
        // Finish on the exact point asked for only when it is walkable *and*
        // it is the cell the route ends in. A free cell can still hold a
        // blocked point — the grid only ever sampled its centre.
        const exact =
          goal.x === goalCell.x && goal.y === goalCell.y && !this.isBlockedAt(to);
        return this.reconstructPath(current, exact ? to : null);
      }

      this.state[current] = CLOSED;
      const cx = current % this.columns;
      const cy = Math.floor(current / this.columns);

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (!this.canEnter(cx, cy, nx, ny)) continue;

          const neighbor = this.index(nx, ny);
          if (this.state[neighbor] === CLOSED) continue;

          const stepCost = ox !== 0 && oy !== 0 ? Math.SQRT2 : 1;
          const tentative = this.gScore[current] + stepCost;
          if (tentative >= this.gScore[neighbor]) continue;

          this.parent[neighbor] = current;
          this.gScore[neighbor] = tentative;
          this.fScore[neighbor] = tentative + heuristic(nx, ny, goal.x, goal.y);
          this.open.push(neighbor);
          this.state[neighbor] = OPEN;
        }
      }
    }

    return null;
  }

  /** The centre of the closest walkable cell to `p`, or null on a fully solid grid. */
  nearestFree(p: Vec2): Vec2 | null {
    const cell = this.nearestFreeCell(p);
    return cell ? this.cellCentre(cell.x, cell.y) : null;
  }

  /** Whether the cell containing `p` is solid (outside the grid counts as solid). */
  isBlocked(p: Vec2): boolean {
    const cell = this.worldToCellClamped(p);
    if (!this.inBounds(cell.x, cell.y)) return true;
    return this.isCellBlocked(cell.x, cell.y);
  }

  /* ---- internals --------------------------------------------------------- */

  private reconstructPath(goalIndex: number, exactGoal: Vec2 | null): Vec2[] {
    const reversed: number[] = [];
    let current = goalIndex;
    while (current !== -1) {
      reversed.push(current);
      current = this.parent[current];
    }

    // Drop the start cell: the caller is already standing there.
    const waypoints: Vec2[] = [];
    for (let i = reversed.length - 2; i >= 0; i--) {
      const index = reversed[i];
      waypoints.push(this.cellCentre(index % this.columns, Math.floor(index / this.columns)));
    }

    const smoothed = dropColinear(waypoints);
    // Only when the goal itself was walkable is it safe to walk to the exact
    // point; a snapped goal must stop at the free cell that stood in for it.
    if (exactGoal && smoothed.length > 0) smoothed[smoothed.length - 1] = exactGoal;
    return smoothed;
  }

  private nearestFreeCell(p: Vec2): { x: number; y: number } | null {
    const origin = this.worldToCellClamped(p);
    if (this.inBounds(origin.x, origin.y) && !this.isCellBlocked(origin.x, origin.y)) return origin;

    const maxRadius = Math.max(this.columns, this.rows);
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best: { x: number; y: number } | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;

      for (let cy = origin.y - radius; cy <= origin.y + radius; cy++) {
        for (let cx = origin.x - radius; cx <= origin.x + radius; cx++) {
          // Only the ring itself — inner cells were covered by earlier passes.
          if (Math.abs(cx - origin.x) !== radius && Math.abs(cy - origin.y) !== radius) continue;
          if (!this.inBounds(cx, cy) || this.isCellBlocked(cx, cy)) continue;

          const centre = this.cellCentre(cx, cy);
          const distSq = centre.sub(p).lengthSq();
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = { x: cx, y: cy };
          }
        }
      }
      if (best) return best;
    }

    return null;
  }

  /** Diagonals may not cut a corner between two blockers. */
  private canEnter(cx: number, cy: number, nx: number, ny: number): boolean {
    if (!this.inBounds(nx, ny) || this.isCellBlocked(nx, ny)) return false;

    const dx = nx - cx;
    const dy = ny - cy;
    if (dx !== 0 && dy !== 0) {
      return !this.isCellBlocked(cx + dx, cy) && !this.isCellBlocked(cx, cy + dy);
    }
    return true;
  }

  private worldToCellClamped(p: Vec2): { x: number; y: number } {
    return {
      x: clampIndex(Math.floor((p.x - this.minX) / this.cellSize), this.columns),
      y: clampIndex(Math.floor((p.y - this.minY) / this.cellSize), this.rows),
    };
  }

  private cellCentre(x: number, y: number): Vec2 {
    return new Vec2(this.minX + (x + 0.5) * this.cellSize, this.minY + (y + 0.5) * this.cellSize);
  }

  private index(x: number, y: number): number {
    return y * this.columns + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.columns && y >= 0 && y < this.rows;
  }

  private isCellBlocked(x: number, y: number): boolean {
    return this.blockedCells[this.index(x, y)] !== 0;
  }
}

/** Octile distance — admissible for 8-way movement with a √2 diagonal. */
function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/** Keeps only the cells where the path actually turns. */
function dropColinear(path: Vec2[]): Vec2[] {
  if (path.length <= 2) return path;

  const result: Vec2[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const previous = result[result.length - 1];
    const current = path[i];
    const next = path[i + 1];
    const turnsX = Math.sign(current.x - previous.x) !== Math.sign(next.x - current.x);
    const turnsY = Math.sign(current.y - previous.y) !== Math.sign(next.y - current.y);
    if (turnsX || turnsY) result.push(current);
  }
  result.push(path[path.length - 1]);
  return result;
}

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}
