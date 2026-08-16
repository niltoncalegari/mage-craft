/**
 * The one file the whole simulation is tuned from.
 *
 * Every combat number used to be a literal spread across five modules
 * (`config.ts`, `roles.ts`, `cards.ts`, `elements.ts`, `spells.ts`), which made
 * a balance pass a hunt rather than an edit. They now all live in
 * `public/data/balance.json` and those modules read from here — their public
 * API is unchanged, so nothing that imports `MAGE_RADIUS` or `elementDefFor`
 * had to move.
 *
 * The load is a *static import*, mirroring `defaultMap.ts`: the bundler inlines
 * it, so the same numbers reach the browser client, the Node server and Vitest
 * with no fetch and no shim. A runtime fetch would let the server and a client
 * disagree about how much a fireball hurts, which is the one thing an
 * authoritative sim cannot allow.
 *
 * `balance.test.ts` is what stops this file drifting from the catalogs: it
 * asserts every id, role and effect kind in the JSON resolves.
 */

import raw from '../public/data/balance.json';

/* ---- Schema ---------------------------------------------------------------- */

/** How a second application of the same effect combines with the one running. */
export type StackingRule =
  /** Take the stronger magnitude and the longer remaining time. */
  | 'refresh_strongest'
  /** Add a stack (up to `maxStacks`) and refresh the duration; intensity scales. */
  | 'stack_intensity'
  /** A pool of absorption: keep whichever pool is larger. */
  | 'pool';

export interface EffectRule {
  readonly stacking: StackingRule;
  /** Only meaningful for `stack_intensity`. */
  readonly maxStacks?: number;
  /** Clamp applied after stacking, so a chain of casts cannot reach 100% slow. */
  readonly maxMagnitude: number;
}

/**
 * A rider on an element's hit. `effect` names either a status kind from
 * `effects.ts` or one of the instant riders the applier handles directly
 * (`interrupt`, `shield_break`, `puddle`).
 */
export interface OnHitRule {
  readonly effect: string;
  readonly magnitude?: number;
  readonly duration?: number;
  readonly tickInterval?: number;
  readonly tickDamage?: number;
  /** Puddle only. */
  readonly radius?: number;
  /** Puddle only: also drop it where the projectile lands after a miss. */
  readonly onExpire?: boolean;
  /**
   * When present, the rider only fires once the victim has taken `hits`
   * consecutive hits of this element inside `window` seconds. `reset` clears
   * the streak on fire (a stun that must be re-earned) rather than holding it
   * at the threshold (a burn that every later hit refreshes).
   */
  readonly trigger?: {
    readonly hits: number;
    readonly window: number;
    readonly reset: boolean;
  };
}

export interface ElementRule {
  readonly name: string;
  readonly flight: {
    readonly minSpeed: number;
    readonly projectileSpeed: number;
    readonly launchArc: number;
    readonly gravity: number;
    readonly radius: number;
  };
  readonly damage: number;
  readonly knockback: number;
  readonly knockbackBonus?: number;
  readonly splashRadius?: number;
  readonly onHit?: readonly OnHitRule[];
}

export interface RosterRule {
  readonly name: string;
  readonly role: string;
  readonly health: number;
  readonly moveSpeed: number;
  readonly element: string;
  readonly healPerSecond?: number;
  readonly healRange?: number;
  readonly auraChargeBonus?: number;
  readonly auraRadius?: number;
}

export interface RoleRule {
  readonly attacks: boolean;
  readonly attackUrge: number;
  readonly advanceStopDistance: number;
  readonly prefersStructures: boolean;
  readonly escorts: boolean;
  readonly seeksCover: boolean;
  readonly retreatHealthFraction: number;
}

export interface SpellRule {
  readonly name: string;
  readonly kind: string;
  readonly cost: number;
  readonly radius: number;
  readonly duration: number;
  readonly effect: {
    readonly kind: string;
    readonly speedFactor?: number;
    readonly castFactor?: number;
    readonly slowFactor?: number;
    readonly amount?: number;
    readonly tickDamage?: number;
    readonly tickInterval?: number;
  };
}

export interface Balance {
  readonly version: number;
  readonly sim: {
    readonly hz: number;
    readonly mageRadius: number;
    readonly maxHealth: number;
    readonly moveSpeed: number;
    readonly acceleration: number;
    readonly turnSpeed: number;
    readonly aimTurnSpeed: number;
    readonly aimDeadzone: number;
    readonly spacing: number;
    readonly chargeTime: number;
    readonly windup: number;
    readonly recovery: number;
    readonly throwCooldown: number;
    readonly launchHeight: number;
    readonly spawnMargin: number;
    readonly maxProjectileLifetime: number;
    readonly hitStun: number;
    readonly knockbackDamping: number;
    readonly knockbackStopSpeed: number;
    readonly healInterruptKnockback: number;
    readonly healInterruptDuration: number;
    readonly respawnDelay: number;
    readonly respawnImmunity: number;
    readonly squadSize: number;
    readonly manaMax: number;
    readonly manaStart: number;
    readonly manaRegenInterval: number;
    readonly suddenDeathManaMultiplier: number;
    readonly matchDuration: number;
    readonly suddenDeathDuration: number;
    readonly spellCastFxDuration: number;
    readonly spellGlobalCooldown: number;
    readonly obstacleTopHeight: Readonly<Record<string, number>>;
  };
  readonly structures: {
    readonly coreHealth: number;
    readonly towerHealth: number;
    readonly coreRadius: number;
    readonly towerRadius: number;
    readonly towerRange: number;
    readonly towerAttackInterval: number;
    readonly towerDamage: number;
    readonly topHeight: number;
    /** Flat multiplier on projectile damage vs structures (before the time ramp). */
    readonly siegeDamageMultiplier: number;
    /** Siege ramp at match start (multiplies siegeDamageMultiplier). */
    readonly siegeRampStart: number;
    /** Siege ramp at the end of normal time. */
    readonly siegeRampEnd: number;
    /** Flat siege ramp held during sudden death. */
    readonly siegeRampSuddenDeath: number;
    /** HP/s structures lose during sudden death when reachable. */
    readonly suddenDeathStructureDecay: number;
  };
  readonly roles: Readonly<Record<string, RoleRule>>;
  readonly roster: Readonly<Record<string, RosterRule>>;
  readonly effects: Readonly<Record<string, EffectRule>>;
  readonly elements: Readonly<Record<string, ElementRule>>;
  readonly spells: Readonly<Record<string, SpellRule>>;
}

/** The parsed tuning table. Treat as immutable — the sim reads it every tick. */
export const BALANCE = raw as unknown as Balance;
