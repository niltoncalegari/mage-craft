/**
 * Spell riders: the things a card can do that are not "apply a status effect".
 *
 * The catalog is data (`spells.ts`), and most of a card is covered by
 * `effects.ts` — slow somebody, shield somebody, burn somebody. What is left
 * are the behaviours that touch the world itself: leaving a hazard on the
 * ground, moving a body, stripping what is already running. Those live here,
 * one entry per behaviour, so growing the catalog stays a `balance.json` edit
 * and only a genuinely new *kind* of behaviour costs code.
 *
 * This is the same split `World.applyOnHit` already makes for elements. The
 * difference is only that riders are registered rather than switched on, which
 * is what lets `spells.ts` validate a card at module load: a rider name that
 * is not in this table is a typo, and a typo that silently becomes a no-op is
 * the most expensive kind of bug in a data-driven catalog.
 */

import type { SpellApplyRule } from './balance';
import type { Mage, Team } from './entities';
import type { SpellCard } from './spells';
import type { Vec2 } from './Vec2';
import type { World } from './World';

/** What a rider is handed: the cast, and who it caught. */
export interface SpellRiderContext {
  readonly team: Team;
  readonly spell: SpellCard;
  readonly app: SpellApplyRule;
  readonly position: Vec2;
  /** Empty for a `ground` card, which affects a place rather than people. */
  readonly targets: readonly Mage[];
}

export type SpellRider = (w: World, ctx: SpellRiderContext) => void;

/**
 * Praga and its descendants (GDD §9): a hazard that hurts whoever overlaps it.
 *
 * Ground-targeted, so it ignores `targets` entirely — that is the point. A
 * zone is a bet on where the enemy will be, not on where they are.
 */
const puddle: SpellRider = (w, { spell, app, position }) => {
  w.spawnSpellPuddle(position, {
    spellId: spell.id,
    radius: app.radius ?? spell.radius,
    duration: app.duration ?? spell.duration,
    tickInterval: app.tickInterval ?? 1,
    tickDamage: app.tickDamage ?? 0,
    bypassShield: app.bypassShield ?? false,
  });
};

const RIDERS: Readonly<Record<string, SpellRider>> = { puddle };

export function isSpellRider(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RIDERS, name);
}

export function spellRiderFor(name: string): SpellRider | undefined {
  return RIDERS[name];
}
