/**
 * The three roles that define what a summoned mage *is* (GDD §8).
 *
 * This is the identity layer the product pivot introduced: a unit is a tank, a
 * damage dealer or a support, and the element it carries is merely the attack
 * it throws. The numbers here are what the bot AI reads to behave differently
 * per role (GDD §11) — they are behavioural, not combat stats (those come from
 * the card in `cards.ts` and the element in `elements.ts`).
 */

export type Role = 'tank' | 'damage' | 'support';

export interface RoleBehavior {
  /** Supports never throw; they win by multiplying whoever stands with them. */
  readonly attacks: boolean;
  /** How close the unit closes on its target before holding position. */
  readonly advanceStopDistance: number;
  /** Tanks walk past skirmishes and go for the structure — that's their job. */
  readonly prefersStructures: boolean;
  /** Supports escort the most advanced ally instead of seeking enemies. */
  readonly escorts: boolean;
  /** Tanks are meant to absorb, so they do not break off to take cover. */
  readonly seeksCover: boolean;
  /** Scales the retreat urge; a tank at low HP still does not run. */
  readonly retreatHealthFraction: number;
}

export const ROLE_BEHAVIOR: Readonly<Record<Role, RoleBehavior>> = {
  tank: {
    attacks: true,
    advanceStopDistance: 2.0,
    prefersStructures: true,
    escorts: false,
    seeksCover: false,
    retreatHealthFraction: 0,
  },
  damage: {
    attacks: true,
    advanceStopDistance: 6.5,
    prefersStructures: false,
    escorts: false,
    seeksCover: true,
    retreatHealthFraction: 0.3,
  },
  support: {
    attacks: false,
    advanceStopDistance: 4.0,
    prefersStructures: false,
    escorts: true,
    seeksCover: true,
    retreatHealthFraction: 0.45,
  },
};

export const ALL_ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(ROLE_BEHAVIOR, value);
}
