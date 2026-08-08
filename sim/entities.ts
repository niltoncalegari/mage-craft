/** Simulation entity types (GDD §5, §8, §9). */

import type { RosterId } from './cards';
import type { ElementId } from './elements';
import type { Role } from './roles';
import { Vec2 } from './Vec2';

/** The two opposing sides in a room (GDD §5, §7). Wire-level, not POV-relative. */
export const TEAM_A = 0;
export const TEAM_B = 1;
export type Team = typeof TEAM_A | typeof TEAM_B;

export function opponentOf(team: Team): Team {
  return team === TEAM_A ? TEAM_B : TEAM_A;
}

/**
 * Mirrors the client's finite state machine (design.md §10). Note that
 * `charging` and `recovering` do *not* root a mage — only `stunned`/`dead` do,
 * matching the client's `canAcceptOrders`.
 */
export type MageState = 'idle' | 'moving' | 'charging' | 'recovering' | 'stunned' | 'dead';

/** The latest input command for a mage, applied at the start of a tick (GDD §6). */
export interface MageInput {
  /** Desired movement direction; magnitude clamped to 1. */
  move: Vec2;
  /** World-space aim *point* (not a direction — the sim derives the direction). */
  aim: Vec2;
  charging: boolean;
  release: boolean;
}

export function emptyInput(): MageInput {
  return { move: Vec2.zero, aim: Vec2.zero, charging: false, release: false };
}

/**
 * A squad mage (GDD §4, §8, §9). Always autonomous: no mage is ever steered
 * by a human — the player's agency is *which* spell, *where* and *when*, and
 * from the moment this exists it is driven by `bot/Brain.ts`. It is
 * permanent: it respawns after `RESPAWN_DELAY` instead of leaving the world
 * for good (GDD §4).
 */
export interface Mage {
  readonly id: string;
  readonly team: Team;
  readonly isBot: boolean;
  element: ElementId;

  /** Identity (GDD §8). Drives behaviour via `ROLE_BEHAVIOR`. */
  readonly role: Role;
  /** Which roster entry this mage is, for snapshots and post-match stats. */
  readonly rosterId: RosterId | null;
  /** Per-unit, from the roster entry — no longer the global MOVE_SPEED. */
  readonly moveSpeed: number;

  position: Vec2;
  facing: Vec2;
  /** Accelerated toward the input direction rather than snapped; read by the bot AI for aim leading. */
  velocity: Vec2;

  health: number;
  maxHealth: number;
  alive: boolean;

  /**
   * Enemy mages this one has personally put down (GDD §4). A team's kill total
   * is *not* the sum of these — see `World.kill`: a Tower bolt, a Praga zone and
   * friendly fire all take a mage off the field with nobody to credit. The team
   * total is the opposing team's `deaths`.
   */
  kills: number;
  /** Times this mage has been put down. Squads are permanent, so this only grows. */
  deaths: number;

  state: MageState;

  /** 0..1 */
  charge: number;
  charging: boolean;
  throwCooldown: number;
  recoveryTimer: number;

  stunTimer: number;
  knockbackVelocity: Vec2;

  /** Set by an ice hit or the Maldição da Lentidão curse, whichever is stronger (GDD §9). */
  slowFactor: number;
  slowTimer: number;

  immunityTimer: number;
  respawnTimer: number;

  /** Recomputed every tick from nearby friendly support auras (GDD §9). */
  chargeRateBonus: number;

  /** Bênção de Ímpeto — a temporary move-speed multiplier, on top of the aura's cast bonus (GDD §9). */
  speedBuffFactor: number;
  speedBuffTimer: number;
  /** Bênção de Ímpeto's cast-speed half; merges with `chargeRateBonus` by taking the larger. */
  castBuffFactor: number;
  castBuffTimer: number;

  /** Escudo Arcano — absorbs damage before health, except a curse zone's tick (GDD §9). */
  shieldAmount: number;
  shieldTimer: number;

  input: MageInput;
}

/** A flying conjuration spawned by a mage's throw (GDD §8). */
export interface Projectile {
  readonly id: string;
  readonly ownerId: string;
  readonly team: Team;
  readonly element: ElementId;

  position: Vec2;
  velocity: Vec2;

  height: number;
  heightVelocity: number;
  gravity: number;

  damage: number;
  knockback: number;
  radius: number;

  age: number;
  alive: boolean;
}

/**
 * A ground effect zone spawned by poison (GDD §8.5) or by the Praga curse
 * (GDD §9). It hurts everyone who overlaps it, including its caster's team,
 * by design.
 */
export interface Puddle {
  readonly id: string;
  readonly ownerId: string;

  position: Vec2;
  radius: number;

  duration: number;
  elapsed: number;
  tickInterval: number;
  tickDamage: number;
  tickTimer: number;

  alive: boolean;
  /** Praga ignores Escudo Arcano by design (GDD §9); poison does not set this. */
  readonly bypassShield?: boolean;
}

/* ---- Structures (GDD §5) -------------------------------------------------- */

/**
 * The objective. A team loses the moment its Core falls, and the Core is immune
 * while either of its Towers still stands — that immunity is what stops a
 * minute-one rush and gives the match its shape.
 */
export type StructureKind = 'core' | 'tower';

export interface Structure {
  readonly id: string;
  readonly team: Team;
  readonly kind: StructureKind;
  /** Static: structures never move, so this is set once at construction. */
  readonly position: Vec2;
  readonly radius: number;

  health: number;
  readonly maxHealth: number;
  alive: boolean;

  /** Towers shoot; Cores do not (range 0). */
  readonly range: number;
  readonly damage: number;
  readonly attackInterval: number;
  attackCooldown: number;

  /** Recomputed each tick: a Core is invulnerable while a Tower of its team lives. */
  invulnerable: boolean;
}

export function isCore(s: Structure): boolean {
  return s.kind === 'core';
}

