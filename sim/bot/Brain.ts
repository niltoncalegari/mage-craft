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
/**
 * How far a mage will walk to pick a fight while there is a structure to push.
 * No AISystem counterpart — practice mode has no objective to walk away from.
 */
export const PURSUE_RANGE = ENGAGE_RANGE * 2;
export const MOVE_STEP = 4.0;
export const RETREAT_DISTANCE = 5.0;
export const DODGE_DURATION = 0.22;
export const DODGE_DISTANCE = 2.4;
/** config.ts AI.dodgeRadius */
export const DODGE_RADIUS = 3.5;
export const DECISION_INTERVAL = 0.25;
/** config.ts AI.retreatHealthFraction */
export const RETREAT_HEALTH_FRACTION = 0.3;

/** How far a destination may drift before a cached path is re-planned. */
const PATH_REPLAN_DISTANCE = 1.5;
/** MovementSystem's WAYPOINT_THRESHOLD: a waypoint this close is behind you. */
const WAYPOINT_REACHED = MAGE_RADIUS * 0.75;
/** MovementSystem's ARRIVAL_THRESHOLD: this close to the destination is there. */
const ARRIVAL_THRESHOLD = MAGE_RADIUS * 0.2;
/** AISystem's STRAFE_DISTANCE — how far a sidestep commits to. */
const STRAFE_DISTANCE = 3;
/**
 * How much of `advanceStopDistance` a bot will let a target close before it
 * gives ground. The band around the role's preferred range that it holds.
 */
const KITE_BAND = 0.25;

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
  /**
   * The route currently being walked around a blocker, and how far along it the
   * bot is. Cached so a squad does not run A* per bot per tick; dropped as soon
   * as the destination moves, the action changes or the line ahead comes clear.
   */
  path: Vec2[] | null;
  pathIndex: number;
  pathGoal: Vec2 | null;
  /** Where the bot stood when the route was planned — routes go stale as it moves. */
  pathFrom: Vec2 | null;
  /** Where an idle bot decided to go, held until it gets there. */
  wanderTarget: Vec2 | null;
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
        path: null,
        pathIndex: 0,
        pathGoal: null,
        pathFrom: null,
        wanderTarget: null,
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
      const next = this.chooseDecision(bot, p, tune);
      // A route planned to reach cover is worthless once the bot has decided to
      // charge the tower instead.
      if (next.action !== st.last.action) this.clearPath(st);
      st.last = next;
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
      // "Exposed" means someone close enough to punish you can see you. The
      // client can skip the range test — its whole arena is inside throwing
      // distance — but here an enemy defending its own Core, 30 units away,
      // would otherwise pin a squad in cover for the whole match.
      if (
        !exposed &&
        distSq <= PURSUE_RANGE * PURSUE_RANGE &&
        w.arena.hasLineOfSight(m.position, bot.position)
      ) {
        exposed = true;
      }
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
      // `perceive` picks the nearest enemy anywhere on the map, which on a
      // practice arena is fine and on a siege map is not: chasing someone
      // defending their own Core, half an arena away, is abandoning the game.
      // Past PURSUE_RANGE the objective outscores the chase (0.35 vs 0.2).
      const worthChasing = !p.objective || p.distance <= PURSUE_RANGE;
      if (!inRange) advance = worthChasing ? 0.62 : 0.2;
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

    // A support has no attack, so "walk at the enemy" is never its plan: it
    // falls in behind whoever is pushing (GDD §8). Cover and retreat still
    // apply — a support that is being shot at should still get out of the way.
    if (!ROLE_BEHAVIOR[bot.role].attacks && (d.action === 'advance' || d.action === 'attack')) {
      return { move: this.escort(w, bot), aim: null };
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
            return {
              move: this.footwork(w, bot, target, distance),
              aim: this.attackAim(target, distance, tune),
            };
          }
          const peek = this.findPeekSpot(w, bot, target);
          if (peek) return { move: this.steerTo(w, bot, peek), aim: null };
        }
        const cover = this.findCoverSpot(w, bot, target);
        if (cover) return { move: this.steerTo(w, bot, cover), aim: null };
        return { move: this.sidestep(w, bot, target), aim: null };
      }

      case 'attack':
        return {
          move: this.footwork(w, bot, target, p.distance),
          aim: this.attackAim(target, p.distance, tune),
        };

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

    // Arrived: `distance` is measured to the structure's surface, and the role's
    // stop distance clears a body radius, so this is as close as it should get.
    if (distance <= role.advanceStopDistance) return { move: Vec2.zero, aim: null };

    /*
     * The goal is the structure itself, not a stand-off point beside it.
     *
     * A stand-off point derived from `bot.position` moves whenever the bot
     * does, so a mage forced off the straight line — around a fence, past its
     * own Tower — is chasing a goal that swings around the structure as it
     * goes, and it orbits instead of arriving. Anchoring on the structure keeps
     * the goal still; the stop check above is what keeps the mage out of it,
     * and the planner snaps a blocked goal to the nearest free cell anyway.
     */
    return {
      move: this.steerTo(w, bot, objective.position.add(allySeparation(w, bot))),
      aim: null,
    };
  }

  /** Supports have no attack, so they trail the ally pushing hardest (GDD §8). */
  private escort(w: World, bot: Mage): Vec2 {
    const ally = mostAdvancedAlly(w, bot);
    if (!ally) return this.wander(w, bot);

    const gap = bot.position.distanceTo(ally.position);
    const keep = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    // Close enough: hold station, but let spacing nudge it — through the
    // planner, so the nudge can't be into a wall.
    if (gap <= keep) return this.steerTo(w, bot, bot.position.add(allySeparation(w, bot)));
    return this.steerTo(w, bot, ally.position.add(allySeparation(w, bot)));
  }

  /* ---- actions ---------------------------------------------------------- */

  /**
   * What a mage does with its feet while it is shooting.
   *
   * The client throws in a single call, so its AI can afford to plant itself
   * for the one tick that takes (AISystem.attack drops the move target). Here a
   * throw is a ~1.2s charge hold, and standing still for all of it is most of
   * the match — that is the "stops and shoots, no plan" the online bots read
   * as. So a shooting mage works its role's preferred range instead: back off
   * when crowded, close when it has drifted out, circle otherwise.
   */
  private footwork(w: World, bot: Mage, target: Mage, distance: number): Vec2 {
    const keep = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    const away = bot.position.sub(target.position).normalized();
    if (away.lengthSq() === 0) return Vec2.zero;

    if (distance < keep * (1 - KITE_BAND)) {
      return this.steerTo(w, bot, bot.position.add(away.scale(RETREAT_DISTANCE)));
    }
    if (distance > keep * (1 + KITE_BAND)) {
      return this.steerTo(w, bot, target.position.add(away.scale(keep)));
    }
    return this.sidestep(w, bot, target);
  }

  /** A committed sideways step around a target, planned like any other move. */
  private sidestep(w: World, bot: Mage, target: Mage): Vec2 {
    return this.steerTo(w, bot, bot.position.add(strafe(bot, target).scale(STRAFE_DISTANCE)));
  }

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
    if (cover) return this.steerTo(w, bot, cover);

    let away = bot.position.sub(target.position).normalized();
    if (away.lengthSq() === 0) away = new Vec2(1, 0);
    return this.steerTo(w, bot, bot.position.add(away.scale(RETREAT_DISTANCE)));
  }

  /**
   * Close the gap but stop short, so the bot fights at range rather than
   * walking into its target's face. How short is the role's business: a tank
   * closes to 2.8, an archer holds at 6.5 (GDD §8).
   *
   * The goal is the target, not AISystem's "MOVE_STEP units further along the
   * line" — that idiom is safe on the practice maps, where nothing bigger than
   * a rock is ever in the way, but on the siege map a point four units ahead
   * lands inside a Tower half the time, and a goal the planner has to snap out
   * of a blocker is a bot grinding on a wall. Stopping is `footwork`'s job.
   */
  private advance(w: World, bot: Mage, target: Mage): Vec2 {
    const distance = bot.position.distanceTo(target.position);
    const stopAt = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    if (distance <= stopAt) return this.footwork(w, bot, target, distance);

    return this.steerTo(w, bot, target.position.add(allySeparation(w, bot)));
  }

  /**
   * Drift toward the middle when idle, then pick somewhere to be — and *hold*
   * that destination until it is reached (AISystem.wander keeps its move target
   * the same way). Re-rolling a direction every tick, which is what this used
   * to do, averages out to standing still and twitching.
   */
  private wander(w: World, bot: Mage): Vec2 {
    const st = this.state(bot.id);
    if (!st.wanderTarget || bot.position.distanceTo(st.wanderTarget) <= SPACING) {
      st.wanderTarget =
        bot.position.length() < SPACING
          ? new Vec2(
              (this.rng.float() * 2 - 1) * w.arena.width * 0.25,
              (this.rng.float() * 2 - 1) * w.arena.height * 0.25,
            )
          : Vec2.zero;
    }
    return this.steerTo(w, bot, st.wanderTarget);
  }

  /**
   * A unit direction toward `dest`: straight there while the way ahead is
   * clear, otherwise around the blocker on an A* route — the same planning
   * practice mode's MovementSystem has always done, on the same grid the
   * physics uses (`World.isBlocked`, obstacles *and* live structures).
   *
   * The ±45°/±90° sidestep survives as the last resort for when no route
   * exists at all, so a bot still shuffles instead of standing still.
   */
  private steerTo(w: World, bot: Mage, rawDest: Vec2): Vec2 {
    const st = this.state(bot.id);
    // Every destination is clamped into the arena first (AISystem.setMoveTarget
    // does the same): steering at a point outside the map is steering into the
    // boundary, where the mage pushes forever and never arrives.
    const dest = w.arena.clamp(rawDest, MAGE_RADIUS);
    const dir = dirTo(bot.position, dest);
    if (dir.lengthSq() === 0) return Vec2.zero;
    // Arrived (MovementSystem.ARRIVAL_THRESHOLD). Without this a bot keeps
    // walking at full tilt at a point it is already standing on.
    if (bot.position.distanceTo(dest) <= ARRIVAL_THRESHOLD) return Vec2.zero;

    // The whole segment, not a probe one step ahead: a bot has to know it needs
    // to go around *before* it is nose-first against the wall.
    if (!w.isBlockedSegment(bot.position, dest)) {
      this.clearPath(st);
      return dir;
    }

    const waypoint = this.nextWaypoint(w, bot, st, dest);
    if (waypoint) {
      // The tail of the route is as close to a walled-off destination as the
      // map allows (`findPath` snaps a goal inside a blocker). Standing on it
      // is arriving; pressing on from there is grinding into the blocker.
      const atRouteEnd = st.path !== null && st.pathIndex === st.path.length - 1;
      if (atRouteEnd && bot.position.distanceTo(waypoint) <= WAYPOINT_REACHED) return Vec2.zero;

      const toward = dirTo(bot.position, waypoint);
      if (toward.lengthSq() > 0) return toward;
    }

    for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const alt = dir.rotate(angle);
      if (!w.isBlocked(bot.position.add(alt.scale(MAGE_RADIUS * 2)))) return alt;
    }
    return dir;
  }

  /**
   * The next point on the cached route to `dest`, re-planning when the goal has
   * moved. Null means the planner found nothing at all.
   *
   * Reached waypoints are skipped but the last one never is (MovementSystem's
   * rule): the tail of the route *is* the destination, and dropping it would
   * hand the bot back to the straight line it could not walk.
   */
  private nextWaypoint(w: World, bot: Mage, st: BotState, dest: Vec2): Vec2 | null {
    // Re-plan when the goal moves *or* when the bot has walked far enough that
    // the route no longer starts where it is standing. Without the second test
    // a bot with a fixed goal — a Tower never moves — plans once from its spawn
    // and then follows that one stale route to its end and stops there.
    const stale =
      !st.path ||
      !st.pathGoal ||
      !st.pathFrom ||
      st.pathGoal.distanceTo(dest) > PATH_REPLAN_DISTANCE ||
      st.pathFrom.distanceTo(bot.position) > PATH_REPLAN_DISTANCE;

    if (stale) {
      const path = w.pathGrid().findPath(bot.position, dest);
      st.path = path && path.length > 0 ? path : null;
      st.pathIndex = 0;
      st.pathGoal = dest;
      st.pathFrom = bot.position;
    }

    const path = st.path;
    if (!path) return null;

    while (
      st.pathIndex < path.length - 1 &&
      bot.position.distanceTo(path[st.pathIndex]) <= WAYPOINT_REACHED
    ) {
      st.pathIndex++;
    }
    return path[st.pathIndex];
  }

  private clearPath(st: BotState): void {
    st.path = null;
    st.pathIndex = 0;
    st.pathGoal = null;
    st.pathFrom = null;
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

      // Structures count as solid here too — cover behind a rock that happens
      // to sit against a Tower is not somewhere a mage can actually stand.
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.isBlocked(spot)) continue;
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
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.isBlocked(spot)) continue;
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
  let score = !w.arena.contains(dest, MAGE_RADIUS) || w.isBlocked(dest) ? -10 : 10;
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
