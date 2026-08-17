/**
 * The spell catalog (GDD §9) — the only thing a player spends mana on since
 * the v1.1 pivot. A spell never creates a unit: it buffs an area of your own
 * squad or curses an area of the enemy's, at any point on the arena (GDD §5).
 *
 * A card is **data**. It names who it catches (`target`) and a list of things
 * it does to them (`apply`), each naming either a status kind from
 * `effects.ts` or a rider from `spellRiders.ts`. That is deliberately the same
 * shape elements already use for `onHit`, so there is one idiom to learn — and
 * it is what keeps a 25-card catalog from becoming a 25-case switch.
 *
 * The catalog is validated eagerly, at module load, and throws on a bad card.
 * With cards authored by hand in JSON, a typo that silently becomes a no-op is
 * a guaranteed bug and an expensive one to find: the card just quietly does
 * nothing in a match nobody is watching closely.
 */

import { BALANCE, type SpellApplyRule } from './balance';
import { isEffectKind } from './effects';
import { isSpellRider } from './spellRiders';

export type SpellId =
  | 'blessing'
  | 'slow_curse'
  | 'arcane_shield'
  | 'plague'
  | 'sticky_swamp'
  | 'entangling_roots'
  | 'rejuvenating_breeze'
  | 'consecrated_ground'
  | 'blood_frenzy'
  | 'executioners_mark'
  | 'petrify'
  | 'thunderstrike'
  | 'null_flash'
  | 'volcanic_eruption'
  | 'dark_tribute'
  | 'call_to_battle'
  | 'mana_flow'
  | 'bond_of_pain'
  | 'bond_of_solidarity'
  | 'overload_field'
  | 'meteor_shower';

/**
 * The wire-level name for "the thing a cast message names" — kept distinct
 * from `SpellId` only in spirit; every card the mana economy knows about
 * since the pivot is a spell (GDD §7).
 */
export type CardId = SpellId;

/** The five decks of GDD §9. Colour is identity and a deck-building constraint. */
export type DeckColor = 'red' | 'blue' | 'green' | 'white' | 'black';

export const ALL_DECK_COLORS: readonly DeckColor[] = ['red', 'blue', 'green', 'white', 'black'];

/**
 * Who an application lands on. `ground` leaves a hazard behind instead of
 * touching anyone, so it catches whoever walks in later.
 */
export type SpellTarget = 'allies' | 'enemies' | 'all' | 'ground';

const ALL_TARGETS: readonly SpellTarget[] = ['allies', 'enemies', 'all', 'ground'];

export type SpellApplication = SpellApplyRule;

export interface SpellCard {
  readonly id: SpellId;
  readonly name: string;
  readonly color: DeckColor;
  /** Display and bot ranking only; the applier reads `target`, not this. */
  readonly kind: 'buff' | 'curse';
  readonly cost: number;
  readonly radius: number;
  readonly duration: number;
  readonly target: SpellTarget;
  readonly apply: readonly SpellApplication[];
}

/** Full catalog, grouped by deck colour (GDD §9 display order). */
export const ALL_SPELLS: readonly SpellId[] = [
  'overload_field',
  'meteor_shower',
  'volcanic_eruption',
  'blood_frenzy',
  'executioners_mark',
  'petrify',
  'thunderstrike',
  'null_flash',
  'mana_flow',
  'plague',
  'sticky_swamp',
  'entangling_roots',
  'rejuvenating_breeze',
  'blessing',
  'arcane_shield',
  'consecrated_ground',
  'call_to_battle',
  'bond_of_solidarity',
  'slow_curse',
  'dark_tribute',
  'bond_of_pain',
];

function build(): Readonly<Record<SpellId, SpellCard>> {
  const out = {} as Record<SpellId, SpellCard>;

  for (const [id, s] of Object.entries(BALANCE.spells)) {
    const where = `spell ${JSON.stringify(id)}`;

    if (!ALL_DECK_COLORS.includes(s.color as DeckColor)) {
      throw new Error(`${where}: unknown deck colour ${JSON.stringify(s.color)}`);
    }
    if (s.kind !== 'buff' && s.kind !== 'curse') {
      throw new Error(`${where}: kind must be buff or curse, got ${JSON.stringify(s.kind)}`);
    }
    if (!ALL_TARGETS.includes(s.target as SpellTarget)) {
      throw new Error(`${where}: unknown target ${JSON.stringify(s.target)}`);
    }
    for (const [field, value] of [
      ['cost', s.cost],
      ['radius', s.radius],
      ['duration', s.duration],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${where}: ${field} must be a positive number, got ${String(value)}`);
      }
    }
    if (!Array.isArray(s.apply) || s.apply.length === 0) {
      throw new Error(`${where}: needs at least one application, or it does nothing`);
    }
    for (const app of s.apply) {
      if (!isEffectKind(app.effect) && !isSpellRider(app.effect)) {
        throw new Error(`${where}: ${JSON.stringify(app.effect)} is neither a status effect nor a rider`);
      }
    }

    out[id as SpellId] = {
      id: id as SpellId,
      name: s.name,
      color: s.color as DeckColor,
      kind: s.kind,
      cost: s.cost,
      radius: s.radius,
      duration: s.duration,
      target: s.target as SpellTarget,
      apply: s.apply,
    };
  }

  for (const id of ALL_SPELLS) {
    if (!out[id]) throw new Error(`spell ${JSON.stringify(id)} is listed in ALL_SPELLS but missing from balance.json`);
  }

  return out;
}

const CATALOG = build();

export function spellFor(id: string): SpellCard | undefined {
  return CATALOG[id as SpellId];
}

export function isSpellId(value: string): value is SpellId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}

/** The catalog grouped for the deck and strategy builders. */
export const SPELLS_BY_COLOR: Readonly<Record<DeckColor, readonly SpellId[]>> = Object.freeze(
  ALL_DECK_COLORS.reduce(
    (acc, color) => {
      acc[color] = ALL_SPELLS.filter((id) => CATALOG[id].color === color);
      return acc;
    },
    {} as Record<DeckColor, readonly SpellId[]>,
  ),
);

/** The colours a deck draws from, for the deck-building rule (GDD §7). */
export function colorsOf(cards: readonly string[]): Set<DeckColor> {
  const colors = new Set<DeckColor>();
  for (const id of cards) {
    const card = spellFor(id);
    if (card) colors.add(card.color);
  }
  return colors;
}
