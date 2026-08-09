/**
 * The squad-level plan (GDD §11).
 *
 * `Brain.ts` decides what *one* mage does. This decides what the *team* is
 * trying to do, and it exists because the per-mage utility model has no way to
 * express the two things that actually win a match (GDD §4):
 *
 * 1. **Commit to one structure.** Every mage picking its own nearest objective
 *    splits a four-mage squad across two Towers, and neither half out-damages a
 *    Tower's own defence. One plan, one Tower, whole squad.
 * 2. **Know whether you are ahead.** Two squads that both push are in a *race*,
 *    and a race resolves — that is how a match ends. Two squads that both turn
 *    around to defend deadlock, which is the 100%-draw failure GDD §14 flags.
 *    So only the side that is *losing* the race defends.
 *
 * The plan is advisory: `Brain` still scores its own actions, and a mage being
 * shot at still dodges, takes cover and runs. This only supplies the intent
 * those scores are measured against.
 */

import { MAGE_RADIUS, TOWER_RANGE } from '../config';
import { opponentOf, TEAM_A, TEAM_B, type Mage, type Structure, type Team } from '../entities';
import { ROLE_BEHAVIOR } from '../roles';
import { clamp, Vec2 } from '../Vec2';
import type { World } from '../World';

/**
 * What the squad is trying to do right now.
 *
 * - `push` — break the objective. The default, and deliberately the default:
 *   structures are the only thing that wins.
 * - `defend` — the enemy is further along its own push than we are along ours,
 *   and it is standing in our ground. Turning around is worth more than another
 *   scratch on their Tower.
 * - `regroup` — we are outnumbered on the field. Walking in one at a time is
 *   how a deficit becomes a lost Core; fall back under our own Tower and let
 *   the respawns catch up (GDD §4 — mages always come back).
 */
export type Posture = 'push' | 'defend' | 'regroup';

export interface SquadPlan {
  readonly posture: Posture;
  /** The one structure the whole squad is committed to. Null only if none is targetable. */
  readonly objective: Structure | null;
  /** Where the squad falls back to and stages from — inside our own Tower's cover. */
  readonly rally: Vec2;
  /** The enemy deepest into our ground, and the thing `defend` answers. */
  readonly threat: Mage | null;
  /**
   * The mage that is supposed to be *nearest* the objective, and therefore the
   * one its Tower shoots (`World.towerTarget` picks the closest body it can
   * see). Empty when the squad has nobody who should be soaking.
   */
  readonly anchorId: string;
  /** True once enough of the squad is near the objective to be worth diving. */
  readonly committed: boolean;
}

/** Seconds between re-plans. A squad that re-decides every tick has no plan at all. */
const PLAN_INTERVAL = 0.5;

/**
 * How far an enemy may be from one of our live structures and still count as an
 * intruder. A Tower's own range plus a step, so "it is being shot at by our
 * Tower" and "it is a threat" mean the same thing.
 */
const HOME_RADIUS = TOWER_RANGE + 2;

/**
 * How far behind in the race we must be before turning around. Without a margin
 * the two squads trade postures every time a projectile lands and neither ever
 * finishes anything.
 */
const DEFEND_MARGIN = 0.3;

/** Living-mage deficit that turns a push into a fallback. */
const REGROUP_DEFICIT = 2;

/** Bonus that keeps last plan's objective in front, so a squad does not swap Towers mid-push. */
const OBJECTIVE_STICKINESS = 0.35;

/** How close an attacker must be to the objective to count toward `committed`. */
const COMMIT_RADIUS = TOWER_RANGE * 1.4;

/** How far in front of our own structure the rally point sits. */
const RALLY_LEAD = TOWER_RANGE * 0.7;

const EPSILON = 1e-9;

/**
 * Computes and caches one plan per team. One planner per match, owned by the
 * `Brain` that drives both squads.
 */
export class SquadPlanner {
  private readonly plans = new Map<Team, SquadPlan>();
  private timer = 0;

  /**
   * Refreshes both plans on `PLAN_INTERVAL`, or immediately when a cached
   * objective has fallen — a squad still walking at a dead Tower is the one
   * case where waiting out the interval is visibly broken.
   */
  step(w: World, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0 && !this.objectiveStale()) return;

    this.timer = PLAN_INTERVAL;
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      this.plans.set(team, this.build(w, team));
    }
  }

  /** The current plan for `team`; a neutral one before the first `step`. */
  planFor(team: Team): SquadPlan {
    return this.plans.get(team) ?? IDLE_PLAN;
  }

  private objectiveStale(): boolean {
    for (const plan of this.plans.values()) {
      const o = plan.objective;
      if (!o) return true;
      if (!o.alive || o.invulnerable) return true;
    }
    return this.plans.size === 0;
  }

  private build(w: World, team: Team): SquadPlan {
    const previous = this.plans.get(team);
    const living = livingOf(w, team);
    const enemies = livingOf(w, opponentOf(team));

    const objective = chooseObjective(w, team, living, previous?.objective?.id ?? null);
    const threat = deepestIntruder(w, team);
    const posture = choosePosture(w, team, living, enemies, threat);
    const anchorId = chooseAnchor(living, objective);
    const rally = rallyPoint(w, team, objective);
    const committed = isCommitted(living, objective);

    return { posture, objective, rally, threat, anchorId, committed };
  }
}

const IDLE_PLAN: SquadPlan = {
  posture: 'push',
  objective: null,
  rally: Vec2.zero,
  threat: null,
  anchorId: '',
  committed: false,
};

/* ---- objective ----------------------------------------------------------- */

/**
 * The structure the whole squad commits to.
 *
 * Structure damage never regenerates, so a half-broken Tower is worth far more
 * than a fresh one — `hurt` is weighted to dominate as soon as one has taken a
 * real beating. Distance only decides the opening pick, when both Towers are
 * untouched, and stickiness stops the choice oscillating as the squad moves.
 */
function chooseObjective(
  w: World,
  team: Team,
  living: readonly Mage[],
  previousId: string | null,
): Structure | null {
  // Already sorted by id, already filtered to alive-and-vulnerable (Towers
  // before Core, since a Core is invulnerable while a Tower of its team stands).
  const candidates = w.targetableStructuresFor(team);
  if (candidates.length === 0) return null;

  const centre = centroid(living) ?? Vec2.zero;
  const span = w.arena.width + w.arena.height;

  let best: Structure | null = null;
  let bestScore = -Infinity;
  for (const s of candidates) {
    const hurt = s.maxHealth > 0 ? 1 - clamp(s.health / s.maxHealth, 0, 1) : 0;
    const near = 1 - clamp(centre.distanceTo(s.position) / span, 0, 1);
    const score = hurt * 2 + near + (s.id === previousId ? OBJECTIVE_STICKINESS : 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/* ---- posture ------------------------------------------------------------- */

/**
 * How far along its push a team is, in structures: whole ones already down,
 * plus the fraction taken off the one it is working on. Directly comparable
 * between the two teams, which is the whole point — it is what decides who is
 * winning the race and therefore who can afford to keep pushing.
 */
export function siegeProgress(w: World, attacker: Team): number {
  let best = 0;
  for (const s of w.targetableStructuresFor(attacker)) {
    const taken = s.maxHealth > 0 ? 1 - clamp(s.health / s.maxHealth, 0, 1) : 0;
    if (taken > best) best = taken;
  }
  return w.structuresDestroyedBy(attacker) + best;
}

function choosePosture(
  w: World,
  team: Team,
  living: readonly Mage[],
  enemies: readonly Mage[],
  threat: Mage | null,
): Posture {
  // A Core with its Towers gone ends the match if it falls, so nothing else on
  // the board is worth more than answering someone standing next to it.
  const core = w.structuresOf(team).find((s) => s.kind === 'core' && s.alive);
  if (threat && core && !core.invulnerable && threat.position.distanceTo(core.position) <= HOME_RADIUS) {
    return 'defend';
  }

  if (enemies.length - living.length >= REGROUP_DEFICIT) return 'regroup';

  // Both squads pushing at once is a race, and a race is how a match resolves.
  // Only the side that is measurably behind turns around — if both did, neither
  // would ever finish a Tower, which is exactly the deadlock GDD §14 warns of.
  if (threat && siegeProgress(w, opponentOf(team)) > siegeProgress(w, team) + DEFEND_MARGIN) {
    return 'defend';
  }
  return 'push';
}

/** The living enemy closest to any of our live structures, if one is close enough to matter. */
function deepestIntruder(w: World, team: Team): Mage | null {
  const ours = w.structuresOf(team).filter((s) => s.alive);
  if (ours.length === 0) return null;

  let best: Mage | null = null;
  let bestDist = HOME_RADIUS;
  for (const m of livingOf(w, opponentOf(team))) {
    for (const s of ours) {
      const d = m.position.distanceTo(s.position) - s.radius;
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
  }
  return best;
}

/* ---- roles within the plan ----------------------------------------------- */

/**
 * Who stands closest to the objective and eats its Tower's fire.
 *
 * A Tower shoots whoever is nearest that it can see (`World.towerTarget`), so
 * this is not a label — it is the only lever the AI has over *which* mage takes
 * ~9 damage a second. It goes to a unit whose role is to absorb; a squad with
 * no such unit alive has no anchor and simply does not dive (see
 * `Brain.siegeStandoff`).
 */
function chooseAnchor(living: readonly Mage[], objective: Structure | null): string {
  if (!objective) return '';

  let best: Mage | null = null;
  let bestScore = -Infinity;
  for (const m of living) {
    const role = ROLE_BEHAVIOR[m.role];
    if (!role.attacks || !role.prefersStructures) continue;
    // Deliberately not health-weighted: an anchor that changes the moment the
    // tank drops below half re-derives every other mage's standoff mid-siege.
    const score = m.maxHealth - m.position.distanceTo(objective.position);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best?.id ?? '';
}

/**
 * Where the squad gathers: just in front of our own structure nearest the
 * objective, on the line toward it.
 *
 * That spot is inside our own Tower's cover, so falling back is never passive —
 * anything that follows the squad home walks into Tower fire on our terms
 * instead of ours walking into theirs.
 */
function rallyPoint(w: World, team: Team, objective: Structure | null): Vec2 {
  const forward = team === TEAM_A ? 1 : -1;
  const goal = objective?.position ?? new Vec2(forward * w.arena.width * 0.5, 0);

  let home: Structure | null = null;
  let bestDist = Infinity;
  for (const s of w.structuresOf(team)) {
    if (!s.alive) continue;
    const d = s.position.distanceTo(goal);
    if (d < bestDist) {
      bestDist = d;
      home = s;
    }
  }
  if (!home) return Vec2.zero;

  const dir = goal.sub(home.position);
  const len = dir.length();
  if (len <= EPSILON) return home.position;
  return w.arena.clamp(home.position.add(dir.scale(RALLY_LEAD / len)), MAGE_RADIUS);
}

/**
 * Whether the squad is gathered enough to dive. One mage arriving ahead of the
 * others gets the whole Tower volley to itself and dies for nothing — the
 * "trickle" that turns a four-mage squad into four one-mage pushes.
 */
function isCommitted(living: readonly Mage[], objective: Structure | null): boolean {
  if (!objective) return false;

  let attackers = 0;
  let near = 0;
  for (const m of living) {
    if (!ROLE_BEHAVIOR[m.role].attacks) continue;
    attackers++;
    if (m.position.distanceTo(objective.position) <= COMMIT_RADIUS) near++;
  }
  // With one attacker left there is nobody to wait for; waiting would just idle.
  return near >= Math.min(2, attackers);
}

/* ---- Tower threat --------------------------------------------------------- */

/**
 * The live enemy Tower covering `p`, or null.
 *
 * This is the map knowledge the AI was missing entirely: a Tower hits for
 * `TOWER_DAMAGE` every `TOWER_ATTACK_INTERVAL` at anything of ours it can see
 * within `range`, for free. Standing there without a reason is the largest
 * uncontested source of damage in a match.
 */
export function coveringTower(w: World, team: Team, p: Vec2): Structure | null {
  let best: Structure | null = null;
  let bestDist = Infinity;
  for (const id of sortedIds(w.structures.keys())) {
    const s = w.structures.get(id);
    if (!s || !s.alive || s.team === team || s.range <= 0) continue;

    const d = p.distanceTo(s.position);
    if (d > s.range || d >= bestDist) continue;
    if (!w.arena.hasLineOfSight(s.position, p)) continue;

    bestDist = d;
    best = s;
  }
  return best;
}

/** Whether `p` is inside our own half's defended ground — where an enemy counts as an intruder. */
export function isOurGround(w: World, team: Team, p: Vec2): boolean {
  for (const s of w.structuresOf(team)) {
    if (s.alive && p.distanceTo(s.position) - s.radius <= HOME_RADIUS) return true;
  }
  return false;
}

/* ---- helpers -------------------------------------------------------------- */

function livingOf(w: World, team: Team): Mage[] {
  const out: Mage[] = [];
  for (const id of sortedIds(w.mages.keys())) {
    const m = w.mages.get(id);
    if (m && m.alive && m.team === team) out.push(m);
  }
  return out;
}

function centroid(mages: readonly Mage[]): Vec2 | null {
  if (mages.length === 0) return null;
  let sum = Vec2.zero;
  for (const m of mages) sum = sum.add(m.position);
  return sum.scale(1 / mages.length);
}

/** Sorted iteration everywhere a "best" is picked, so two servers agree (see Brain.ts). */
function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}
