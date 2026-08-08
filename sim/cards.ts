/**
 * The squad roster (GDD §9) — the mages a player picks before the match to
 * form their permanent 4-mage squad (GDD §7).
 *
 * These used to be the v1.0 unit *cards* (mana-cost, played mid-match to
 * summon a unit). Since the v1.1 pivot nothing is summoned: a squad is fixed
 * at match start and its mages respawn on death (GDD §4), so a roster entry
 * has no cost — the cost of picking one was the squad slot itself.
 */

import { ROLE_BEHAVIOR, type Role } from './roles';
import type { ElementId } from './elements';

export type RosterId =
  | 'stone_golem'
  | 'ice_sentinel'
  | 'pyromancer'
  | 'stormcaller'
  | 'arcane_archer'
  | 'alchemist'
  | 'wind_dervish'
  | 'cleric'
  | 'arcane_bard';

export interface RosterEntry {
  readonly id: RosterId;
  readonly name: string;
  readonly role: Role;
  readonly health: number;
  readonly moveSpeed: number;
  /**
   * The attack this mage throws. Supports carry an element that is never
   * fired (their `ROLE_BEHAVIOR.attacks` is false) — they win fights by
   * multiplying whoever stands next to them, per GDD §8.
   */
  readonly element: ElementId;
  /** Support only: heals the most-hurt ally in range, HP per second. */
  readonly healPerSecond?: number;
  readonly healRange?: number;
  /** Support only: multiplies allied charge rate inside the radius. */
  readonly auraChargeBonus?: number;
  readonly auraRadius?: number;
}

const CATALOG: Readonly<Record<RosterId, RosterEntry>> = {
  stone_golem: {
    id: 'stone_golem',
    name: 'Stone Golem',
    role: 'tank',
    health: 280,
    moveSpeed: 3.5,
    element: 'stone',
  },
  ice_sentinel: {
    id: 'ice_sentinel',
    name: 'Ice Sentinel',
    role: 'tank',
    health: 200,
    moveSpeed: 4.0,
    element: 'ice',
  },
  pyromancer: {
    id: 'pyromancer',
    name: 'Pyromancer',
    role: 'damage',
    health: 80,
    moveSpeed: 5.0,
    element: 'fire',
  },
  stormcaller: {
    id: 'stormcaller',
    name: 'Stormcaller',
    role: 'damage',
    health: 60,
    moveSpeed: 5.0,
    element: 'lightning',
  },
  arcane_archer: {
    id: 'arcane_archer',
    name: 'Arcane Archer',
    role: 'damage',
    health: 70,
    moveSpeed: 5.5,
    element: 'arcane',
  },
  alchemist: {
    id: 'alchemist',
    name: 'Alchemist',
    role: 'damage',
    health: 70,
    moveSpeed: 5.0,
    element: 'poison',
  },
  wind_dervish: {
    id: 'wind_dervish',
    name: 'Wind Dervish',
    role: 'damage',
    health: 65,
    moveSpeed: 7.0,
    element: 'wind',
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    role: 'support',
    health: 95,
    moveSpeed: 5.0,
    element: 'arcane',
    healPerSecond: 8,
    healRange: 5,
  },
  arcane_bard: {
    id: 'arcane_bard',
    name: 'Arcane Bard',
    role: 'support',
    health: 70,
    moveSpeed: 5.0,
    element: 'arcane',
    auraChargeBonus: 0.25,
    auraRadius: 4,
  },
};

/** Full catalog in GDD §9 display order. */
export const ALL_ROSTER: readonly RosterId[] = [
  'stone_golem',
  'ice_sentinel',
  'pyromancer',
  'stormcaller',
  'arcane_archer',
  'alchemist',
  'wind_dervish',
  'cleric',
  'arcane_bard',
];

export function rosterFor(id: RosterId): RosterEntry | undefined {
  return CATALOG[id];
}

export function isRosterId(value: string): value is RosterId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}

/** Convenience for the bot AI: does this roster entry's role ever attack? */
export function rosterAttacks(entry: RosterEntry): boolean {
  return ROLE_BEHAVIOR[entry.role].attacks;
}

/**
 * A playable default squad (GDD §7) for a player who never opened a squad
 * builder — one tank, two damage, one support, matching the construction
 * rule ("at least one of each role"). There is no squad-builder UI yet
 * (GDD §16), so every match uses this until there is one.
 */
export function defaultSquad(): RosterId[] {
  return ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'];
}
