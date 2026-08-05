/**
 * Element catalog for the authoritative simulation (GDD §8): the combat
 * numbers behind each of the 7 elemental projectiles.
 *
 * Every projectile runs the same pipeline — charge -> windup -> spawn ->
 * flight -> hit/expire — and only this data differs between elements.
 *
 * The client's `src/game/elements.ts` holds the *presentation* half of the
 * same catalog (display name, role blurb, UI accent colour); the two are
 * joined by `ElementId`, and `elements.test.ts` asserts the two lists agree.
 */

export type ElementId = 'fire' | 'ice' | 'lightning' | 'poison' | 'stone' | 'arcane' | 'wind';

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

  /** Ice: soft crowd control (GDD §8.3). */
  readonly slowFactor?: number;
  readonly slowDuration?: number;

  /** Stone: heavy hit that cancels the target's charge (GDD §8.6). */
  readonly interruptsCharge?: boolean;

  /** Arcane: small on-impact AoE (GDD §8.7). */
  readonly splashRadius?: number;

  /** Wind: extra knockback, minimal damage (GDD §8.7). */
  readonly knockbackBonus?: number;

  /** Poison: spawns a damaging ground puddle on hit or expiry (GDD §8.5). */
  readonly spawnsPuddle?: boolean;
  readonly puddleRadius?: number;
  readonly puddleDuration?: number;
  readonly puddleTickInterval?: number;
  readonly puddleTickDamage?: number;
}

const CATALOG: Readonly<Record<ElementId, ElementDef>> = {
  fire: {
    id: 'fire',
    name: 'Bola de fogo',
    minSpeed: 8,
    projectileSpeed: 20,
    launchArc: 4.5,
    gravity: 18,
    radius: 0.22,
    damage: 20,
    knockback: 3.5,
  },
  ice: {
    id: 'ice',
    name: 'Fragmento de gelo',
    minSpeed: 7,
    projectileSpeed: 17,
    launchArc: 4.2,
    gravity: 18,
    radius: 0.22,
    damage: 14,
    knockback: 2.5,
    slowFactor: 0.35,
    slowDuration: 1.25,
  },
  lightning: {
    id: 'lightning',
    name: 'Raio',
    minSpeed: 14,
    projectileSpeed: 30,
    launchArc: 1.5,
    gravity: 10,
    radius: 0.2,
    damage: 18,
    knockback: 1.5,
  },
  poison: {
    id: 'poison',
    name: 'Frasco de veneno',
    minSpeed: 8,
    projectileSpeed: 18,
    launchArc: 4.0,
    gravity: 18,
    radius: 0.24,
    damage: 8,
    knockback: 1.0,
    spawnsPuddle: true,
    puddleRadius: 1.5,
    puddleDuration: 4.0,
    puddleTickInterval: 0.3,
    puddleTickDamage: 6,
  },
  stone: {
    id: 'stone',
    name: 'Projétil de pedra',
    minSpeed: 5,
    projectileSpeed: 13,
    launchArc: 5.5,
    gravity: 18,
    radius: 0.3,
    damage: 32,
    knockback: 6.0,
    interruptsCharge: true,
  },
  arcane: {
    id: 'arcane',
    name: 'Orbe arcano',
    minSpeed: 8,
    projectileSpeed: 19,
    launchArc: 4.3,
    gravity: 18,
    radius: 0.24,
    damage: 20,
    knockback: 3.0,
    splashRadius: 2.0,
  },
  wind: {
    id: 'wind',
    name: 'Lâmina de vento',
    minSpeed: 10,
    projectileSpeed: 22,
    launchArc: 3.0,
    gravity: 14,
    radius: 0.2,
    damage: 6,
    knockback: 4.0,
    knockbackBonus: 4.5,
  },
};

/**
 * Full catalog in GDD §8.1 display order. Room selection (GDD §7) uses all 7 so
 * a team of up to 6 mages always has a free element left to pick.
 */
export const ALL_ELEMENTS: readonly ElementId[] = [
  'fire',
  'ice',
  'lightning',
  'poison',
  'stone',
  'arcane',
  'wind',
];

export function elementDefFor(id: ElementId): ElementDef | undefined {
  return CATALOG[id];
}

export function isElementId(value: string): value is ElementId {
  return Object.prototype.hasOwnProperty.call(CATALOG, value);
}
