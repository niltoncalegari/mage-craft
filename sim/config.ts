/**
 * Central gameplay tuning for the authoritative simulation (GDD §8, §14 —
 * direction of design, not final balance numbers).
 *
 * The values themselves now live in `public/data/balance.json` and arrive via
 * `sim/balance.ts`; this module is the named, typed surface the rest of the sim
 * imports, so a balance pass is one JSON edit rather than a hunt through five
 * modules. Every export below keeps the name and meaning it always had.
 *
 * The movement/aim block is deliberately numerically identical to the client's
 * `src/game/config.ts` (PLAYER.acceleration / PLAYER.turnSpeed / AIM.turnSpeed
 * / PLAYER.spacing) so online matches have the same weight and turn feel as
 * practice mode.
 */

import { BALANCE } from './balance';

const S = BALANCE.sim;
const ST = BALANCE.structures;

/** Fixed simulation rate, in Hz. */
export const SIM_HZ = S.hz;
/** Fixed timestep, in seconds. */
export const SIM_DT = 1 / SIM_HZ;

export const MAGE_RADIUS = S.mageRadius;
export const MAX_HEALTH = S.maxHealth;
/** World units per second. */
export const MOVE_SPEED = S.moveSpeed;

/** World units/sec^2. */
export const ACCELERATION = S.acceleration;
/** Radians/sec, body turning to face its movement direction. */
export const TURN_SPEED = S.turnSpeed;
/** Radians/sec, turning toward the aim point while charging. */
export const AIM_TURN_SPEED = S.aimTurnSpeed;
/** Aim points closer than this leave facing untouched. */
export const AIM_DEADZONE = S.aimDeadzone;
/** Desired separation between mages. */
export const SPACING = S.spacing;

/** Seconds to reach full charge. */
export const CHARGE_TIME = S.chargeTime;
export const WINDUP = S.windup;
export const RECOVERY = S.recovery;
export const THROW_COOLDOWN = S.throwCooldown;

export const LAUNCH_HEIGHT = S.launchHeight;
export const SPAWN_MARGIN = S.spawnMargin;
export const MAX_PROJECTILE_LIFETIME = S.maxProjectileLifetime;

export const HIT_STUN = S.hitStun;
/**
 * A hit sets an initial knockback velocity that decays exponentially over the
 * hit-stun window rather than teleporting the mage — numerically matching the
 * client's DamageSystem KNOCKBACK_DAMPING / STOP_SPEED.
 */
export const KNOCKBACK_DAMPING = S.knockbackDamping;
export const KNOCKBACK_STOP_SPEED = S.knockbackStopSpeed;

/**
 * A shove breaks a healer's concentration (GDD §9). A hit that imparts at
 * least this much knockback stops the victim's healing for
 * `HEAL_INTERRUPT_DURATION` seconds — momentarily, not for the rest of the
 * fight: a Cleric that is being shoved around heals in gaps instead of
 * continuously, which is the counterplay a permanent 8 HP/s aura had none of.
 *
 * The threshold is what makes this an answer rather than a nerf: at 3.0 only
 * the heavy hits qualify (fire 3.5, arcane 3.0, stone 6.0, wind 8.5), so
 * chipping the Cleric with lightning or a Bard's wave does not shut it down,
 * and arcane's half-knockback splash does not either.
 */
export const HEAL_INTERRUPT_KNOCKBACK = S.healInterruptKnockback;
export const HEAL_INTERRUPT_DURATION = S.healInterruptDuration;

/**
 * Squad mages always come back (GDD §4) — death costs presence on the field,
 * not the mage itself. This number is one of the two unmeasured dials GDD §10
 * flags as deciding whether an AFK player actually loses: too short and death
 * is meaningless, too long and one push snowballs unrecoverably.
 */
export const RESPAWN_DELAY = S.respawnDelay;
export const RESPAWN_IMMUNITY = S.respawnImmunity;

/* ---- Squad (GDD §4, §7) ---------------------------------------------------- */

/** Mages per team, fixed at match start and permanent for the whole match. */
export const SQUAD_SIZE = S.squadSize;

/* ---- Mana economy (GDD §6) ----------------------------------------------- */

export const MANA_MAX = S.manaMax;
export const MANA_START = S.manaStart;
/** Seconds to regenerate one mana during normal time. */
export const MANA_REGEN_INTERVAL = S.manaRegenInterval;
/** Sudden death doubles the rate (GDD §4, §6). */
export const SUDDEN_DEATH_MANA_MULTIPLIER = S.suddenDeathManaMultiplier;

/* ---- Match structure (GDD §4) -------------------------------------------- */

/** Normal time, in seconds. */
export const MATCH_DURATION = S.matchDuration;
/** Sudden death that follows a structure-count draw, in seconds. */
export const SUDDEN_DEATH_DURATION = S.suddenDeathDuration;

/* ---- Structures (GDD §5) -------------------------------------------------- */

/*
 * Structure health + siege scaling are the dials on how offensive the game is.
 *
 * They were briefly tuned twice in the same direction — Tower HP cut 400 -> 72
 * *and* a 5.5x siege multiplier added on top — because the pre-pathfinding bots
 * could not reach a Tower at all. Compounded, that made a single stone bolt
 * (32 raw x 14.3) delete a Tower, and AI-vs-AI matches ended in ~17s. Now that
 * the bots path to structures, the multiplier is back to 1.0 and Tower HP does
 * the work, measured against the ~10 raw dmg/s a committed push actually lands:
 * the first Tower falls around 35s of a 180s match.
 *
 * Note the dials are not independent of GDD §14's difficulty problem. Measured
 * hard-vs-easy win rate over 40 seeds rises as matches get shorter (48% at
 * Tower 550, 50% at 400, 55% at 250, 63% at the 17s-match values) — with
 * mirrored squads, a shorter match just means the opening cast decides more.
 * That is not a reason to keep Towers cheap: closing the skill gap is spell
 * design (§13 step 9), not a structure-HP dial.
 */
export const CORE_HEALTH = ST.coreHealth;
export const TOWER_HEALTH = ST.towerHealth;
export const CORE_RADIUS = ST.coreRadius;
export const TOWER_RADIUS = ST.towerRadius;
/** Towers engage at the same range the bot AI already considers "in fight". */
export const TOWER_RANGE = ST.towerRange;
export const TOWER_ATTACK_INTERVAL = ST.towerAttackInterval;
export const TOWER_DAMAGE = ST.towerDamage;
/** Structures are hit by projectiles flying below this height. */
export const STRUCTURE_TOP_HEIGHT = ST.topHeight;

/* ---- Siege pressure (GDD §4, §14) ----------------------------------------- */

export const STRUCTURE_DAMAGE_MULTIPLIER = ST.siegeDamageMultiplier;
export const SIEGE_RAMP_START = ST.siegeRampStart;
export const SIEGE_RAMP_END = ST.siegeRampEnd;
export const SIEGE_RAMP_SUDDEN_DEATH = ST.siegeRampSuddenDeath;
/** HP per second reachable structures lose in sudden death. */
export const SUDDEN_DEATH_STRUCTURE_DECAY = ST.suddenDeathStructureDecay;

/* ---- Spells (GDD §9) -------------------------------------------------------- */
/*
 * Direction of design, not measured balance (GDD §9 flags the deck as half
 * real: only these 4 of the planned 8 spells are designed yet).
 */

export const BLESSING_COST = BALANCE.spells.blessing.cost;
export const BLESSING_RADIUS = BALANCE.spells.blessing.radius;
export const BLESSING_DURATION = BALANCE.spells.blessing.duration;
export const BLESSING_SPEED_BONUS = BALANCE.spells.blessing.effect.speedFactor ?? 0;
export const BLESSING_CAST_BONUS = BALANCE.spells.blessing.effect.castFactor ?? 0;

export const SLOW_CURSE_COST = BALANCE.spells.slow_curse.cost;
export const SLOW_CURSE_RADIUS = BALANCE.spells.slow_curse.radius;
export const SLOW_CURSE_DURATION = BALANCE.spells.slow_curse.duration;
export const SLOW_CURSE_FACTOR = BALANCE.spells.slow_curse.effect.slowFactor ?? 0;

export const SHIELD_COST = BALANCE.spells.arcane_shield.cost;
export const SHIELD_RADIUS = BALANCE.spells.arcane_shield.radius;
export const SHIELD_DURATION = BALANCE.spells.arcane_shield.duration;
export const SHIELD_AMOUNT = BALANCE.spells.arcane_shield.effect.amount ?? 0;

export const PLAGUE_COST = BALANCE.spells.plague.cost;
export const PLAGUE_RADIUS = BALANCE.spells.plague.radius;
export const PLAGUE_DURATION = BALANCE.spells.plague.duration;
export const PLAGUE_TICK_INTERVAL = BALANCE.spells.plague.effect.tickInterval ?? 0;
/** Per tick, at PLAGUE_TICK_INTERVAL — reads as "10 damage/s" in the GDD. */
export const PLAGUE_TICK_DAMAGE = BALANCE.spells.plague.effect.tickDamage ?? 0;

/**
 * How long a cast stays in the snapshot purely so clients can play its VFX
 * (GDD §17). Nothing in combat reads it: a buff/curse lands the instant it is
 * cast, but the wire has no event channel, so the cast has to linger in a few
 * consecutive snapshots for a client to notice it at all at 20Hz.
 */
export const SPELL_CAST_FX_DURATION = S.spellCastFxDuration;

/**
 * Minimum seconds between two casts by the same team (GDD §6).
 *
 * Mana is the economy, not the clock: a team sitting on a full bank can spend
 * it on 2-cost cards five ticks in a row, which is fine when a pair of human
 * hands is the bottleneck and stops being fine the moment an autonomous
 * caster runs inside the tick loop. This is the floor that keeps a program and
 * a person spending at comparable rates.
 *
 * Chosen to sit under every Commander cadence (1.1s on hard) so the existing
 * bots never feel it, and to stretch a full bank of cheap casts from five
 * ticks to a few seconds.
 */
export const SPELL_GLOBAL_COOLDOWN = S.spellGlobalCooldown;

/** Height of each obstacle type's top, mirroring the client's OBSTACLE_HEIGHT. */
export const OBSTACLE_TOP_HEIGHT: Readonly<Record<'tree' | 'rock' | 'fort' | 'fence' | 'prop', number>> =
  S.obstacleTopHeight as Readonly<Record<'tree' | 'rock' | 'fort' | 'fence' | 'prop', number>>;
