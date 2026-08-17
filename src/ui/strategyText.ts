/**
 * How a strategy program reads in Portuguese.
 *
 * The program's vocabulary is defined in `sim/strategy.ts` as identifiers, and
 * an identifier is not something to put in front of a player: `deepest_intruder`
 * is a target selector, "o intruso mais fundo" is where the spell went. Kept
 * apart from both the simulation and any one screen because the same words have
 * to appear in the match HUD's trace and in the editor that writes them.
 */

import { EFFECT_ORDER, type EffectKind } from '../../sim/effects';
import type { Posture } from '../../sim/bot/Squad';
import type { Comparator, NumericConditionKind, TargetSelector } from '../../sim/strategy';

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

/* ---- The words a rule is written with -------------------------------------- */

/**
 * The keywords of the program, kept together because they are one voice.
 *
 * A rule reads as a sentence — *se* something, *então* this card, *em* that
 * place — and the editor sets these three in the display face so they carry
 * like keywords in a listing rather than like field labels. `SENAO` is the
 * fallthrough between rules: the one word that says the list is a priority
 * order and not a set.
 */
export const KEYWORD = {
  IF: 'SE',
  THEN: 'ENTÃO',
  AT: 'EM',
  ELSE: 'senão',
  NOT: 'não',
  ALL: 'E',
  ANY: 'OU',
} as const;

/**
 * A condition the editor offers directly, as opposed to the two that only
 * shape others: `not` is a modifier drawn as a toggle, and `all`/`any` are the
 * group the row itself becomes. Neither belongs in a list of facts to pick.
 *
 * The order is the order of the picker, grouped from "no question asked"
 * through the squad, the enemy, the siege and the clock.
 */
export type FactKind =
  | 'always'
  | 'intruder'
  | 'sudden_death'
  | 'posture'
  | 'ally_has_effect'
  | 'enemy_has_effect'
  | NumericConditionKind;

export const FACT_ORDER: readonly FactKind[] = [
  'always',
  'mana',
  'ally_count',
  'ally_health',
  'ally_cluster',
  'ally_has_effect',
  'enemy_count',
  'enemy_health',
  'enemy_cluster',
  'enemy_has_effect',
  'intruder',
  'posture',
  'our_core',
  'our_towers',
  'enemy_core',
  'enemy_towers',
  'elapsed',
  'sudden_death',
];

/**
 * What each fact asks, phrased so the row still reads as a sentence after the
 * comparator and the number are appended: "vida do aliado mais ferido ≤ 60%".
 */
export const FACT_LABEL: Readonly<Record<FactKind, string>> = {
  always: 'sempre',
  intruder: 'há intruso na nossa metade',
  sudden_death: 'morte súbita',
  posture: 'postura do esquadrão',
  ally_has_effect: 'aliado sob efeito',
  enemy_has_effect: 'inimigo sob efeito',
  mana: 'mana',
  elapsed: 'tempo de partida',
  ally_count: 'aliados vivos',
  enemy_count: 'inimigos vivos',
  ally_health: 'vida do aliado mais ferido',
  enemy_health: 'vida do inimigo mais ferido',
  ally_cluster: 'aglomerado aliado',
  enemy_cluster: 'aglomerado inimigo',
  our_core: 'vida do nosso núcleo',
  enemy_core: 'vida do núcleo inimigo',
  our_towers: 'nossas torres de pé',
  enemy_towers: 'torres inimigas de pé',
};

/**
 * Symbols rather than words. `mana ≥ 5` is read the same in every language a
 * player of this game brings, and it keeps the row short enough to stay one
 * line on a phone held landscape.
 */
export const COMPARATOR_LABEL: Readonly<Record<Comparator, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
};

export const ALL_COMPARATORS: readonly Comparator[] = ['lt', 'lte', 'gt', 'gte', 'eq'];

/** What the squad plan is currently trying to do (`sim/bot/Squad.ts`). */
export const POSTURE_LABEL: Readonly<Record<Posture, string>> = {
  push: 'avançar',
  defend: 'defender',
  regroup: 'reagrupar',
};

/** Status effects, as the arena shows them rather than as `effects.ts` names them. */
export const EFFECT_LABEL: Readonly<Record<EffectKind, string>> = {
  slow: 'lentidão',
  haste: 'ímpeto',
  cast_slow: 'conjuração lenta',
  cast_haste: 'conjuração rápida',
  burn: 'queimadura',
  vulnerable: 'vulnerável',
  shield: 'escudo',
  stun: 'atordoamento',
  root: 'enraizamento',
  regen: 'regeneração',
  fortify: 'fortificação',
  empower: 'fúria',
  marked: 'marcado',
  petrify: 'petrificação',
  linked: 'vínculo',
  bonded: 'solidariedade',
};

export const EFFECT_CHOICES: readonly EffectKind[] = EFFECT_ORDER;

/**
 * How a numeric fact is written down, as opposed to how it is stored.
 *
 * Health and core fractions live as 0..1 in the program because that is what
 * the evaluator compares, but nobody writes "0.6" when they mean "60%". The
 * field scales on the way out and back, so what the player types and what
 * `validateStrategy` checks stay the same number in two notations.
 */
export interface NumericFieldSpec {
  /** Stored value × `scale` is what the field shows. */
  readonly scale: number;
  /** Stepper increment, in shown units. */
  readonly step: number;
  readonly unit: string;
  /**
   * What a freshly picked fact opens on, stored rather than shown.
   *
   * Not the middle of the legal range: `elapsed` is capped at ten minutes to
   * bound the wire, and opening a new row on "five minutes in" would suggest a
   * threshold nobody meant. These are the values a rule is usually written
   * about, so the row starts somewhere worth reading.
   */
  readonly start: number;
}

export const NUMERIC_FIELD: Readonly<Record<NumericConditionKind, NumericFieldSpec>> = {
  mana: { scale: 1, step: 1, unit: '', start: 5 },
  elapsed: { scale: 1, step: 10, unit: 's', start: 60 },
  ally_count: { scale: 1, step: 1, unit: '', start: 2 },
  enemy_count: { scale: 1, step: 1, unit: '', start: 2 },
  ally_health: { scale: 100, step: 5, unit: '%', start: 0.6 },
  enemy_health: { scale: 100, step: 5, unit: '%', start: 0.5 },
  ally_cluster: { scale: 1, step: 1, unit: '', start: 2 },
  enemy_cluster: { scale: 1, step: 1, unit: '', start: 2 },
  our_core: { scale: 100, step: 5, unit: '%', start: 0.5 },
  enemy_core: { scale: 100, step: 5, unit: '%', start: 0.5 },
  our_towers: { scale: 1, step: 1, unit: '', start: 1 },
  enemy_towers: { scale: 1, step: 1, unit: '', start: 1 },
};
