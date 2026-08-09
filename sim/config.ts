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
 * Structure health is the main dial on how offensive the game is. The first
 * pass (1400/700) made two competent players deadlock: every seeded AI-vs-AI
 * match drew at the sudden-death timeout because neither side could ever break
 * a Tower through the other's defence — exactly the failure GDD §14 warns about.
 * These values let a well-supported push convert, while a lone unit still dies
 * to the Tower before it does real damage.
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

/** Height of each obstacle type's top, mirroring the client's OBSTACLE_HEIGHT. */
export const OBSTACLE_TOP_HEIGHT: Readonly<Record<'tree' | 'rock' | 'fort' | 'fence' | 'prop', number>> =
  S.obstacleTopHeight as Readonly<Record<'tree' | 'rock' | 'fort' | 'fence' | 'prop', number>>;
