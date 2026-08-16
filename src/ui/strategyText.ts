/**
 * How a strategy program reads in Portuguese.
 *
 * The program's vocabulary is defined in `sim/strategy.ts` as identifiers, and
 * an identifier is not something to put in front of a player: `deepest_intruder`
 * is a target selector, "o intruso mais fundo" is where the spell went. Kept
 * apart from both the simulation and any one screen because the same words have
 * to appear in the match HUD's trace and in the editor that writes them.
 */

import type { TargetSelector } from '../../sim/strategy';

/** Where a rule aimed, in the words the editor offers the player. */
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
 * still tells the player which rule aimed where, just less prettily.
 */
export function selectorLabel(at: string): string {
  return SELECTOR_LABEL[at as TargetSelector] ?? at;
}
