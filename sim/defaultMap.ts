/**
 * The map online matches are played on.
 *
 * This is a direct import of the *client's* map file — the one served at
 * `public/maps/arena1.json` and fetched by `src/net/OnlineMatch.ts`. The Go
 * server could not do this (`go:embed` cannot reach outside its package
 * directory), so it kept a second copy under `server/internal/game/maps/` plus
 * a test whose only job was to fail when the two drifted. Both are gone: there
 * is one file, and the bundler inlines it at build time.
 */

import arena1 from '../public/maps/arena1.json';
import siege1 from '../public/maps/siege1.json';
import { Arena, type MapData } from './Arena';

/**
 * The siege map is the one the game is played on since the pivot (GDD §5): it
 * carries a Core and two Towers per side. `arena1` predates structures and is
 * kept because the frozen practice mode and the Arena parity tests still use it.
 */
export const DEFAULT_MAP_NAME = 'siege1.json';
export const LEGACY_MAP_NAME = 'arena1.json';

let cached: Arena | null = null;
let cachedLegacy: Arena | null = null;

/** The default arena, parsed once and shared (an Arena is immutable in practice). */
export function defaultArena(): Arena {
  cached ??= Arena.parse(siege1 as MapData);
  return cached;
}

/** The structure-less arena of the pre-pivot game; see DEFAULT_MAP_NAME. */
export function legacyArena(): Arena {
  cachedLegacy ??= Arena.parse(arena1 as MapData);
  return cachedLegacy;
}
