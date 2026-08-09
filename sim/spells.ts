/**
 * The spell catalog (GDD §9) — the only thing a player spends mana on since
 * the v1.1 pivot. A spell never creates a unit: it buffs an area of your own
 * squad or curses an area of the enemy's, choosing where to apply it (GDD
 * §5) — there is no deploy zone any more, a spell can land anywhere on the
 * arena.
 */

import { BALANCE } from './balance';

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

const CATALOG: Readonly<Record<SpellId, SpellCard>> = Object.fromEntries(
  Object.entries(BALANCE.spells).map(([id, s]) => [
    id,
    {
      id: id as SpellId,
      name: s.name,
      kind: s.kind as 'buff' | 'curse',
      cost: s.cost,
      radius: s.radius,
      duration: s.duration,
      effect: s.effect as SpellEffect,
    },
  ]),
) as Readonly<Record<SpellId, SpellCard>>;

/** Full catalog in GDD §9 display order. */
export const ALL_SPELLS: readonly SpellId[] = ['blessing', 'slow_curse', 'arcane_shield', 'plague'];

export function spellFor(id: string): SpellCard | undefined {
  return CATALOG[id as SpellId];
}

export function isSpellId(value: string): value is SpellId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}
