/**
 * The authoritative server's bot AI — a port of the client's
 * `src/systems/AISystem.ts` utility-scored squad AI.
 *
 * Same action set (retreat / takeCover / attack / advance / wander plus
 * reactive dodging), same scoring weights, same tie-break precedence, same
 * easy/normal/hard tuning, same cover/peek/line-of-sight behaviour. Practice
 * mode and online matches should feel like the same opponent.
 */

import { MAGE_RADIUS, SPACING } from '../config';
import { clamp, inverseLerp, lerp, Vec2 } from '../Vec2';
import {
  emptyInput,
  TEAM_A,
  type Mage,
  type MageInput,
  type Projectile,
  type Structure,
  type Team,
} from '../entities';
import { ROLE_BEHAVIOR } from '../roles';
import type { Rng } from '../rng';
import type { World } from '../World';

/** Mirrors the client's easy/normal/hard AI tuning (AISystem's AI_TUNING). */
export type Difficulty = 'easy' | 'normal' | 'hard';

/* Tuning constants ported 1:1 from AISystem.ts. */
export const ENGAGE_RANGE = 9.0;
export const MIN_THROW_RANGE = 1.5;
export const AIM_LEAD_TIME = 0.18;
export const AIM_ERROR_NEAR = 0.1;
export const AIM_ERROR_FAR = 0.46;
export const ADVANCE_STOP_DISTANCE = 6.5;
export const MOVE_STEP = 4.0;
export const RETREAT_DISTANCE = 5.0;
export const DODGE_DURATION = 0.22;
export const DODGE_DISTANCE = 2.4;
/** config.ts AI.dodgeRadius */
export const DODGE_RADIUS = 3.5;
export const DECISION_INTERVAL = 0.25;
/** config.ts AI.retreatHealthFraction */
export const RETREAT_HEALTH_FRACTION = 0.3;

const EPSILON = 1e-9;

/**
 * `siege` is the pivot's addition (GDD §11): with no enemy worth fighting, a
 * unit pushes the enemy structure instead of milling around. Everything else is
 * the original AISystem action set, untouched.
 */
type Action = 'wander' | 'advance' | 'takeCover' | 'retreat' | 'attack' | 'siege';

interface Tuning {
  aimErrorScale: number;
  decisionIntervalScale: number;
  throwWillingness: number;
  dodgeReliability: number;
  /** False means the unit never ducks behind obstacles or retreats (easy). */
  seeksCover: boolean;
  /**
   * The charge fraction at which a bot lets go. The client's AI throws through
   * ThrowSystem in a single call; server-side mages must hold and release over
   * several ticks, so this is the one piece of tuning with no direct
   * AISystem.ts counterpart.
   */
  releaseChargeMin: number;
}

export const TUNINGS: Readonly<Record<Difficulty, Tuning>> = {
  easy: {
    aimErrorScale: 4.5,
    decisionIntervalScale: 2.2,
    throwWillingness: 0.55,
    dodgeReliability: 0.25,
    seeksCover: false,
    releaseChargeMin: 0.5,
  },
  normal: {
    aimErrorScale: 1.0,
    decisionIntervalScale: 1.0,
    throwWillingness: 1.0,
    dodgeReliability: 1.0,
    seeksCover: true,
    releaseChargeMin: 0.8,
  },
  hard: {
    aimErrorScale: 0.55,
    decisionIntervalScale: 0.7,
    throwWillingness: 1.08,
    dodgeReliability: 1.0,
    seeksCover: true,
    releaseChargeMin: 0.95,
  },
};

function tuningFor(d: Difficulty): Tuning {
  return TUNINGS[d] ?? TUNINGS.normal;
}

interface Decision {
  action: Action;
  targetId: string;
}

interface BotState {
  decisionTimer: number;
  dodgeTimer: number;
  last: Decision;
  /**
   * Held for DODGE_DURATION so a sidestep commits instead of being re-rolled
   * every tick (the client holds a dodge move target the same way).
   */
  dodgeDir: Vec2;
}

interface Perception {
  target: Mage | null;
  distance: number;
  hasLos: boolean;
  /** Whether any living enemy can see this bot. */
  exposed: boolean;
  /** The enemy structure this unit is pushing toward, if any is reachable. */
  objective: Structure | null;
  objectiveDistance: number;
}

/**
 * Per-role overrides on top of the difficulty tuning (GDD §8, §11). A Golem and
 * an Archer run the same utility model and differ only here.
 */
function roleTuning(bot: Mage, tune: Tuning): Tuning {
  const role = ROLE_BEHAVIOR[bot.role];
  return { ...tune, seeksCover: tune.seeksCover && role.seeksCover };
}

/**
 * Holds the per-bot state the client's AISystem keeps in its
 * decisionTimers/decisions/dodgeTimers maps. One Brain drives all bots in a
 * match; the match session owns it.
 */
export class Brain {
  /** Exposed for tests asserting that decisions persist between ticks. */
  readonly states = new Map<string, BotState>();

  constructor(private readonly rng: Rng) {}

  private state(id: string): BotState {
    let s = this.states.get(id);
    if (!s) {
      s = {
        decisionTimer: 0,
        dodgeTimer: 0,
        last: { action: 'wander', targetId: '' },
        dodgeDir: Vec2.zero,
      };
      this.states.set(id, s);
    }
    return s;
  }

  /** Drives every listed bot one tick, writing the result into the world's input. */
  step(w: World, bots: ReadonlyMap<string, Difficulty>, dt: number): void {
    const focus = this.chooseFocusTarget(w, bots);
    for (const [id, difficulty] of bots) {
      const mage = w.mage(id);
      if (!mage || !mage.alive) continue;
      w.setInput(id, this.decide(w, mage, difficulty, dt, focus));
    }
  }

  /**
   * Computes the next input for one bot, mirroring AISystem.update's order:
   * reactive dodge first, then a utility decision refreshed on an interval,
   * then execution of that decision.
   */
  private decide(
    w: World,
    bot: Mage,
    difficulty: Difficulty,
    dt: number,
    focus: ReadonlyMap<Team, string>,
  ): MageInput {
    const tune = roleTuning(bot, tuningFor(difficulty));
    const st = this.state(bot.id);

    // A charge already in flight is finished or released independently of the
    // movement decision below — the two are separate in the client too.
    const charging = bot.charging;
    const input: MageInput = charging ? this.continueOrReleaseCharge(w, bot, tune) : emptyInput();

    const dodge = this.reactiveDodge(w, bot, tune, dt, st);
    if (dodge) {
      input.move = dodge;
      return input;
    }

    const p = this.perceive(w, bot, focus);

    st.decisionTimer -= dt;
    if (st.decisionTimer <= 0) {
      st.last = this.chooseDecision(bot, p, tune);
      st.decisionTimer = DECISION_INTERVAL * tune.decisionIntervalScale;
    }

    const { move, aim } = this.execute(w, bot, st.last, p, tune);
    input.move = move;
    if (!charging && aim) {
      input.aim = aim;
      input.charging = true;
    }
    return input;
  }

  /* ---- perception ------------------------------------------------------- */

  private perceive(w: World, bot: Mage, focus: ReadonlyMap<Team, string>): Perception {
    let nearest: Mage | null = null;
    let nearestDistSq = Infinity;
    const focusId = focus.get(bot.team);
    let focusTarget: Mage | null = null;
    let focusDistSq = Infinity;
    let focusLos = false;
    let exposed = false;

    for (const m of w.mages.values()) {
      if (m.team === bot.team || !m.alive) continue;
      const distSq = bot.position.sub(m.position).lengthSq();
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = m;
      }
      if (!exposed && w.arena.hasLineOfSight(m.position, bot.position)) exposed = true;
      if (m.id === focusId) {
        focusTarget = m;
        focusDistSq = distSq;
        focusLos = w.arena.hasLineOfSight(bot.position, m.position);
      }
    }

    // Prefer the squad's focus target when it is visible and not much further
    // away than the nearest enemy (AISystem.perceive's 1.8x rule).
    if (
      focusTarget &&
      focusLos &&
      (focusDistSq <= ENGAGE_RANGE * ENGAGE_RANGE || focusDistSq <= nearestDistSq * 1.8)
    ) {
      nearest = focusTarget;
      nearestDistSq = focusDistSq;
    }

    const objective = nearestObjective(w, bot);
    const objectiveDistance = objective
      ? bot.position.distanceTo(objective.position) - objective.radius
      : Infinity;

    if (!nearest) {
      return {
        target: null,
        distance: Infinity,
        hasLos: false,
        exposed,
        objective,
        objectiveDistance,
      };
    }

    const hasLos =
      nearest === focusTarget ? focusLos : w.arena.hasLineOfSight(bot.position, nearest.position);
    return {
      target: nearest,
      distance: Math.sqrt(nearestDistSq),
      hasLos,
      exposed,
      objective,
      objectiveDistance,
    };
  }

  /**
   * Picks, per team, the enemy the squad should concentrate on: hurt, exposed
   * and close (AISystem.chooseFocusTarget).
   */
  private chooseFocusTarget(w: World, bots: ReadonlyMap<string, Difficulty>): Map<Team, string> {
    const out = new Map<Team, string>();

    for (const botId of sortedIds(bots.keys())) {
      const self = w.mage(botId);
      if (!self || !self.alive) continue;
      if (out.has(self.team)) continue;

      let best: Mage | null = null;
      let bestScore = -Infinity;
      const allies = Math.max(1, countLiving(w, self.team));

      for (const targetId of sortedMageIds(w)) {
        const target = w.mage(targetId);
        if (!target || target.team === self.team || !target.alive) continue;

        let visible = 0;
        let proximity = 0;
        for (const allyId of sortedMageIds(w)) {
          const ally = w.mage(allyId);
          if (!ally || ally.team !== self.team || !ally.alive) continue;
          proximity += 1 - clamp(ally.position.distanceTo(target.position) / (ENGAGE_RANGE * 1.5), 0, 1);
          if (w.arena.hasLineOfSight(ally.position, target.position)) visible++;
        }
        if (visible === 0) continue;

        const healthScore =
          target.maxHealth > 0 ? 1 - clamp(target.health / target.maxHealth, 0, 1) : 1;
        const score = healthScore * 1.4 + (visible / allies) * 0.75 + proximity * 0.35;
        if (score > bestScore) {
          bestScore = score;
          best = target;
        }
      }
      if (best) out.set(self.team, best.id);
    }
    return out;
  }

  /* ---- decision --------------------------------------------------------- */

  private chooseDecision(bot: Mage, p: Perception, tune: Tuning): Decision {
    const role = ROLE_BEHAVIOR[bot.role];
    const hasTarget = p.target !== null;
    const inRange = p.distance <= ENGAGE_RANGE;
    const cooldownReady = bot.throwCooldown <= 0;

    // A tank's retreat fraction is 0, so healthRisk stays 0 and it never runs.
    const retreatFloor = role.retreatHealthFraction;
    const healthRisk =
      bot.maxHealth > 0 && retreatFloor > 0
        ? inverseLerp(bot.maxHealth * retreatFloor, bot.maxHealth * 0.05, bot.health)
        : 0;

    let retreat = p.exposed ? healthRisk * 1.1 : healthRisk * 0.45;

    let takeCover: number;
    if (!hasTarget) takeCover = 0;
    else if (!p.exposed && cooldownReady && inRange) takeCover = 0.6;
    else if (!p.exposed || (cooldownReady && inRange)) takeCover = 0;
    else if (cooldownReady) takeCover = 0.48;
    else takeCover = 0.72;

    // Supports never throw, so attacking is not on their menu at all (GDD §8).
    const attack = role.attacks && p.hasLos && inRange && cooldownReady ? 0.95 : 0;

    let advance = 0;
    if (hasTarget) {
      if (!inRange) advance = 0.62;
      else if (p.hasLos) advance = 0.18;
      else advance = 0.55;
    }

    /*
     * Siege is what stops a unit idling when nothing is shooting at it. A tank
     * outscores its own advance urge — walking past a skirmish to hit the tower
     * is the tank's job — while a damage dealer only sieges once the lane in
     * front of it is clear.
     */
    let siege = 0;
    if (p.objective) {
      if (!hasTarget) siege = 0.8;
      else if (role.prefersStructures) siege = 0.7;
      else if (!inRange) siege = 0.35;
    }

    // Wander is now a genuine last resort: with an objective on the map there is
    // always something better to do than drift toward the middle.
    const wander = hasTarget ? 0.05 : p.objective ? 0.02 : 0.6;

    if (!tune.seeksCover) {
      takeCover = 0;
      retreat = 0;
    }

    // Same precedence as AISystem.bestAction: wander < siege < advance <
    // takeCover < retreat < attack on ties.
    let best: Action = 'wander';
    let score = wander;
    if (siege > score) {
      best = 'siege';
      score = siege;
    }
    if (advance > score) {
      best = 'advance';
      score = advance;
    }
    if (takeCover > score) {
      best = 'takeCover';
      score = takeCover;
    }
    if (retreat > score) {
      best = 'retreat';
      score = retreat;
    }
    if (attack > score) best = 'attack';

    return { action: best, targetId: best === 'siege' ? '' : (p.target?.id ?? '') };
  }

  /** Turns a decision into a movement direction and (optionally) an aim point to charge at. */
  private execute(
    w: World,
    bot: Mage,
    d: Decision,
    p: Perception,
    tune: Tuning,
  ): { move: Vec2; aim: Vec2 | null } {
    if (d.action === 'siege' && p.objective) {
      return this.siege(w, bot, p.objective, p.objectiveDistance);
    }

    let target = p.target;
    if (d.targetId) {
      const t = w.mage(d.targetId);
      if (t && t.alive && t.team !== bot.team) target = t;
    }
    if (!target) {
      // Nothing left to fight here — push the objective instead of drifting.
      if (p.objective) return this.siege(w, bot, p.objective, p.objectiveDistance);
      return { move: this.wander(w, bot), aim: null };
    }

    switch (d.action) {
      case 'retreat':
        return { move: this.retreat(w, bot, target), aim: null };

      case 'takeCover': {
        const distance = bot.position.distanceTo(target.position);
        if (bot.throwCooldown <= 0 && distance <= ENGAGE_RANGE) {
          if (w.arena.hasLineOfSight(bot.position, target.position)) {
            return { move: Vec2.zero, aim: this.attackAim(target, distance, tune) };
          }
          const peek = this.findPeekSpot(w, bot, target);
          if (peek) return { move: dirTo(bot.position, peek), aim: null };
        }
        const cover = this.findCoverSpot(w, bot, target);
        if (cover) return { move: dirTo(bot.position, cover), aim: null };
        return { move: strafe(bot, target), aim: null };
      }

      case 'attack':
        return { move: Vec2.zero, aim: this.attackAim(target, p.distance, tune) };

      case 'advance':
        return { move: this.advance(w, bot, target), aim: null };

      default:
        return { move: this.wander(w, bot), aim: null };
    }
  }

  /**
   * Push the enemy structure: close to throwing range, then hold and hit it.
   * A structure never moves, so there is no aim lead and no distance error —
   * missing a Tower would only read as the AI being broken.
   */
  private siege(
    w: World,
    bot: Mage,
    objective: Structure,
    distance: number,
  ): { move: Vec2; aim: Vec2 | null } {
    const role = ROLE_BEHAVIOR[bot.role];
    if (!role.attacks) return { move: this.escort(w, bot), aim: null };

    if (
      distance <= ENGAGE_RANGE &&
      bot.throwCooldown <= 0 &&
      w.arena.hasLineOfSight(bot.position, objective.position)
    ) {
      return { move: Vec2.zero, aim: objective.position };
    }

    const toward = dirTo(bot.position, objective.position);
    if (toward.lengthSq() === 0) return { move: Vec2.zero, aim: null };

    const step = Math.min(MOVE_STEP, Math.max(0.5, distance - role.advanceStopDistance));
    const dest = bot.position.add(toward.scale(step)).add(allySeparation(w, bot));
    return { move: this.steerTo(w, bot, dest), aim: null };
  }

  /** Supports have no attack, so they trail the ally pushing hardest (GDD §8). */
  private escort(w: World, bot: Mage): Vec2 {
    const ally = mostAdvancedAlly(w, bot);
    if (!ally) return this.wander(w, bot);

    const gap = bot.position.distanceTo(ally.position);
    const keep = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    if (gap <= keep) return allySeparation(w, bot);
    return this.steerTo(w, bot, ally.position);
  }

  /* ---- actions ---------------------------------------------------------- */

  /** The point to charge at, or null when the bot declines to throw this tick. */
  private attackAim(target: Mage, distance: number, tune: Tuning): Vec2 | null {
    if (tune.throwWillingness < 1 && this.rng.float() >= tune.throwWillingness) return null;

    // Aim error grows with distance, exactly as in AISystem.attack.
    const charge01 = clamp(inverseLerp(MIN_THROW_RANGE, ENGAGE_RANGE, distance) * 0.9 + 0.1, 0.18, 1);
    const err = lerp(AIM_ERROR_NEAR, AIM_ERROR_FAR, charge01) * tune.aimErrorScale;
    return new Vec2(
      target.position.x + target.velocity.x * AIM_LEAD_TIME + this.rng.float() * 2 * err - err,
      target.position.y + target.velocity.y * AIM_LEAD_TIME + this.rng.float() * 2 * err - err,
    );
  }

  private continueOrReleaseCharge(w: World, bot: Mage, tune: Tuning): MageInput {
    const target = nearestEnemy(w, bot);
    if (!target) {
      // No enemy unit, but a charge already spent should still land on the
      // structure rather than being thrown away at nothing.
      const objective = nearestObjective(w, bot);
      if (objective) {
        const releasingAtStructure = bot.charge >= tune.releaseChargeMin;
        return {
          move: Vec2.zero,
          aim: objective.position,
          charging: !releasingAtStructure,
          release: releasingAtStructure,
        };
      }
      // Nothing worth aiming at — let go rather than holding forever.
      return {
        move: Vec2.zero,
        aim: bot.position.add(bot.facing),
        charging: false,
        release: true,
      };
    }

    const distance = bot.position.distanceTo(target.position);
    // throwWillingness 1 means attackAim never declines, so this is non-null.
    const aim = this.attackAim(target, distance, { ...tune, throwWillingness: 1 })!;
    const releasing = bot.charge >= tune.releaseChargeMin;
    return { move: Vec2.zero, aim, charging: !releasing, release: releasing };
  }

  private retreat(w: World, bot: Mage, target: Mage): Vec2 {
    const cover = this.findCoverSpot(w, bot, target);
    if (cover) return dirTo(bot.position, cover);

    let away = bot.position.sub(target.position).normalized();
    if (away.lengthSq() === 0) away = new Vec2(1, 0);
    return this.steerTo(w, bot, bot.position.add(away.scale(RETREAT_DISTANCE)));
  }

  private advance(w: World, bot: Mage, target: Mage): Vec2 {
    const toTarget = target.position.sub(bot.position).normalized();
    if (toTarget.lengthSq() === 0) return this.wander(w, bot);

    // Close the gap but stop short, so the bot fights at range rather than
    // walking into its target's face. How short is the role's business: a tank
    // closes to 2.0, an archer holds at 6.5 (GDD §8).
    const stopAt = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    let step = Math.min(
      MOVE_STEP,
      Math.max(0, bot.position.distanceTo(target.position) - stopAt),
    );
    if (step <= 0) step = MOVE_STEP * 0.5;

    const dest = bot.position.add(toTarget.scale(step)).add(allySeparation(w, bot));
    return this.steerTo(w, bot, dest);
  }

  private wander(w: World, bot: Mage): Vec2 {
    // Drift toward the middle of the arena when idle, with a random bias, so
    // bots without a target don't hug a wall.
    if (bot.position.length() > SPACING) return this.steerTo(w, bot, Vec2.zero);
    const angle = this.rng.float() * 2 * Math.PI;
    return new Vec2(Math.cos(angle), Math.sin(angle));
  }

  /**
   * A unit direction toward `dest`, nudged sideways when the straight line is
   * blocked. The server has no path planner (the client's MovementSystem does),
   * so this keeps bots from grinding into obstacles.
   */
  private steerTo(w: World, bot: Mage, dest: Vec2): Vec2 {
    const dir = dirTo(bot.position, dest);
    if (dir.lengthSq() === 0) return Vec2.zero;

    const probe = bot.position.add(dir.scale(MAGE_RADIUS * 2));
    if (!w.arena.blocksMovementAt(probe, MAGE_RADIUS)) return dir;

    for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const alt = dir.rotate(angle);
      if (!w.arena.blocksMovementAt(bot.position.add(alt.scale(MAGE_RADIUS * 2)), MAGE_RADIUS)) {
        return alt;
      }
    }
    return dir;
  }

  /* ---- cover ------------------------------------------------------------ */

  /**
   * A standing position that breaks the threat's line of sight, mirroring
   * `src/physics/LineOfSight.ts`'s findCoverSpot: sample points behind each
   * sight-blocking obstacle, relative to the threat.
   */
  private findCoverSpot(w: World, bot: Mage, threat: Mage): Vec2 | null {
    let best: Vec2 | null = null;
    let bestDist = Infinity;

    for (const o of w.arena.obstacles) {
      if (!o.blocksSight) continue;

      const away = o.position.sub(threat.position).normalized();
      if (away.lengthSq() === 0) continue;

      const offset = Math.max(o.radius, o.halfW, o.halfH) + MAGE_RADIUS + 0.25;
      const spot = o.position.add(away.scale(offset));

      if (!w.arena.contains(spot, MAGE_RADIUS) || w.arena.blocksMovementAt(spot, MAGE_RADIUS)) {
        continue;
      }
      if (w.arena.hasLineOfSight(threat.position, spot)) continue;

      const d = bot.position.distanceTo(spot);
      if (d < bestDist) {
        bestDist = d;
        best = spot;
      }
    }
    return best;
  }

  /**
   * A step toward the target that opens a shot, so a bot in cover leans out
   * instead of sitting behind the rock forever.
   */
  private findPeekSpot(w: World, bot: Mage, target: Mage): Vec2 | null {
    const dir = target.position.sub(bot.position).normalized();
    if (dir.lengthSq() === 0) return null;

    for (let step = 0.75; step <= 2.25; step += 0.75) {
      const spot = bot.position.add(dir.scale(step));
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.arena.blocksMovementAt(spot, MAGE_RADIUS)) {
        continue;
      }
      if (w.arena.hasLineOfSight(spot, target.position)) return spot;
    }
    return null;
  }

  /* ---- dodging ---------------------------------------------------------- */

  /**
   * Mirrors AISystem.tryReactiveDodge: a committed sidestep that preempts
   * whatever the bot was doing, held for DODGE_DURATION.
   */
  private reactiveDodge(
    w: World,
    bot: Mage,
    tune: Tuning,
    dt: number,
    st: BotState,
  ): Vec2 | null {
    const threat = findIncomingThreat(w, bot);
    if (threat) {
      if (this.rng.float() >= tune.dodgeReliability) return null;

      const speed = threat.velocity.length();
      if (speed <= EPSILON) return null;

      const dir = threat.velocity.scale(1 / speed);
      const left = new Vec2(-dir.y, dir.x);
      const right = new Vec2(-left.x, -left.y);

      const foe = nearestEnemy(w, bot);
      const chosen =
        scoreDodgeSide(w, bot, foe, right) > scoreDodgeSide(w, bot, foe, left) ? right : left;

      st.dodgeDir = chosen;
      st.dodgeTimer = DODGE_DURATION;
      return chosen;
    }

    if (st.dodgeTimer > 0) {
      st.dodgeTimer -= dt;
      return st.dodgeDir;
    }
    return null;
  }
}

/**
 * The enemy structure this unit should be pushing. Towers come before the Core
 * because the Core is invulnerable until they fall, and `targetableStructures`
 * already filters out anything still immune.
 */
function nearestObjective(w: World, bot: Mage): Structure | null {
  let best: Structure | null = null;
  let bestDist = Infinity;
  for (const s of w.targetableStructuresFor(bot.team)) {
    const d = bot.position.distanceTo(s.position);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** The living ally furthest into enemy territory — who a support falls in behind. */
function mostAdvancedAlly(w: World, bot: Mage): Mage | null {
  // TEAM_A pushes toward +x, TEAM_B toward -x (World.facingSignForTeam).
  const forward = bot.team === TEAM_A ? 1 : -1;
  let best: Mage | null = null;
  let bestReach = -Infinity;
  for (const id of sortedMageIds(w)) {
    const m = w.mage(id);
    if (!m || m === bot || !m.alive || m.team !== bot.team) continue;
    if (!ROLE_BEHAVIOR[m.role].attacks) continue;
    const reach = m.position.x * forward;
    if (reach > bestReach) {
      bestReach = reach;
      best = m;
    }
  }
  return best;
}

function scoreDodgeSide(w: World, bot: Mage, threat: Mage | null, side: Vec2): number {
  const dest = bot.position.add(side.scale(DODGE_DISTANCE));
  let score =
    !w.arena.contains(dest, MAGE_RADIUS) || w.arena.blocksMovementAt(dest, MAGE_RADIUS) ? -10 : 10;
  if (threat) score += dest.distanceTo(threat.position);
  return score;
}

/**
 * The nearest hostile, approaching, low-flying projectile within DODGE_RADIUS
 * (AISystem.findMostUrgentIncomingSnowball).
 */
function findIncomingThreat(w: World, bot: Mage): Projectile | null {
  let best: Projectile | null = null;
  let bestDistSq = DODGE_RADIUS * DODGE_RADIUS;

  for (const id of sortedIds(w.projectiles.keys())) {
    const p = w.projectiles.get(id);
    if (!p || !p.alive || p.team === bot.team || p.ownerId === bot.id || p.height >= 2) continue;

    const toBot = bot.position.sub(p.position);
    const distSq = toBot.lengthSq();
    if (distSq > bestDistSq) continue;
    if (p.velocity.dot(toBot) <= 0) continue;

    bestDistSq = distSq;
    best = p;
  }
  return best;
}

/**
 * Biases a bot's destination away from nearby teammates so a squad spreads out
 * instead of stacking (AISystem.computeAllySeparation).
 */
function allySeparation(w: World, bot: Mage): Vec2 {
  let out = Vec2.zero;
  const spacing = SPACING * 2;

  for (const id of sortedMageIds(w)) {
    const ally = w.mage(id);
    if (!ally || ally.id === bot.id || ally.team !== bot.team || !ally.alive) continue;

    const delta = bot.position.sub(ally.position);
    const distSq = delta.lengthSq();
    if (distSq <= EPSILON || distSq >= spacing * spacing) continue;

    const dist = Math.sqrt(distSq);
    const strength = (spacing - dist) / spacing;
    out = out.add(delta.scale(1 / dist).scale(strength * SPACING));
  }
  return out;
}

function strafe(bot: Mage, target: Mage): Vec2 {
  const away = bot.position.sub(target.position);
  const l = away.length();
  const side = l > EPSILON ? new Vec2(-away.y / l, away.x / l) : new Vec2(0, 1);
  return side.scale(idSign(bot.id));
}

function nearestEnemy(w: World, bot: Mage): Mage | null {
  let nearest: Mage | null = null;
  let bestDistSq = Infinity;
  for (const id of sortedMageIds(w)) {
    const m = w.mage(id);
    if (!m || m.team === bot.team || !m.alive) continue;
    const d = bot.position.sub(m.position).lengthSq();
    if (d < bestDistSq) {
      bestDistSq = d;
      nearest = m;
    }
  }
  return nearest;
}

function countLiving(w: World, team: Team): number {
  let n = 0;
  for (const m of w.mages.values()) if (m.team === team && m.alive) n++;
  return n;
}

function dirTo(from: Vec2, to: Vec2): Vec2 {
  return to.sub(from).normalized();
}

/**
 * A stable ±1 derived from a mage id (FNV-1a) so a strafe keeps circling the
 * same way instead of flip-flopping every tick.
 */
function idSign(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? 1 : -1;
}

/*
 * Every scan that can pick a "best" candidate iterates in sorted-id order.
 * Map insertion order would work in JS, but it makes the outcome depend on
 * *when* an entity joined; sorting keeps two servers replaying the same inputs
 * on the same choices, and it is what the Go implementation had to do anyway.
 */
function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

function sortedMageIds(w: World): string[] {
  return sortedIds(w.mages.keys());
}
