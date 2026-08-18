/**
 * How a target selector reads in Portuguese.
 *
 * The vocabulary is defined in `sim/abilityPolicy.ts` as identifiers, and an
 * identifier is not something to put in front of a player: `deepest_intruder`
 * is a selector, "o intruso mais fundo" is where the spell went.
 *
 * This used to be the whole phrasebook of the authored program — keywords,
 * comparators, fact labels, numeric field specs — because a rule editor had to
 * offer every word a player could write. v1.3 retired the editor along with the
 * program, and the one place a selector still faces a player is the match HUD's
 * line for the ability that just fired. So only the selectors survive; the rest
 * was vocabulary for a screen that no longer exists.
 */

import type { TargetSelector } from '../../sim/abilityPolicy';

/** Where an ability aimed, in the words the HUD shows the player. */
export const SELECTOR_LABEL: Readonly<Record<TargetSelector, string>> = {
  enemy_cluster: 'aglomerado inimigo',
  ally_cluster: 'aglomerado aliado',
  deepest_intruder: 'intruso mais fundo',
  weakest_ally: 'aliado mais ferido',
  strongest_enemy: 'inimigo mais forte',
  ally_frontline: 'linha de frente aliada',
  enemy_frontline: 'linha de frente inimiga',
  our_core: 'nosso núcleo',
  enemy_core: 'núcleo inimigo',
  our_objective: 'nosso objetivo',
  squad_rally: 'ponto de reunião',
};

/**
 * The label for a selector that arrived over the wire.
 *
 * Typed `string` rather than `TargetSelector` on purpose: this reads a wire
 * field, and a server one version ahead may well name a selector this build has
 * never heard of. Showing the raw identifier then is the honest fallback — it
 * still tells the player where the ability went, just less prettily.
 */
export function selectorLabel(at: string): string {
  return SELECTOR_LABEL[at as TargetSelector] ?? at;
}
