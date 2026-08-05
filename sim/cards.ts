/**
 * The card catalog (GDD §9) — what a player can spend mana on.
 *
 * A card is the *summon*; the mage it produces is defined by its **role**
 * (GDD §8), and the role is the identity. The element attached to a unit is
 * only the attack it throws, and its numbers live in `elements.ts` — that
 * catalog is deliberately untouched by this file.
 *
 * v1 ships units only. The four spells of GDD §9 arrive with the generic
 * status-effect system (GDD §13, step 7).
 */

import { ROLE_BEHAVIOR, type Role } from './roles';
import type { ElementId } from './elements';

export type CardId =
  | 'stone_golem'
  | 'ice_sentinel'
  | 'pyromancer'
  | 'stormcaller'
  | 'arcane_archer'
  | 'alchemist'
  | 'wind_dervish'
  | 'cleric'
  | 'arcane_bard';

export interface UnitCard {
  readonly kind: 'unit';
  readonly id: CardId;
  readonly name: string;
  readonly role: Role;
  /** Mana cost (GDD §6: 2..7). */
  readonly cost: number;
  readonly health: number;
  readonly moveSpeed: number;
  /**
   * The attack this unit throws. Supports carry an element that is never fired
   * (their `ROLE_BEHAVIOR.attacks` is false) — they win fights by multiplying
   * whoever stands next to them, per GDD §8.
   */
  readonly element: ElementId;
  /** Support only: heals the most-hurt ally in range, HP per second. */
  readonly healPerSecond?: number;
  readonly healRange?: number;
  /** Support only: multiplies allied charge rate inside the radius. */
  readonly auraChargeBonus?: number;
  readonly auraRadius?: number;
}

export type Card = UnitCard;

const CATALOG: Readonly<Record<CardId, UnitCard>> = {
  stone_golem: {
    kind: 'unit',
    id: 'stone_golem',
    name: 'Golem de Pedra',
    role: 'tank',
    cost: 5,
    health: 280,
    moveSpeed: 3.5,
    element: 'stone',
  },
  ice_sentinel: {
    kind: 'unit',
    id: 'ice_sentinel',
    name: 'Sentinela de Gelo',
    role: 'tank',
    cost: 4,
    health: 200,
    moveSpeed: 4.0,
    element: 'ice',
  },
  pyromancer: {
    kind: 'unit',
    id: 'pyromancer',
    name: 'Piromante',
    role: 'damage',
    cost: 4,
    health: 80,
    moveSpeed: 5.0,
    element: 'fire',
  },
  stormcaller: {
    kind: 'unit',
    id: 'stormcaller',
    name: 'Condutor de Raio',
    role: 'damage',
    cost: 4,
    health: 60,
    moveSpeed: 5.0,
    element: 'lightning',
  },
  arcane_archer: {
    kind: 'unit',
    id: 'arcane_archer',
    name: 'Arqueiro Arcano',
    role: 'damage',
    cost: 3,
    health: 70,
    moveSpeed: 5.5,
    element: 'arcane',
  },
  alchemist: {
    kind: 'unit',
    id: 'alchemist',
    name: 'Alquimista',
    role: 'damage',
    cost: 4,
    health: 70,
    moveSpeed: 5.0,
    element: 'poison',
  },
  wind_dervish: {
    kind: 'unit',
    id: 'wind_dervish',
    name: 'Dervixe do Vento',
    role: 'damage',
    cost: 3,
    health: 65,
    moveSpeed: 7.0,
    element: 'wind',
  },
  cleric: {
    kind: 'unit',
    id: 'cleric',
    name: 'Clérigo',
    role: 'support',
    cost: 4,
    health: 95,
    moveSpeed: 5.0,
    element: 'arcane',
    healPerSecond: 8,
    healRange: 5,
  },
  arcane_bard: {
    kind: 'unit',
    id: 'arcane_bard',
    name: 'Bardo Arcano',
    role: 'support',
    cost: 3,
    health: 70,
    moveSpeed: 5.0,
    element: 'arcane',
    auraChargeBonus: 0.25,
    auraRadius: 4,
  },
};

/** Full catalog in GDD §9 display order. */
export const ALL_CARDS: readonly CardId[] = [
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

export function cardFor(id: CardId): UnitCard | undefined {
  return CATALOG[id];
}

export function isCardId(value: string): value is CardId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}

/** Convenience for the bot and for tests: does this card's role ever attack? */
export function cardAttacks(card: UnitCard): boolean {
  return ROLE_BEHAVIOR[card.role].attacks;
}
