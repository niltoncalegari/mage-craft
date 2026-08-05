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

export const RESPAWN_DELAY = 1;
export const RESPAWN_IMMUNITY = 5;
/**
 * Summoned mages do not respawn (GDD §4) — they die and the mana that bought
 * them is what comes back. Kept at 1 so a unit has exactly one life.
 */
export const DEFAULT_LIVES = 1;
/**
 * How long a dead summon stays in the world before it is dropped, so the client
 * has a beat to play the death rather than having the unit vanish mid-frame.
 */
export const CORPSE_LINGER = 0.8;

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

/* ---- Deployment (GDD §5) --------------------------------------------------- */

/**
 * How far past the arena midline a team may deploy once it has broken a flank.
 * Zero until the corresponding enemy tower falls.
 */
export const DEPLOY_ADVANCE_DEPTH = 8;
/** A summon may not be planted this close to a live enemy structure. */
export const DEPLOY_STRUCTURE_CLEARANCE = 3;

/** Height of each obstacle type's top, mirroring the client's OBSTACLE_HEIGHT. */
export const OBSTACLE_TOP_HEIGHT = {
  tree: 2.4,
  rock: 1.0,
  fort: 1.3,
  fence: 0.85,
  prop: 0.9,
} as const;
