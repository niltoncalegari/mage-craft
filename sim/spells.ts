/**
 * The spell catalog (GDD §9) — the only thing a player spends mana on since
 * the v1.1 pivot. A spell never creates a unit: it buffs an area of your own
 * squad or curses an area of the enemy's, choosing where to apply it (GDD
 * §5) — there is no deploy zone any more, a spell can land anywhere on the
 * arena.
 */

import {
  BLESSING_CAST_BONUS,
  BLESSING_COST,
  BLESSING_DURATION,
  BLESSING_RADIUS,
  BLESSING_SPEED_BONUS,
  PLAGUE_COST,
  PLAGUE_DURATION,
  PLAGUE_RADIUS,
  PLAGUE_TICK_DAMAGE,
  PLAGUE_TICK_INTERVAL,
  SHIELD_AMOUNT,
  SHIELD_COST,
  SHIELD_DURATION,
  SHIELD_RADIUS,
  SLOW_CURSE_COST,
  SLOW_CURSE_DURATION,
  SLOW_CURSE_FACTOR,
  SLOW_CURSE_RADIUS,
} from './config';

export type SpellId = 'blessing' | 'slow_curse' | 'arcane_shield' | 'plague';

/**
 * The wire-level name for "the thing a cast message names" — kept distinct
 * from `SpellId` only in spirit; every card the mana economy knows about
 * since the pivot is a spell (GDD §7).
 */
export type CardId = SpellId;

export type SpellEffect =
  | { readonly kind: 'buff_haste'; readonly speedFactor: number; readonly castFactor: number }
  | { readonly kind: 'curse_slow'; readonly slowFactor: number }
  | { readonly kind: 'buff_shield'; readonly amount: number }
  | { readonly kind: 'curse_zone'; readonly tickDamage: number; readonly tickInterval: number };

export interface SpellCard {
  readonly id: SpellId;
  readonly name: string;
  /** Buffs land on your own squad in range; curses land on the enemy's. */
  readonly kind: 'buff' | 'curse';
  readonly cost: number;
  readonly radius: number;
  readonly duration: number;
  readonly effect: SpellEffect;
}

const CATALOG: Readonly<Record<SpellId, SpellCard>> = {
  blessing: {
    id: 'blessing',
    name: 'Bênção de Ímpeto',
    kind: 'buff',
    cost: BLESSING_COST,
    radius: BLESSING_RADIUS,
    duration: BLESSING_DURATION,
    effect: {
      kind: 'buff_haste',
      speedFactor: BLESSING_SPEED_BONUS,
      castFactor: BLESSING_CAST_BONUS,
    },
  },
  slow_curse: {
    id: 'slow_curse',
    name: 'Maldição da Lentidão',
    kind: 'curse',
    cost: SLOW_CURSE_COST,
    radius: SLOW_CURSE_RADIUS,
    duration: SLOW_CURSE_DURATION,
    effect: { kind: 'curse_slow', slowFactor: SLOW_CURSE_FACTOR },
  },
  arcane_shield: {
    id: 'arcane_shield',
    name: 'Escudo Arcano',
    kind: 'buff',
    cost: SHIELD_COST,
    radius: SHIELD_RADIUS,
    duration: SHIELD_DURATION,
    effect: { kind: 'buff_shield', amount: SHIELD_AMOUNT },
  },
  plague: {
    id: 'plague',
    name: 'Praga',
    kind: 'curse',
    cost: PLAGUE_COST,
    radius: PLAGUE_RADIUS,
    duration: PLAGUE_DURATION,
    effect: { kind: 'curse_zone', tickDamage: PLAGUE_TICK_DAMAGE, tickInterval: PLAGUE_TICK_INTERVAL },
  },
};

/** Full catalog in GDD §9 display order. */
export const ALL_SPELLS: readonly SpellId[] = ['blessing', 'slow_curse', 'arcane_shield', 'plague'];

export function spellFor(id: string): SpellCard | undefined {
  return CATALOG[id as SpellId];
}

export function isSpellId(value: string): value is SpellId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}
