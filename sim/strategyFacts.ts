/**
 * Reading the live world into the flat situation a `Strategy` is written
 * against (GDD §7).
 *
 * Kept apart from `strategy.ts` so the evaluator stays free of `World`: the
 * program and its semantics are pure data and pure functions, and this is the
 * one place that knows about mages, structures and squad plans.
 *
 * Two properties matter here more than anywhere else in the feature:
 *
 * - **One pass, not one per rule.** Everything a program could ask is computed
 *   up front, including every target selector. Twelve rules then cost twelve
 *   lookups instead of twelve scans of the squad.
 * - **Tie-breaks by id.** `World.mages` is a `Map`, so iteration follows
 *   insertion — and respawn reinserts. A scan that kept "the first best I saw"
 *   would quietly diverge between two runs of the same match. Every pick below
 *   walks `sortedMageIds`, so ties resolve the same way everywhere.
 */

import { isCore, opponentOf, TEAM_A, type Mage, type Structure, type Team } from './entities';
import { sortedIds } from './ids';
import type { EffectKind } from './effects';
import type { SquadPlan } from './bot/Squad';
import type { StrategyFacts, TargetSelector } from './abilityPolicy';
import { Vec2 } from './Vec2';
import type { World } from './World';

/**
 * How near two mages must be to count as grouped. Matches the spells' own
 * radii (GDD §9): a "cluster" the player can read has to be a cluster a spell
 * could actually cover.
 */
export const CLUSTER_RADIUS = 4;

interface Cluster {
  readonly size: number;
  readonly center: Vec2 | null;
}

export function buildFacts(w: World, team: Team, plan?: SquadPlan): StrategyFacts {
  const ids = sortedIds(w.mages.keys());
  const allies: Mage[] = [];
  const enemies: Mage[] = [];
  for (const id of ids) {
    const m = w.mages.get(id);
    if (!m || !m.alive) continue;
    (m.team === team ? allies : enemies).push(m);
  }

  const allyCluster = biggestCluster(allies);
  const enemyCluster = biggestCluster(enemies);

  // TEAM_A defends negative x, TEAM_B positive; `forward` points at the enemy.
  const forward = team === TEAM_A ? 1 : -1;
  const intruder = deepestIntruder(enemies, forward);

  const ourCore = coreOf(w, team);
  const enemyCore = coreOf(w, opponentOf(team));

  const targets: Record<TargetSelector, Vec2 | null> = {
    enemy_cluster: enemyCluster.center,
    ally_cluster: allyCluster.center,
    deepest_intruder: intruder?.position ?? null,
    weakest_ally: lowest(allies, (m) => m.health)?.position ?? null,
    strongest_enemy: highest(enemies, (m) => m.health)?.position ?? null,
    ally_frontline: highest(allies, (m) => m.position.x * forward)?.position ?? null,
    enemy_frontline: lowest(enemies, (m) => m.position.x * forward)?.position ?? null,
    our_core: ourCore?.position ?? null,
    enemy_core: enemyCore?.position ?? null,
    our_objective: plan?.objective?.position ?? null,
    squad_rally: plan?.rally ?? null,
  };

  return {
    elapsed: w.elapsed,
    suddenDeath: w.suddenDeath,
    posture: plan?.posture ?? null,
    allyCount: allies.length,
    enemyCount: enemies.length,
    allyLowestHealthFraction: lowestHealthFraction(allies),
    enemyLowestHealthFraction: lowestHealthFraction(enemies),
    ourCoreFraction: healthFraction(ourCore),
    enemyCoreFraction: healthFraction(enemyCore),
    ourTowersAlive: towersAlive(w, team),
    enemyTowersAlive: towersAlive(w, opponentOf(team)),
    allyClusterSize: allyCluster.size,
    enemyClusterSize: enemyCluster.size,
    hasIntruder: intruder !== null,
    allyEffects: effectKinds(allies),
    enemyEffects: effectKinds(enemies),
    targets,
  };
}

/**
 * The largest group within `CLUSTER_RADIUS` of any one member, and its
 * centroid.
 *
 * O(n²) over at most four mages a side, so the naive version is the right one.
 * `mages` arrives in sorted-id order and the comparison is strictly greater,
 * so the earliest id wins a tie — and the centroid sums in that same fixed
 * order, which keeps the last bit of the float identical between runs.
 */
function biggestCluster(mages: readonly Mage[]): Cluster {
  let best: Mage[] | null = null;

  for (const anchor of mages) {
    const group = mages.filter((m) => m.position.distanceTo(anchor.position) <= CLUSTER_RADIUS);
    if (!best || group.length > best.length) best = group;
  }

  if (!best || best.length === 0) return { size: 0, center: null };

  let x = 0;
  let y = 0;
  for (const m of best) {
    x += m.position.x;
    y += m.position.y;
  }
  return { size: best.length, center: new Vec2(x / best.length, y / best.length) };
}

/**
 * The enemy furthest into our own ground, or null when none has crossed.
 *
 * The midline floor is not decoration. Without it this returns whoever is
 * nearest the middle no matter where they stand, and a program that "answers
 * intruders" answers one permanently — it drops every curse it can afford on
 * the enemy's own front line and never buffs its own push. The bot Commander
 * carries a scar from exactly this.
 */
function deepestIntruder(enemies: readonly Mage[], forward: number): Mage | null {
  let best: Mage | null = null;
  let deepest = 0;
  for (const m of enemies) {
    const depth = -m.position.x * forward;
    if (depth > deepest) {
      deepest = depth;
      best = m;
    }
  }
  return best;
}

function lowest(mages: readonly Mage[], score: (m: Mage) => number): Mage | null {
  let best: Mage | null = null;
  let bestScore = Infinity;
  for (const m of mages) {
    const s = score(m);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

function highest(mages: readonly Mage[], score: (m: Mage) => number): Mage | null {
  let best: Mage | null = null;
  let bestScore = -Infinity;
  for (const m of mages) {
    const s = score(m);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

/** 1 when nobody is alive, so "someone is hurt" reads false on an empty field. */
function lowestHealthFraction(mages: readonly Mage[]): number {
  let worst = 1;
  for (const m of mages) worst = Math.min(worst, m.health / m.maxHealth);
  return worst;
}

function effectKinds(mages: readonly Mage[]): ReadonlySet<EffectKind> {
  const kinds = new Set<EffectKind>();
  for (const m of mages) {
    for (const e of m.effects) kinds.add(e.kind);
  }
  return kinds;
}

function coreOf(w: World, team: Team): Structure | null {
  for (const id of sortedIds(w.structures.keys())) {
    const s = w.structures.get(id);
    if (s && s.team === team && isCore(s)) return s;
  }
  return null;
}

function towersAlive(w: World, team: Team): number {
  let n = 0;
  for (const s of w.structures.values()) {
    if (s.team === team && !isCore(s) && s.alive) n++;
  }
  return n;
}

function healthFraction(s: Structure | null): number {
  if (!s || s.maxHealth <= 0) return 0;
  return Math.max(0, s.health / s.maxHealth);
}
