/**
 * Canonical iteration order for the simulation's entity maps.
 *
 * `World.mages` and `World.structures` are `Map`s, so iterating them follows
 * insertion order — and respawn reinserts, which means insertion order is a
 * function of match history rather than of the world's state. Anything that
 * picks "the best one" out of a scan therefore has to break ties on something
 * stable, or two runs of the same match can pick different mages and diverge.
 *
 * Sorting by id is that stable thing.
 */
export function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
