/**
 * Squad construction rules (GDD §7).
 *
 * The mirror of `validateDeck` for the other half of a loadout, and the
 * asymmetry between the two is the design: a deck *wants* duplicates (with
 * only 4 spells designed, a legal deck is each one twice), while a squad
 * forbids them — four copies of the same mage is not a composition, it is one
 * mage with four health bars. The role floor exists for the same reason: the
 * sim gives tanks, damage and support genuinely different behaviour
 * (`ROLE_BEHAVIOR`), so a squad missing a role is missing a mechanic.
 */

import { isRosterId, rosterFor, type RosterId } from './cards';
import { SQUAD_SIZE } from './config';
import type { Role } from './roles';

export type SquadValidation = { ok: true } | { ok: false; reason: string };

const REQUIRED_ROLES: readonly Role[] = ['tank', 'damage', 'support'];

/** Enforces the GDD §7 construction rules before a squad is allowed into a match. */
export function validateSquad(ids: readonly string[]): SquadValidation {
  if (ids.length !== SQUAD_SIZE) {
    return { ok: false, reason: `squad must hold ${SQUAD_SIZE} mages, got ${ids.length}` };
  }

  const seen = new Set<string>();
  const roles = new Set<Role>();
  for (const id of ids) {
    if (!isRosterId(id)) return { ok: false, reason: `unknown mage ${JSON.stringify(id)}` };
    if (seen.has(id)) return { ok: false, reason: `duplicate mage ${JSON.stringify(id)}` };
    seen.add(id);
    // isRosterId narrowed the type, so the catalog lookup cannot miss.
    roles.add(rosterFor(id as RosterId)!.role);
  }

  for (const role of REQUIRED_ROLES) {
    if (!roles.has(role)) return { ok: false, reason: `squad needs at least one ${role}` };
  }

  return { ok: true };
}

/** Every mage, for the squad builder UI. */
export { ALL_ROSTER as SQUAD_POOL } from './cards';
