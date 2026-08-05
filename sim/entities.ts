/** Simulation entity types (GDD §5, §8, §9). */

import type { CardId } from './cards';
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
 * A summoned unit (GDD §8, §9). Always autonomous: since the pivot no mage is
 * ever steered by a human — the player's agency is *which* card, *where* and
 * *when*, and from the moment this exists it is driven by `bot/Brain.ts`.
 */
export interface Mage {
  readonly id: string;
  readonly team: Team;
  readonly isBot: boolean;
  element: ElementId;

  /** Identity (GDD §8). Drives behaviour via `ROLE_BEHAVIOR`. */
  readonly role: Role;
  /** The card that paid for this unit, for snapshots and post-match stats. */
  readonly cardId: CardId | null;
  /** Per-unit, from the card — no longer the global MOVE_SPEED. */
  readonly moveSpeed: number;

  position: Vec2;
  facing: Vec2;
  /** Accelerated toward the input direction rather than snapped; read by the bot AI for aim leading. */
  velocity: Vec2;

  health: number;
  maxHealth: number;
  alive: boolean;
  lives: number;

  state: MageState;

  /** 0..1 */
  charge: number;
  charging: boolean;
  throwCooldown: number;
  recoveryTimer: number;

  stunTimer: number;
  knockbackVelocity: Vec2;

  slowFactor: number;
  slowTimer: number;

  immunityTimer: number;
  respawnTimer: number;

  /** Recomputed every tick from nearby friendly support auras (GDD §9). */
  chargeRateBonus: number;

  input: MageInput;
}

/** True once a mage is gone for the rest of the round (dead with no lives left). */
export function isOut(m: Mage): boolean {
  return !m.alive && m.lives <= 0;
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
 * A ground effect zone spawned by poison (GDD §8.5). It hurts everyone who
 * overlaps it, including its caster's team, by design.
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

