/**
 * Central gameplay tuning for the authoritative simulation (GDD §8, §14 —
 * direction of design, not final balance numbers).
 *
 * The movement/aim block below is deliberately numerically identical to the
 * client's `src/game/config.ts` (PLAYER.acceleration / PLAYER.turnSpeed /
 * AIM.turnSpeed / PLAYER.spacing) so online matches have the same weight and
 * turn feel as practice mode.
 */

/** Fixed simulation rate, in Hz. */
export const SIM_HZ = 60;
/** Fixed timestep, in seconds. */
export const SIM_DT = 1 / SIM_HZ;

export const MAGE_RADIUS = 0.5;
export const MAX_HEALTH = 100;
/** World units per second. */
export const MOVE_SPEED = 6;

/** World units/sec^2. */
export const ACCELERATION = 40;
/** Radians/sec, body turning to face its movement direction. */
export const TURN_SPEED = 12;
/** Radians/sec, turning toward the aim point while charging. */
export const AIM_TURN_SPEED = 15;
/** Aim points closer than this leave facing untouched. */
export const AIM_DEADZONE = 1.2;
/** Desired separation between mages. */
export const SPACING = 1.4;

/** Seconds to reach full charge. */
export const CHARGE_TIME = 1.5;
export const WINDUP = 0.18;
export const RECOVERY = 0.25;
export const THROW_COOLDOWN = 0.6;

export const LAUNCH_HEIGHT = 1;
export const SPAWN_MARGIN = 0.6;
export const MAX_PROJECTILE_LIFETIME = 5;

export const HIT_STUN = 0.35;
/**
 * A hit sets an initial knockback velocity that decays exponentially over the
 * hit-stun window rather than teleporting the mage — numerically matching the
 * client's DamageSystem KNOCKBACK_DAMPING / STOP_SPEED.
 */
export const KNOCKBACK_DAMPING = 12;
export const KNOCKBACK_STOP_SPEED = 0.02;

/**
 * Squad mages always come back (GDD §4) — death costs presence on the field,
 * not the mage itself. This number is one of the two unmeasured dials GDD §10
 * flags as deciding whether an AFK player actually loses: too short and death
 * is meaningless, too long and one push snowballs unrecoverably.
 */
export const RESPAWN_DELAY = 6;
export const RESPAWN_IMMUNITY = 5;

/* ---- Squad (GDD §4, §7) ---------------------------------------------------- */

/** Mages per team, fixed at match start and permanent for the whole match. */
export const SQUAD_SIZE = 4;

/* ---- Mana economy (GDD §6) ----------------------------------------------- */

export const MANA_MAX = 10;
export const MANA_START = 5;
/** Seconds to regenerate one mana during normal time. */
export const MANA_REGEN_INTERVAL = 2.8;
/** Sudden death doubles the rate (GDD §4, §6). */
export const SUDDEN_DEATH_MANA_MULTIPLIER = 2;

/* ---- Match structure (GDD §4) -------------------------------------------- */

/** Normal time, in seconds. */
export const MATCH_DURATION = 180;
/** Sudden death that follows a structure-count draw, in seconds. */
export const SUDDEN_DEATH_DURATION = 60;

/* ---- Structures (GDD §5) -------------------------------------------------- */

/*
 * Structure health is the main dial on how offensive the game is. The first
 * pass (1400/700) made two competent players deadlock: every seeded AI-vs-AI
 * match drew at the sudden-death timeout because neither side could ever break
 * a Tower through the other's defence — exactly the failure GDD §14 warns about.
 * These values let a well-supported push convert, while a lone unit still dies
 * to the Tower before it does real damage.
 */
export const CORE_HEALTH = 900;
export const TOWER_HEALTH = 400;
export const CORE_RADIUS = 1.6;
export const TOWER_RADIUS = 1.1;
/** Towers engage at the same range the bot AI already considers "in fight". */
export const TOWER_RANGE = 9;
export const TOWER_ATTACK_INTERVAL = 1.1;
export const TOWER_DAMAGE = 10;
/** Structures are hit by projectiles flying below this height. */
export const STRUCTURE_TOP_HEIGHT = 2.6;

/* ---- Spells (GDD §9) -------------------------------------------------------- */
/*
 * Direction of design, not measured balance (GDD §9 flags the deck as half
 * real: only these 4 of the planned 8 spells are designed yet).
 */

export const BLESSING_COST = 2;
export const BLESSING_RADIUS = 4;
export const BLESSING_DURATION = 5;
export const BLESSING_SPEED_BONUS = 0.4;
export const BLESSING_CAST_BONUS = 0.25;

export const SLOW_CURSE_COST = 3;
export const SLOW_CURSE_RADIUS = 4;
export const SLOW_CURSE_DURATION = 4;
export const SLOW_CURSE_FACTOR = 0.5;

export const SHIELD_COST = 3;
export const SHIELD_RADIUS = 4;
export const SHIELD_DURATION = 6;
export const SHIELD_AMOUNT = 60;

export const PLAGUE_COST = 4;
export const PLAGUE_RADIUS = 3.5;
export const PLAGUE_DURATION = 5;
export const PLAGUE_TICK_INTERVAL = 1;
/** Per tick, at PLAGUE_TICK_INTERVAL — reads as "10 damage/s" in the GDD. */
export const PLAGUE_TICK_DAMAGE = 10;

/**
 * How long a cast stays in the snapshot purely so clients can play its VFX
 * (GDD §17). Nothing in combat reads it: a buff/curse lands the instant it is
 * cast, but the wire has no event channel, so the cast has to linger in a few
 * consecutive snapshots for a client to notice it at all at 20Hz.
 */
export const SPELL_CAST_FX_DURATION = 1;

/** Height of each obstacle type's top, mirroring the client's OBSTACLE_HEIGHT. */
export const OBSTACLE_TOP_HEIGHT = {
  tree: 2.4,
  rock: 1.0,
  fort: 1.3,
  fence: 0.85,
  prop: 0.9,
} as const;
