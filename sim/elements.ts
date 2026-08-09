/**
 * Element catalog for the authoritative simulation (GDD §8): the combat
 * numbers behind each of the 7 elemental projectiles.
 *
 * Every projectile runs the same pipeline — charge -> windup -> spawn ->
 * flight -> hit/expire — and only this data differs between elements. The
 * numbers live in `public/data/balance.json`; this module is the typed view of
 * the `elements` block.
 *
 * The client's `src/game/elements.ts` holds the *presentation* half of the
 * same catalog (display name, role blurb, UI accent colour); the two are
 * joined by `ElementId`, and `elements.test.ts` asserts the two lists agree.
 */

import { BALANCE, type OnHitRule } from './balance';

export type ElementId =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'stone'
  | 'arcane'
  | 'wind'
  | 'holy'
  | 'sonic';

export interface ElementDef {
  readonly id: ElementId;
  readonly name: string;

  /** Flight — speed is charge-scaled between minSpeed and projectileSpeed. */
  readonly minSpeed: number;
  readonly projectileSpeed: number;
  readonly launchArc: number;
  readonly gravity: number;
  readonly radius: number;

  /** On-hit baseline. */
  readonly damage: number;
  readonly knockback: number;

  /** Arcane / holy: small on-impact AoE (GDD §8.7). */
  readonly splashRadius?: number;

  /** Wind, stone: extra knockback on top of the projectile's own (GDD §8.7). */
  readonly knockbackBonus?: number;

  /**
   * What this element does to the mage it hits, beyond damage and knockback.
   * A list rather than a set of optional flags: an element may carry several
   * riders (sonic slows the legs *and* the casting), and a new one is a JSON
   * edit rather than a new field plumbed through six files.
   */
  readonly onHit: readonly OnHitRule[];
}

const CATALOG: Readonly<Record<ElementId, ElementDef>> = Object.fromEntries(
  Object.entries(BALANCE.elements).map(([id, e]) => [
    id,
    {
      id: id as ElementId,
      name: e.name,
      minSpeed: e.flight.minSpeed,
      projectileSpeed: e.flight.projectileSpeed,
      launchArc: e.flight.launchArc,
      gravity: e.flight.gravity,
      radius: e.flight.radius,
      damage: e.damage,
      knockback: e.knockback,
      ...(e.splashRadius !== undefined ? { splashRadius: e.splashRadius } : {}),
      ...(e.knockbackBonus !== undefined ? { knockbackBonus: e.knockbackBonus } : {}),
      onHit: e.onHit ?? [],
    },
  ]),
) as Readonly<Record<ElementId, ElementDef>>;

/**
 * Full catalog in GDD §8.1 display order, including the two support attacks.
 */
export const ALL_ELEMENTS: readonly ElementId[] = [
  'fire',
  'ice',
  'lightning',
  'poison',
  'stone',
  'arcane',
  'wind',
  'holy',
  'sonic',
];

/**
 * The elements a lobby seat may be assigned (GDD §7). `holy` and `sonic` are
 * *class* attacks — they belong to the Cleric and the Bard and arrive with the
 * squad, so auto-filling a bot seat with one would hand a Pyromancer a
 * support's spell. All 7 offensive elements stay pickable, which still leaves a
 * team of up to 6 mages a free one.
 */
export const PICKABLE_ELEMENTS: readonly ElementId[] = [
  'fire',
  'ice',
  'lightning',
  'poison',
  'stone',
  'arcane',
  'wind',
];

/** Whether a lobby seat may select this element (see {@link PICKABLE_ELEMENTS}). */
export function isPickableElement(value: string): value is ElementId {
  return (PICKABLE_ELEMENTS as readonly string[]).includes(value);
}

export function elementDefFor(id: ElementId): ElementDef | undefined {
  return CATALOG[id];
}

export function isElementId(value: string): value is ElementId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}

/** The first rider of a given kind, or undefined — the applier's lookup helper. */
export function onHitRule(def: ElementDef, effect: string): OnHitRule | undefined {
  return def.onHit.find((r) => r.effect === effect);
}
