/**
 * The squad roster (GDD §9) — the mages a player picks before the match to
 * form their permanent 4-mage squad (GDD §7).
 *
 * These used to be the v1.0 unit *cards* (mana-cost, played mid-match to
 * summon a unit). Since the v1.1 pivot nothing is summoned: a squad is fixed
 * at match start and its mages respawn on death (GDD §4), so a roster entry
 * has no cost — the cost of picking one was the squad slot itself.
 */

import { BALANCE } from './balance';
import { ROLE_BEHAVIOR, type Role } from './roles';
import type { ElementId } from './elements';
import type { SpellId } from './spells';

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
   * The attack this mage throws — one element per roster entry, so a mage is
   * identifiable by the spell leaving its staff. Supports throw too, but weakly
   * and reluctantly (`ROLE_BEHAVIOR.attackUrge`): they still win fights by
   * multiplying whoever stands next to them, per GDD §8.
   */
  readonly element: ElementId;
  /**
   * The spells this mage may spend, in a stable order (plano v1.3 §3.1).
   *
   * The kit is what the player is really choosing when they field this mage:
   * the catalog is partitioned across the nine of them, so a squad is a hand of
   * abilities that happens to be carried by bodies. A mage that dies takes its
   * two or three off the board until it respawns.
   */
  readonly abilities: readonly SpellId[];
  /** Support only: heals the most-hurt ally in range, HP per second. */
  readonly healPerSecond?: number;
  readonly healRange?: number;
  /** Support only: multiplies allied charge rate inside the radius. */
  readonly auraChargeBonus?: number;
  readonly auraRadius?: number;
}

const CATALOG: Readonly<Record<RosterId, RosterEntry>> = Object.fromEntries(
  Object.entries(BALANCE.roster).map(([id, r]) => [
    id,
    {
      id: id as RosterId,
      name: r.name,
      role: r.role as Role,
      health: r.health,
      moveSpeed: r.moveSpeed,
      element: r.element as ElementId,
      abilities: r.abilities as readonly SpellId[],
      ...(r.healPerSecond !== undefined ? { healPerSecond: r.healPerSecond } : {}),
      ...(r.healRange !== undefined ? { healRange: r.healRange } : {}),
      ...(r.auraChargeBonus !== undefined ? { auraChargeBonus: r.auraChargeBonus } : {}),
      ...(r.auraRadius !== undefined ? { auraRadius: r.auraRadius } : {}),
    },
  ]),
) as Readonly<Record<RosterId, RosterEntry>>;

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

/**
 * The one mage that carries a spell, or undefined for an id no kit holds.
 *
 * Well-defined only because kits are disjoint and cover the whole catalog —
 * both asserted in `kits.test.ts`, and both load-bearing for the pivot. That is
 * what lets a per-team tally of spell ids be credited back to a body without a
 * second table to keep in step with this one.
 *
 * Built once at module load rather than searched per call: the post-match
 * summary walks every spell a side cast, and the catalog never changes shape.
 */
const OWNER_BY_SPELL: ReadonlyMap<SpellId, RosterId> = new Map(
  ALL_ROSTER.flatMap((id) => (CATALOG[id]?.abilities ?? []).map((s) => [s, id] as const)),
);

export function rosterOwnerOf(spellId: SpellId): RosterId | undefined {
  return OWNER_BY_SPELL.get(spellId);
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
