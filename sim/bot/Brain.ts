/**
 * The authoritative server's bot AI — a utility-scored squad AI grown out of
 * the client's `src/systems/AISystem.ts`.
 *
 * The reactive half is still the client's, unchanged: cover, peek, line of
 * sight, projectile dodging, aim lead and error, and the easy/normal/hard
 * tuning. Practice mode and online matches feel like the same opponent.
 *
 * What the siege game added on top is a *plan* (`Squad.ts`). AISystem scored
 * every action against one question — "is there someone to shoot?" — because on
 * a practice map that was the whole game. Here killing a mage wins nothing: it
 * respawns in `RESPAWN_DELAY` seconds and only structures decide a match (GDD
 * §4). So shooting is scored by what it *protects*, sieging is the default, and
 * two things the old model could not express at all — enemy Tower fire, and
 * what the rest of the squad is doing — now drive most of the decisions.
 */

import { MAGE_RADIUS, SPACING } from '../config';
import { hasEffect } from '../effects';
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
import { prefersSquadFocus } from './focus';
import { coveringTower, isOurGround, SquadPlanner, type SquadPlan } from './Squad';

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
/**
 * How much of `advanceStopDistance` a bot will let a target close before it
 * gives ground. The band around the role's preferred range that it holds.
 */
const KITE_BAND = 0.25;

/**
 * What shooting a mage is worth on its own — nothing much. A kill costs the
 * enemy `RESPAWN_DELAY` seconds of presence and wins zero structures, so the
 * flat 0.95 AISystem gave `attack` (where killing *was* the game) is what made
 * two squads meet in midfield and trade shots until the clock ran out. The
 * bonuses below are where the value actually comes from.
 */
const ATTACK_BASE = 0.45;
/** Added when the target is worth shooting: contesting our objective, or in our ground. */
const ATTACK_CONTESTS_BONUS = 0.3;
/** Added in proportion to how hurt the target already is — finishing one is worth more. */
const ATTACK_FINISH_BONUS = 0.3;
/** Subtracted when we are trading under their Tower, which is a trade we lose. */
const ATTACK_UNDER_TOWER_PENALTY = 0.45;

/**
 * The urge to leave Tower fire we are getting nothing for. Above a healthy
 * mage's best `attack` score and below a critical `retreat`, so it wins the
 * argument against staying to fight but never against actually dying.
 */
const TOWER_ESCAPE_URGE = 0.86;
/** How far past a Tower's range a bot that is backing out of it aims to stand. */
const TOWER_STANDOFF = 0.75;

/**
 * How far *outside* a Tower's reach a non-anchor stands while shooting it.
 *
 * A Tower measures range from its centre (`World.towerTarget`) while a siege
 * measures distance to the structure's surface, so there is a band — as wide as
 * the structure's radius — from which a mage can hit a Tower that cannot hit
 * back. Working that band instead of walking up to the wall is most of the
 * difference between a squad that trades with a Tower and one that dismantles
 * it for free.
 */
const SAFE_FIRING_MARGIN = 0.5;

/** How far a squadmate stays behind the anchor, so the Tower keeps shooting the anchor. */
const ANCHOR_LEAD = 1.5;

/** Slack around the siege standoff, so holding a band does not read as jitter. */
const SIEGE_DEADBAND = 0.3;

/**
 * Under this range a bot stops circling cleanly and leans outward as it goes:
 * a target in its face is one it cannot throw at comfortably.
 */
const ORBIT_MIN_RANGE = MIN_THROW_RANGE * 1.4;
/** How far ahead steering probes for something solid. */
const AVOID_LOOKAHEAD = 2.2;
/** Probes taken along a candidate heading; three is enough at this look-ahead. */
const AVOID_SAMPLES = 3;
/** Radius scale used when probing, so a bot rounds a corner wide of it. */
const AVOID_MARGIN = 1.25;
/** The shorter look-ahead a sidestep needs — strafing covers far less ground. */
const ORBIT_LOOKAHEAD = 1.2;
/**
 * Deviations from the straight line, tried smallest first, when the direct
 * route and the planned path are both closed.
 */
const AVOID_ANGLES = [
  Math.PI / 8,
  Math.PI / 4,
  (3 * Math.PI) / 8,
  Math.PI / 2,
  (5 * Math.PI) / 8,
  (3 * Math.PI) / 4,
];

/** How far ahead another mage counts as standing in the way. */
const CROWD_LOOKAHEAD = SPACING * 1.6;
/** How hard a heading leans sideways to pass one. */
const CROWD_SIDESTEP = 0.9;

/** Below this fraction of its top speed, a bot that asked to move is not moving. */
const STUCK_SPEED_FRACTION = 0.3;
/** Seconds of that before a bot abandons its plan and digs itself out. */
const STUCK_TRIGGER = 0.4;
/** Seconds an escape move is committed to, so it actually clears the blocker. */
const UNSTICK_DURATION = 0.65;
/** How far an escape heading is checked for room. */
const ESCAPE_REACH = 3.0;
/** Headings sampled around the bot when looking for a way out. */
const ESCAPE_DIRECTIONS = 12;
/** Radius scale used to feel for geometry pressed against a stuck bot. */
const ESCAPE_PROBE = 2.4;

/**
 * Exits from a Tower's arc, tried in order: straight out first, then ever more
 * tangential. See `escapeTower`.
 */
const ESCAPE_ANGLES = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (Math.PI * 3) / 4,
  (-Math.PI * 3) / 4,
];

const EPSILON = 1e-9;

/**
 * `siege`, `defend` and `regroup` are the siege game's additions to AISystem's
 * five. `siege` pushes the plan's structure, `defend` answers an enemy standing
 * in our ground, and `regroup` falls back under our own Tower rather than
 * feeding into a squad that outnumbers us — `Squad.ts` decides which applies.
 */
type Action =
  | 'wander'
  | 'advance'
  | 'takeCover'
  | 'retreat'
  | 'attack'
  | 'siege'
  | 'defend'
  | 'regroup';

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
   * ±1: the side this bot circles a target on and rounds obstacles on. Kept on
   * the bot rather than recomputed, because a heading that flips every tick
   * averages out to standing still.
   */
  side: number;
  /** Seconds spent asking to move without actually going anywhere. */
  stuckTimer: number;
  /** While positive the bot runs `escapeDir` instead of its decision. */
  escapeTimer: number;
  escapeDir: Vec2;
  /** Position at the previous tick — how actual progress gets measured. */
  lastPos: Vec2 | null;
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
  /** What the charge currently being held was started at; see `AimPoint`. */
  chargeTarget: AimPoint | null;
}

/**
 * What a throw is aimed *at*, not merely where.
 *
 * A charge takes a second and a half to fill, and the client's AI could ignore
 * that entirely — it threw in a single call. Here the aim has to survive a
 * hundred ticks, so it has to be re-derived every one of them: a mage still
 * needs to lead a target that is running, and a mage charging at a Tower needs
 * to still be pointed at the Tower. Carrying only the point is what let a siege
 * charge silently re-target the nearest mage half an arena away and throw its
 * shot into the dirt.
 */
interface AimPoint {
  point: Vec2;
  /** Set when the charge is meant for a mage — re-led on every tick it is held. */
  mageId?: string;
  /** Set when the charge is meant for a structure — it does not move, so nor does the aim. */
  structureId?: string;
}

interface Perception {
  target: Mage | null;
  distance: number;
  hasLos: boolean;
  /** Whether any living enemy can see this bot. */
  exposed: boolean;
  /** The structure the *squad* is pushing — one per team, not one per mage. */
  objective: Structure | null;
  objectiveDistance: number;
  /**
   * Whether `target` is worth spending a throw on: it is standing on the
   * structure we came to break, or it is loose in our own ground. Anything else
   * is a mage we can walk past — it wins nothing and it comes back anyway.
   */
  targetContests: boolean;
  /** The enemy Tower whose fire this bot is currently standing in, if any. */
  underTower: Structure | null;
  /**
   * Whether being under that Tower is the *point* — this mage is the squad's
   * anchor, deliberately soaking the objective's fire. Everyone else treats the
   * same position as a mistake to walk out of.
   */
  divingObjective: boolean;
  plan: SquadPlan;
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

  /**
   * The team-level intent every per-mage decision is scored against. One
   * planner drives both squads — it reads the world, it does not belong to a
   * side (see `Squad.ts`).
   */
  readonly planner = new SquadPlanner();

  constructor(private readonly rng: Rng) {}

  private state(id: string): BotState {
    let s = this.states.get(id);
    if (!s) {
      s = {
        decisionTimer: 0,
        dodgeTimer: 0,
        last: { action: 'wander', targetId: '' },
        dodgeDir: Vec2.zero,
        // Seeded from the id so two bots on the same target circle it in
        // opposite directions instead of both crowding the same arc.
        side: idSign(id),
        stuckTimer: 0,
        escapeTimer: 0,
        escapeDir: Vec2.zero,
        lastPos: null,
        path: null,
        pathIndex: 0,
        pathGoal: null,
        pathFrom: null,
        wanderTarget: null,
        chargeTarget: null,
      };
      this.states.set(id, s);
    }
    return s;
  }

  /** Drives every listed bot one tick, writing the result into the world's input. */
  step(w: World, bots: ReadonlyMap<string, Difficulty>, dt: number): void {
    // The plan first: every decision below is scored against what the squad is
    // trying to do, so it has to be current before anyone decides anything.
    this.planner.step(w, dt);

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
    this.trackProgress(w, bot, st, dt);

    // A charge already in flight is finished or released independently of the
    // movement decision below — the two are separate in the client too.
    const charging = bot.charging;
    const input: MageInput = charging ? this.continueOrReleaseCharge(w, bot, tune) : emptyInput();

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

    const { move, aim } = this.execute(w, bot, st.last, p, tune, st);
    const dodge = this.reactiveDodge(w, bot, tune, dt, st);

    // Being wedged in the scenery is the one thing that overrides the plan:
    // nothing tactical matters until the bot is free again.
    input.move = st.escapeTimer > 0 ? st.escapeDir : (dodge ?? move);

    if (!charging && aim) {
      // Commit: from here until the throw lands, this is what the charge is
      // for, and `continueOrReleaseCharge` keeps it pointed there.
      st.chargeTarget = aim;
      input.aim = aim.point;
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
    //
    // Unless this one is paranoid, which is the whole of Paranoia: the card
    // does not stop a mage shooting, it stops it *agreeing*. Focus fire is the
    // bot's only teamwork — four mages each answering their own nearest body
    // are four squads of one, spreading damage across four health bars and
    // finishing none of them. Dropped here rather than in `chooseFocusTarget`
    // so a confused mage stops following the squad without stopping the squad
    // from having a plan: the other three keep concentrating, and this one
    // wanders off it.
    if (
      focusTarget &&
      prefersSquadFocus({
        focusVisible: focusLos,
        focusDistSq,
        nearestDistSq,
        engageRangeSq: ENGAGE_RANGE * ENGAGE_RANGE,
        confused: hasEffect(bot, 'confused'),
      })
    ) {
      nearest = focusTarget;
      nearestDistSq = focusDistSq;
    }

    const plan = this.planner.planFor(bot.team);
    // The squad's structure, not this mage's nearest one. Four mages each
    // walking at whichever Tower happens to be closest is four half-pushes.
    const objective = plan.objective;
    const objectiveDistance = objective
      ? bot.position.distanceTo(objective.position) - objective.radius
      : Infinity;

    const underTower = coveringTower(w, bot.team, bot.position);
    // Only a role whose job is absorbing accepts standing in Tower fire, and
    // only in front of the structure the squad actually came for.
    const divingObjective =
      underTower !== null &&
      objective !== null &&
      underTower.id === objective.id &&
      ROLE_BEHAVIOR[bot.role].prefersStructures;

    if (!nearest) {
      return {
        target: null,
        distance: Infinity,
        hasLos: false,
        exposed,
        objective,
        objectiveDistance,
        targetContests: false,
        underTower,
        divingObjective,
        plan,
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
      targetContests: contests(w, bot.team, nearest, objective),
      underTower,
      divingObjective,
      plan,
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
    /*
     * Standing in Tower fire we are getting nothing for is the single largest
     * uncontested source of damage in a match: ~9 damage a second, aimed for
     * free, at whichever of ours is closest. Any mage that is not the squad's
     * anchor treats it as a position to leave, not a fight to win.
     */
    if (p.underTower && !p.divingObjective) retreat = Math.max(retreat, TOWER_ESCAPE_URGE);

    let takeCover: number;
    if (!hasTarget) takeCover = 0;
    else if (!p.exposed && cooldownReady && inRange) takeCover = 0.6;
    else if (!p.exposed || (cooldownReady && inRange)) takeCover = 0;
    else if (cooldownReady) takeCover = 0.48;
    else takeCover = 0.72;

    /*
     * Killing a mage wins nothing by itself — it is back in six seconds and
     * structures are the only score (GDD §4) — so a throw is worth spending when
     * it protects the push or clears our own ground, and worth rather less when
     * it is a healthy stranger crossing midfield.
     *
     * Supports can shoot too (GDD §8), but `role.attackUrge` caps the score so
     * escorting and cover still win most of the time.
     */
    let attack = 0;
    if (role.attacks && p.target && p.hasLos && inRange && cooldownReady) {
      const hurt =
        p.target.maxHealth > 0 ? 1 - clamp(p.target.health / p.target.maxHealth, 0, 1) : 0;
      attack = ATTACK_BASE + hurt * ATTACK_FINISH_BONUS;
      if (p.targetContests) attack += ATTACK_CONTESTS_BONUS;
      // Trading shots under their Tower means trading with the mage *and* the
      // Tower. That is a losing exchange no matter how the duel is going.
      if (p.underTower && !p.divingObjective) attack -= ATTACK_UNDER_TOWER_PENALTY;
      attack = Math.max(0, Math.min(attack, role.attackUrge));
    }

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
     * Siege is the default, and that is the point. The old model only reached
     * for it when nothing else was going on, so on a map where the two squads
     * meet in the middle it essentially never ran and no structure ever fell.
     * Now it is what a mage does unless something is actively worth stopping
     * for — a tank walks past a skirmish outright, a damage dealer stops only
     * for something in its face.
     */
    let siege = 0;
    if (p.objective) {
      if (!hasTarget) siege = 0.9;
      else if (role.prefersStructures) siege = 0.85;
      else if (!inRange) siege = 0.7;
      else siege = 0.6;
      // Pushing is not what the squad is doing right now; the plan says come
      // home or wait. Halving keeps it on the menu as the fallback rather than
      // deleting it, so a mage with nothing else to do still drifts forward.
      if (p.plan.posture !== 'push') siege *= 0.5;
    }

    /*
     * The two plan-driven actions. `Squad.ts` has already decided *whether*
     * the squad should be defending or falling back and applied the hysteresis
     * that stops the two sides flip-flopping; all that is left here is to
     * outrank a push.
     */
    const defend = p.plan.posture === 'defend' && p.plan.threat ? 0.9 : 0;
    const regroup = p.plan.posture === 'regroup' ? 0.8 : 0;

    // Wander is a genuine last resort: with an objective on the map there is
    // always something better to do than drift toward the middle.
    const wander = hasTarget ? 0.05 : p.objective ? 0.02 : 0.6;

    if (!tune.seeksCover) {
      takeCover = 0;
      retreat = 0;
    }

    // AISystem's precedence, with the plan-driven actions slotted between the
    // opportunistic ones and the self-preserving ones: wander < siege <
    // regroup < advance < defend < takeCover < retreat < attack on ties.
    let best: Action = 'wander';
    let score = wander;
    if (siege > score) {
      best = 'siege';
      score = siege;
    }
    if (regroup > score) {
      best = 'regroup';
      score = regroup;
    }
    if (advance > score) {
      best = 'advance';
      score = advance;
    }
    if (defend > score) {
      best = 'defend';
      score = defend;
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

    const structural = best === 'siege' || best === 'regroup';
    return { action: best, targetId: structural ? '' : (p.target?.id ?? '') };
  }

  /** Turns a decision into a movement direction and (optionally) an aim point to charge at. */
  private execute(
    w: World,
    bot: Mage,
    d: Decision,
    p: Perception,
    tune: Tuning,
    st: BotState,
  ): { move: Vec2; aim: AimPoint | null } {
    /*
     * Leaving Tower fire comes before everything, including finding an enemy to
     * run from. `retreat` below needs a target mage to move away from, and the
     * common case here has none — a mage that walked into a Tower's arc chasing
     * something that has since died or fled would otherwise stand in it.
     */
    if (d.action === 'retreat' && p.underTower && !p.divingObjective) {
      return { move: this.escapeTower(w, bot, p.underTower, st), aim: null };
    }

    if (d.action === 'siege' && p.objective) {
      return this.siege(w, bot, p.objective, p.objectiveDistance, p.plan, st);
    }

    /*
     * Supports escort the push rather than hunting (GDD §8). They *can* shoot
     * with a low urge, so attack/defend still reach them when scoring picks
     * those actions — only advance falls through to escort, so a Cleric does
     * not wander off alone to close a gap.
     */
    if (ROLE_BEHAVIOR[bot.role].escorts && d.action === 'advance') {
      return { move: this.escort(w, bot, p.plan, st), aim: null };
    }

    if (d.action === 'regroup') return this.regroup(w, bot, p, tune, st);
    if (d.action === 'defend' && p.plan.threat) return this.defend(w, bot, p, tune, st);

    let target = p.target;
    if (d.targetId) {
      const t = w.mage(d.targetId);
      if (t && t.alive && t.team !== bot.team) target = t;
    }
    if (!target) {
      // Nothing left to fight here — push the objective instead of drifting.
      if (p.objective) return this.siege(w, bot, p.objective, p.objectiveDistance, p.plan, st);
      return { move: this.wander(w, bot, st), aim: null };
    }

    switch (d.action) {
      case 'retreat':
        return { move: this.retreat(w, bot, target, st), aim: null };

      case 'takeCover': {
        const distance = bot.position.distanceTo(target.position);
        if (bot.throwCooldown <= 0 && distance <= ENGAGE_RANGE) {
          if (w.arena.hasLineOfSight(bot.position, target.position)) {
            return {
              move: this.footwork(w, bot, target, distance, st),
              aim: this.attackAim(target, distance, tune),
            };
          }
          const peek = this.findPeekSpot(w, bot, target);
          if (peek) return { move: this.steerTo(w, bot, peek, st), aim: null };
        }
        const cover = this.findCoverSpot(w, bot, target);
        if (cover) return { move: this.steerTo(w, bot, cover, st), aim: null };
        return { move: this.orbit(w, bot, target.position, distance, st), aim: null };
      }

      case 'attack':
        return {
          move: this.footwork(w, bot, target, p.distance, st),
          aim: this.attackAim(target, p.distance, tune),
        };

      case 'advance':
        return { move: this.advance(w, bot, target, st), aim: null };

      default:
        return { move: this.wander(w, bot, st), aim: null };
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
    plan: SquadPlan,
    st: BotState,
  ): { move: Vec2; aim: AimPoint | null } {
    const role = ROLE_BEHAVIOR[bot.role];
    // A support can shoot, but it must not walk off alone to trade with a
    // Tower — the escort is the job, so it keeps that even holding an attack.
    if (role.escorts) return { move: this.escort(w, bot, plan, st), aim: null };

    const standoff = this.siegeStandoff(w, bot, objective, plan);
    const move = this.holdSiegeDistance(w, bot, objective, distance, standoff, st);

    if (
      distance <= ENGAGE_RANGE &&
      bot.throwCooldown <= 0 &&
      w.arena.hasLineOfSight(bot.position, objective.position)
    ) {
      return { move, aim: { point: objective.position, structureId: objective.id } };
    }
    return { move, aim: null };
  }

  /**
   * The goal is the structure itself, not a stand-off point beside it.
   *
   * A stand-off point derived from `bot.position` moves whenever the bot does,
   * so a mage forced off the straight line — around a fence, past its own Tower
   * — is chasing a goal that swings around the structure as it goes, and it
   * orbits instead of arriving. Anchoring on the structure keeps the goal
   * still; `holdSiegeDistance` is what keeps the mage out of it, and the planner
   * snaps a blocked goal to the nearest free cell anyway.
   */
  private approachStructure(w: World, bot: Mage, objective: Structure, st: BotState): Vec2 {
    return this.steerTo(w, bot, objective.position.add(allySeparation(w, bot)), st);
  }

  /**
   * Works the standoff as a band to hold, not a line to stop at.
   *
   * A mage that simply halts on the first tick it is close enough keeps
   * whatever overshoot, knockback or ally shove put it there — and one step too
   * far is the whole difference between shooting a Tower for free and standing
   * in its fire for the rest of the siege. So being *too close* is corrected,
   * not just being too far.
   */
  private holdSiegeDistance(
    w: World,
    bot: Mage,
    objective: Structure,
    distance: number,
    standoff: number,
    st: BotState,
  ): Vec2 {
    if (distance > standoff + SIEGE_DEADBAND) return this.approachStructure(w, bot, objective, st);
    if (distance >= standoff - SIEGE_DEADBAND) return Vec2.zero;

    let away = bot.position.sub(objective.position);
    const len = away.length();
    away = len <= EPSILON ? new Vec2(1, 0) : away.scale(1 / len);
    return this.steerTo(w, bot, objective.position.add(away.scale(objective.radius + standoff)), st);
  }

  /**
   * How close this mage gets to the structure it is breaking.
   *
   * The anchor — a role built to absorb — walks in and takes the volley on
   * purpose, because a Tower shoots whatever is nearest that it can see
   * (`World.towerTarget`) and *someone* is going to be that. Everyone else
   * works the band just outside the Tower's reach, where they can hit it and it
   * cannot hit them, and never gets closer than the anchor. Two consequences
   * fall out of that one rule: a squad with a live tank pushes at the cost of
   * the tank alone, and a squad without one dismantles the Tower from outside
   * its range instead of trading four mages for it.
   */
  private siegeStandoff(w: World, bot: Mage, objective: Structure, plan: SquadPlan): number {
    const role = ROLE_BEHAVIOR[bot.role];
    if (bot.id === plan.anchorId) return role.advanceStopDistance;

    // A Core has no range, so there is no band to work and nothing to hide
    // from — by the time it is targetable both its Towers are already down.
    const safe =
      objective.range > 0 ? objective.range - objective.radius + SAFE_FIRING_MARGIN : role.advanceStopDistance;

    const anchor = w.mage(plan.anchorId);
    const behindAnchor =
      anchor && anchor.alive
        ? anchor.position.distanceTo(objective.position) - objective.radius + ANCHOR_LEAD
        : 0;

    // Never further out than we can still throw from — waiting behind a slow
    // anchor that is still crossing the map would otherwise mean not shooting
    // at all for most of the push.
    return clamp(Math.max(role.advanceStopDistance, safe, behindAnchor), 0, ENGAGE_RANGE - 0.25);
  }

  /**
   * Supports trail whoever the plan is built around (GDD §8) — the anchor while
   * the squad pushes, and otherwise the ally furthest forward. Following the
   * plan's mage rather than the most advanced one keeps a healer with the squad
   * instead of chasing a lone straggler who happens to have wandered deepest.
   */
  private escort(w: World, bot: Mage, plan: SquadPlan, st: BotState): Vec2 {
    const anchor = w.mage(plan.anchorId);
    const ally = anchor && anchor.alive && anchor.id !== bot.id ? anchor : mostAdvancedAlly(w, bot);
    if (!ally) return this.steerTo(w, bot, plan.rally.add(allySeparation(w, bot)), st);

    const gap = bot.position.distanceTo(ally.position);
    const keep = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    // Close enough: hold station, but let spacing nudge it — through the
    // planner, so the nudge can't be into a wall. Empty move when there is
    // nothing to give ground to, so the stuck detector doesn't fire.
    if (gap <= keep) {
      const spread = allySeparation(w, bot);
      if (spread.lengthSq() <= EPSILON) return Vec2.zero;
      return this.steerTo(w, bot, bot.position.add(spread), st);
    }
    return this.steerTo(w, bot, ally.position.add(allySeparation(w, bot)), st);
  }

  /**
   * Answer an enemy standing in our own ground. Our Towers are shooting it
   * already, so meeting it here is the one fight the AI takes on purpose: we
   * have the range support and it does not.
   */
  private defend(
    w: World,
    bot: Mage,
    p: Perception,
    tune: Tuning,
    st: BotState,
  ): { move: Vec2; aim: AimPoint | null } {
    const threat = p.plan.threat;
    if (!threat) return { move: this.steerTo(w, bot, p.plan.rally, st), aim: null };

    const distance = bot.position.distanceTo(threat.position);
    if (
      distance <= ENGAGE_RANGE &&
      bot.throwCooldown <= 0 &&
      w.arena.hasLineOfSight(bot.position, threat.position)
    ) {
      return {
        move: this.footwork(w, bot, threat, distance, st),
        aim: this.attackAim(threat, distance, tune),
      };
    }
    return { move: this.steerTo(w, bot, threat.position.add(allySeparation(w, bot)), st), aim: null };
  }

  /**
   * Fall back to the rally point — but not with our hands down. The rally sits
   * inside our own Tower's cover, so anything that follows us there is being
   * shot at by the Tower and is worth shooting at too.
   */
  private regroup(
    w: World,
    bot: Mage,
    p: Perception,
    tune: Tuning,
    st: BotState,
  ): { move: Vec2; aim: AimPoint | null } {
    const move = this.steerTo(w, bot, p.plan.rally.add(allySeparation(w, bot)), st);
    if (
      ROLE_BEHAVIOR[bot.role].attacks &&
      p.target &&
      p.hasLos &&
      p.distance <= ENGAGE_RANGE &&
      bot.throwCooldown <= 0
    ) {
      return { move, aim: this.attackAim(p.target, p.distance, tune) };
    }
    return { move, aim: null };
  }

  /**
   * The way out of a Tower's arc.
   *
   * Straight away from it is shortest, but a mage backed against the map edge
   * or a rock cannot go straight out — and one that keeps trying grinds on the
   * boundary and takes the whole volley while it does. So the exits are tried
   * from straight-out round to tangential: leaving a circle with a wall behind
   * you means going *around* it, not through it.
   */
  private escapeTower(w: World, bot: Mage, tower: Structure, st: BotState): Vec2 {
    let away = bot.position.sub(tower.position);
    const len = away.length();
    away = len <= EPSILON ? new Vec2(1, 0) : away.scale(1 / len);

    const radius = tower.range + TOWER_STANDOFF;
    for (const angle of ESCAPE_ANGLES) {
      const spot = tower.position.add(away.rotate(angle).scale(radius));
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.blockedAt(spot)) continue;
      return this.steerTo(w, bot, spot, st);
    }
    return this.steerTo(w, bot, tower.position.add(away.scale(radius)), st);
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
  private footwork(w: World, bot: Mage, target: Mage, distance: number, st: BotState): Vec2 {
    const keep = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    const away = bot.position.sub(target.position).normalized();
    if (away.lengthSq() === 0) return Vec2.zero;

    if (distance < keep * (1 - KITE_BAND)) {
      return this.steerTo(w, bot, bot.position.add(away.scale(RETREAT_DISTANCE)), st);
    }
    if (distance > keep * (1 + KITE_BAND)) {
      return this.steerTo(
        w,
        bot,
        this.clearOfTowers(w, bot, target.position.add(away.scale(keep))),
        st,
      );
    }
    // Hold the band by circling — orbit keeps a committed side and clears
    // scenery, which a raw strafe does not.
    return this.orbit(w, bot, target.position, distance, st);
  }

  /**
   * Pulls a destination back out of enemy Tower fire.
   *
   * Closing on a mage that is standing under its own Tower means fighting the
   * mage and the Tower at once, for a kill that is worth nothing on the
   * scoreboard — it is the worst trade available, and it was the one the AI
   * took most often. Only a deliberate siege goes past this line; everything
   * else stops at the edge and makes the enemy come out.
   */
  private clearOfTowers(w: World, bot: Mage, dest: Vec2): Vec2 {
    const tower = coveringTower(w, bot.team, dest);
    if (!tower) return dest;

    const out = dest.sub(tower.position);
    const len = out.length();
    // Standing on the Tower itself gives no direction to back off along; hold
    // where we are and let `retreat` (which outscores this) do the leaving.
    if (len <= EPSILON) return bot.position;
    return tower.position.add(out.scale((tower.range + TOWER_STANDOFF) / len));
  }

  /** The point to charge at, or null when the bot declines to throw this tick. */
  private attackAim(target: Mage, distance: number, tune: Tuning): AimPoint | null {
    if (tune.throwWillingness < 1 && this.rng.float() >= tune.throwWillingness) return null;

    // Aim error grows with distance, exactly as in AISystem.attack.
    const charge01 = clamp(inverseLerp(MIN_THROW_RANGE, ENGAGE_RANGE, distance) * 0.9 + 0.1, 0.18, 1);
    const err = lerp(AIM_ERROR_NEAR, AIM_ERROR_FAR, charge01) * tune.aimErrorScale;
    return {
      mageId: target.id,
      point: new Vec2(
        target.position.x + target.velocity.x * AIM_LEAD_TIME + this.rng.float() * 2 * err - err,
        target.position.y + target.velocity.y * AIM_LEAD_TIME + this.rng.float() * 2 * err - err,
      ),
    };
  }

  /**
   * Keeps a charge already in flight pointed at whatever it was started at, and
   * lets it go once it is full enough for this difficulty.
   *
   * "Whatever it was started at" is the whole job. A siege charge takes over a
   * second to fill and this runs on every tick of it, so re-deriving the aim
   * from the nearest enemy — which is what it used to do — quietly turned every
   * shot a squad aimed at a Tower into a shot flung at a mage that might be
   * halfway across the map. Structures were taking almost no mage fire at all.
   */
  private continueOrReleaseCharge(w: World, bot: Mage, tune: Tuning): MageInput {
    const st = this.state(bot.id);
    const point = this.heldAim(w, bot, st, tune);
    const releasing = bot.charge >= tune.releaseChargeMin;
    return { move: Vec2.zero, aim: point, charging: !releasing, release: releasing };
  }

  /** Where the held charge points this tick — a structure stands still, a mage has to be re-led. */
  private heldAim(w: World, bot: Mage, st: BotState, tune: Tuning): Vec2 {
    const held = st.chargeTarget;

    if (held?.structureId) {
      const s = w.structures.get(held.structureId);
      if (s && s.alive) return s.position;
    }

    if (held?.mageId) {
      const m = w.mage(held.mageId);
      // throwWillingness 1 means attackAim never declines, so this is non-null.
      if (m && m.alive) {
        return this.attackAim(m, bot.position.distanceTo(m.position), {
          ...tune,
          throwWillingness: 1,
        })!.point;
      }
    }

    // What it was aimed at is gone. Spend the charge on the next best thing
    // rather than holding it or throwing it at the floor.
    const enemy = nearestEnemy(w, bot);
    if (enemy) {
      return this.attackAim(enemy, bot.position.distanceTo(enemy.position), {
        ...tune,
        throwWillingness: 1,
      })!.point;
    }

    const objective = this.planner.planFor(bot.team).objective;
    if (objective) return objective.position;
    return bot.position.add(bot.facing);
  }

  private retreat(w: World, bot: Mage, target: Mage, st: BotState): Vec2 {
    const cover = this.findCoverSpot(w, bot, target);
    if (cover) return this.steerTo(w, bot, cover, st);

    let away = bot.position.sub(target.position).normalized();
    if (away.lengthSq() === 0) away = new Vec2(1, 0);
    return this.steerTo(w, bot, bot.position.add(away.scale(RETREAT_DISTANCE)), st);
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
  private advance(w: World, bot: Mage, target: Mage, st: BotState): Vec2 {
    const distance = bot.position.distanceTo(target.position);
    const stopAt = ROLE_BEHAVIOR[bot.role].advanceStopDistance;
    if (distance <= stopAt) return this.footwork(w, bot, target, distance, st);

    // Chasing stops at the edge of their Tower's arc — see `clearOfTowers`.
    const goal = this.clearOfTowers(w, bot, target.position.add(allySeparation(w, bot)));
    return this.steerTo(w, bot, goal, st);
  }

  /**
   * Drift toward the middle when idle, then pick somewhere to be — and *hold*
   * that destination until it is reached (AISystem.wander keeps its move target
   * the same way). Re-rolling a direction every tick, which is what this used
   * to do, averages out to standing still and twitching.
   */
  private wander(w: World, bot: Mage, st: BotState): Vec2 {
    if (!st.wanderTarget || bot.position.distanceTo(st.wanderTarget) <= SPACING) {
      st.wanderTarget =
        bot.position.length() < SPACING
          ? new Vec2(
              (this.rng.float() * 2 - 1) * w.arena.width * 0.25,
              (this.rng.float() * 2 - 1) * w.arena.height * 0.25,
            )
          : Vec2.zero;
    }
    return this.steerTo(w, bot, st.wanderTarget, st);
  }

  /**
   * A unit direction toward `dest`: path first when the direct segment is
   * blocked, then local avoidance with a committed side, then the stuck
   * detector as the backstop. Destinations are clamped into the arena
   * (AISystem.setMoveTarget does the same).
   */
  private steerTo(w: World, bot: Mage, rawDest: Vec2, st: BotState): Vec2 {
    const dest = w.arena.clamp(rawDest, MAGE_RADIUS);
    const dir = dirTo(bot.position, dest);
    if (dir.lengthSq() === 0) return Vec2.zero;
    if (bot.position.distanceTo(dest) <= ARRIVAL_THRESHOLD) return Vec2.zero;

    // Direct route open — drop any cached detour. Crowd sidestep only here:
    // on a planned waypoint it turns a careful route into a shove into a wall.
    if (!w.isBlockedSegment(bot.position, dest)) {
      this.clearPath(st);
      return this.avoidCrowd(w, bot, dir, st);
    }

    const waypoint = this.nextWaypoint(w, bot, st, dest);
    if (waypoint) {
      const atRouteEnd = st.path !== null && st.pathIndex === st.path.length - 1;
      if (atRouteEnd && bot.position.distanceTo(waypoint) <= WAYPOINT_REACHED) return Vec2.zero;

      const toward = dirTo(bot.position, waypoint);
      if (toward.lengthSq() > 0) return toward;
    }

    // No route: local look-ahead sweep with side hysteresis, then the simple
    // ±45°/±90° shuffles the pre-A* steering used as a last resort.
    const reach = Math.min(
      AVOID_LOOKAHEAD,
      Math.max(MAGE_RADIUS * 2, bot.position.distanceTo(dest)),
    );
    for (const angle of AVOID_ANGLES) {
      for (const sign of [st.side, -st.side]) {
        const alt = dir.rotate(angle * sign);
        if (this.clearanceAhead(w, bot, alt, reach) >= reach) {
          st.side = sign;
          return this.avoidCrowd(w, bot, alt, st);
        }
      }
    }
    for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const alt = dir.rotate(angle);
      if (!w.blockedAt(bot.position.add(alt.scale(MAGE_RADIUS * 2)))) return alt;
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

  /**
   * Circle a point while shooting at it. Deliberately lateral — holding a range
   * band is footwork/advance's job; only a target too close to throw at pushes
   * the bot outward as it circles.
   */
  private orbit(w: World, bot: Mage, at: Vec2, distance: number, st: BotState): Vec2 {
    const dir = at.sub(bot.position).normalized();
    if (dir.lengthSq() === 0) return Vec2.zero;

    for (let attempt = 0; attempt < 2; attempt++) {
      let move = new Vec2(-dir.y, dir.x).scale(st.side);
      if (distance < ORBIT_MIN_RANGE) move = move.sub(dir).normalized();
      if (this.clearanceAhead(w, bot, move, ORBIT_LOOKAHEAD, 1) >= ORBIT_LOOKAHEAD) return move;
      st.side = -st.side;
    }

    return this.steerTo(w, bot, bot.position.sub(dir.scale(RETREAT_DISTANCE)), st);
  }

  /**
   * Slides a heading around an ally standing directly in the way.
   *
   * Only allies: sidestepping an enemy while fleeing a Tower is how a bot used
   * to walk the long way around the arc and settle back inside it. Enemies are
   * not solid anyway — the sim separates overlaps — so the jam that needs a
   * committed side is two friendlies walking into each other.
   */
  private avoidCrowd(w: World, bot: Mage, dir: Vec2, st: BotState): Vec2 {
    let blocker: Mage | null = null;
    let blockerAlong = Infinity;

    for (const id of sortedMageIds(w)) {
      const other = w.mage(id);
      if (!other || other.id === bot.id || !other.alive || other.team !== bot.team) continue;

      const delta = other.position.sub(bot.position);
      const along = delta.dot(dir);
      if (along <= 0 || along > CROWD_LOOKAHEAD || along >= blockerAlong) continue;
      if (Math.abs(delta.x * -dir.y + delta.y * dir.x) > SPACING) continue;

      blockerAlong = along;
      blocker = other;
    }
    if (!blocker) return dir;

    const side = new Vec2(-dir.y, dir.x).scale(st.side);
    return dir.add(side.scale(CROWD_SIDESTEP)).normalized();
  }

  /**
   * How far the bot can walk along `dir` before hitting something solid, capped
   * at `reach`.
   */
  private clearanceAhead(
    w: World,
    bot: Mage,
    dir: Vec2,
    reach: number,
    margin = AVOID_MARGIN,
  ): number {
    const step = reach / AVOID_SAMPLES;
    for (let i = 1; i <= AVOID_SAMPLES; i++) {
      const t = step * i;
      const point = bot.position.add(dir.scale(t));
      if (!w.arena.contains(point, MAGE_RADIUS) || w.blockedAt(point, MAGE_RADIUS * margin)) {
        return t - step;
      }
    }
    return reach;
  }

  /* ---- getting unstuck --------------------------------------------------- */

  /**
   * Watches whether a bot actually goes where it asked to go. Steering can
   * always be fooled, so a bot that has been pushing into something for
   * STUCK_TRIGGER seconds drops its plan and walks itself out.
   */
  private trackProgress(w: World, bot: Mage, st: BotState, dt: number): void {
    if (st.escapeTimer > 0) st.escapeTimer = Math.max(0, st.escapeTimer - dt);

    const previous = st.lastPos;
    st.lastPos = bot.position;
    if (!previous) return;

    const asked = bot.input.move.lengthSq() > 0.04;
    const progress = bot.position.distanceTo(previous);
    const wedged = w.blockedAt(bot.position);
    // A planned route is already the answer to "how do I get around this" —
    // counting every slow corner as stuck just clears the path and sends the
    // bot the wrong way. Only a body actually inside geometry, or a bot with
    // no route left that still is not moving, needs the escape backstop.
    const followingPath = st.path !== null && st.path.length > 0;
    const stalled =
      asked && bot.stunTimer <= 0 && progress < bot.moveSpeed * dt * STUCK_SPEED_FRACTION;
    if (stalled && (wedged || !followingPath)) {
      st.stuckTimer += dt;
    } else {
      st.stuckTimer = Math.max(0, st.stuckTimer - dt * 2);
    }

    const trigger = wedged ? STUCK_TRIGGER * 0.5 : STUCK_TRIGGER;
    if (st.stuckTimer < trigger || st.escapeTimer > 0) return;

    st.stuckTimer = 0;
    st.escapeTimer = UNSTICK_DURATION;
    st.escapeDir = this.escapeDirection(w, bot);
    st.side = -st.side;
    this.clearPath(st);
  }

  private escapeDirection(w: World, bot: Mage): Vec2 {
    const clear = w.arena
      .pushOutOfObstacles(bot.position, MAGE_RADIUS * ESCAPE_PROBE)
      .add(w.pushOutOfStructures(bot.position, MAGE_RADIUS * ESCAPE_PROBE));

    let best = clear.lengthSq() > EPSILON ? clear.normalized() : bot.facing.normalized();
    if (best.lengthSq() === 0) best = new Vec2(1, 0);

    let bestClearance = this.clearanceAhead(w, bot, best, ESCAPE_REACH, 1);
    if (bestClearance >= ESCAPE_REACH) return best;

    const base = best;
    for (let i = 1; i < ESCAPE_DIRECTIONS; i++) {
      const candidate = base.rotate((2 * Math.PI * i) / ESCAPE_DIRECTIONS);
      const clearance = this.clearanceAhead(w, bot, candidate, ESCAPE_REACH, 1);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
    }
    return best;
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
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.blockedAt(spot)) continue;
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
      if (!w.arena.contains(spot, MAGE_RADIUS) || w.blockedAt(spot)) continue;
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
 * Whether a target is worth stopping the push for: it is close enough to the
 * structure we came to break to be defending it, or it is loose in our own
 * ground. Anything else is a mage crossing midfield — shooting it wins nothing
 * it does not get back on respawn (GDD §4).
 */
function contests(w: World, team: Team, target: Mage, objective: Structure | null): boolean {
  if (objective && target.position.distanceTo(objective.position) <= ENGAGE_RANGE * 1.2) return true;
  return isOurGround(w, team, target.position);
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
    // Whoever escorts is not escorted: two supports following each other would
    // leave the line they exist to hold up.
    if (ROLE_BEHAVIOR[m.role].escorts) continue;
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
  let score = !w.arena.contains(dest, MAGE_RADIUS) || w.blockedAt(dest) ? -10 : 10;
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
