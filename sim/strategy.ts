/**
 * The strategy program (GDD §7) — what the player authors instead of playing
 * cards by hand.
 *
 * Since the idle pivot nobody clicks during a match. The player writes an
 * ordered list of rules before it starts, and this module is what reads that
 * list: given a snapshot of the situation, which card goes off and where.
 *
 * Three properties are load-bearing and everything here is shaped by them:
 *
 * - **Pure.** No `World`, no `Rng`, no clock. The facts come in as data (see
 *   `strategyFacts.ts`), so the evaluator is testable against hand-written
 *   situations and cannot perturb the simulation it advises.
 * - **Deterministic.** Nothing draws randomness. This matters more than it
 *   looks: the server hands one `Rng` to Brain, to both deck shuffles and to
 *   the bot Commander, so a caster that drew from it would make *editing a
 *   rule list* change how the mages fight.
 * - **JSON.** Plain discriminated unions, no classes, no `Map`, no `Vec2` in
 *   the program itself. `JSON.parse(JSON.stringify(s))` is the identity, which
 *   is what lets the same object live in localStorage, in Mongo and on the wire.
 *
 * The evaluation rule is first-match-wins, top to bottom, and a rule that
 * cannot fire is **skipped rather than waited on** — see `evaluateStrategy`.
 */

import { isEffectKind, type EffectKind } from './effects';
import { MANA_MAX, SQUAD_SIZE } from './config';
import { isSpellId, spellFor, type CardId } from './spells';
import type { Posture } from './bot/Squad';
import type { Vec2 } from './Vec2';

export const STRATEGY_VERSION = 1;

/** Rules the editor will show, and the ceiling the validator enforces. */
export const STRATEGY_MAX_RULES = 12;
/**
 * Children per `all`/`any`. Four fits one editor row; more wants a real editor.
 *
 * A group holds plain conditions and never another group — a shape constraint
 * rather than an arbitrary depth cap, and it comes from the editor: a rule
 * renders as one row, and a row is a flat list of `[não] <condição>` items.
 * Nested groups would need a tree widget and would stop being readable at a
 * glance, which is the whole point of the flowchart. `not` is a modifier on a
 * single condition, so it never opens a level of its own.
 */
export const STRATEGY_MAX_GROUP = 4;
const MAX_ID_LENGTH = 32;
const MAX_NAME_LENGTH = 24;

/* ---- The program ----------------------------------------------------------- */

export type Comparator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

const COMPARATORS: readonly Comparator[] = ['lt', 'lte', 'gt', 'gte', 'eq'];

/**
 * A numeric condition and the fact it reads. Kept as one shape rather than one
 * per fact so the editor renders a single "pick a fact, pick a comparator, type
 * a number" row for all of them.
 */
export type NumericConditionKind =
  | 'mana'
  | 'elapsed'
  | 'ally_count'
  | 'enemy_count'
  | 'ally_health'
  | 'enemy_health'
  | 'ally_cluster'
  | 'enemy_cluster'
  | 'our_core'
  | 'enemy_core'
  | 'our_towers'
  | 'enemy_towers';

/** Inclusive bounds the authored value must fall in, per fact. */
const NUMERIC_RANGE: Readonly<Record<NumericConditionKind, readonly [number, number]>> = {
  mana: [0, MANA_MAX],
  elapsed: [0, 600],
  ally_count: [0, SQUAD_SIZE],
  enemy_count: [0, SQUAD_SIZE],
  ally_health: [0, 1],
  enemy_health: [0, 1],
  ally_cluster: [0, SQUAD_SIZE],
  enemy_cluster: [0, SQUAD_SIZE],
  our_core: [0, 1],
  enemy_core: [0, 1],
  our_towers: [0, 2],
  enemy_towers: [0, 2],
};

export const ALL_NUMERIC_CONDITIONS = Object.keys(NUMERIC_RANGE) as readonly NumericConditionKind[];

export type Condition =
  | { readonly kind: 'always' }
  | { readonly kind: NumericConditionKind; readonly op: Comparator; readonly value: number }
  | { readonly kind: 'sudden_death'; readonly value: boolean }
  | { readonly kind: 'posture'; readonly value: Posture }
  | { readonly kind: 'intruder' }
  | { readonly kind: 'ally_has_effect' | 'enemy_has_effect'; readonly effect: EffectKind }
  | { readonly kind: 'not'; readonly of: Condition }
  | { readonly kind: 'all' | 'any'; readonly of: readonly Condition[] };

/**
 * Where a spell lands. Every selector resolves to one point or to nothing;
 * "nothing" skips the rule rather than falling back, because a spell that
 * quietly lands somewhere the player never named is worse than one that
 * does not go off.
 */
export type TargetSelector =
  | 'enemy_cluster'
  | 'ally_cluster'
  | 'deepest_intruder'
  | 'weakest_ally'
  | 'strongest_enemy'
  | 'ally_frontline'
  | 'enemy_frontline'
  | 'our_core'
  | 'enemy_core'
  | 'our_objective'
  | 'squad_rally';

export const ALL_TARGET_SELECTORS: readonly TargetSelector[] = [
  'enemy_cluster',
  'ally_cluster',
  'deepest_intruder',
  'weakest_ally',
  'strongest_enemy',
  'ally_frontline',
  'enemy_frontline',
  'our_core',
  'enemy_core',
  'our_objective',
  'squad_rally',
];

export const ALL_POSTURES: readonly Posture[] = ['push', 'defend', 'regroup'];

export interface StrategyRule {
  /** Stable across edits. It is what the HUD names when the rule fires. */
  readonly id: string;
  readonly enabled: boolean;
  readonly card: CardId;
  readonly when: Condition;
  readonly at: TargetSelector;
}

export interface Strategy {
  readonly version: number;
  readonly name: string;
  readonly rules: readonly StrategyRule[];
}

/* ---- The situation --------------------------------------------------------- */

/**
 * Everything the evaluator can see, from one team's point of view, for one
 * tick. Built once per evaluation by `buildFacts` — never per rule, which is
 * what keeps twelve rules from costing twelve passes over the squad.
 */
export interface StrategyFacts {
  readonly mana: number;
  readonly elapsed: number;
  readonly suddenDeath: boolean;
  /** Null when the squad has no plan; posture rules then never fire. */
  readonly posture: Posture | null;
  readonly allyCount: number;
  readonly enemyCount: number;
  /** 1 when nobody is alive, so "someone is hurt" reads false rather than true. */
  readonly allyLowestHealthFraction: number;
  readonly enemyLowestHealthFraction: number;
  readonly ourCoreFraction: number;
  readonly enemyCoreFraction: number;
  readonly ourTowersAlive: number;
  readonly enemyTowersAlive: number;
  /** Size of the biggest group inside `CLUSTER_RADIUS`; 0 when none are alive. */
  readonly allyClusterSize: number;
  readonly enemyClusterSize: number;
  /** True only once an enemy is genuinely past the midline into our ground. */
  readonly hasIntruder: boolean;
  readonly allyEffects: ReadonlySet<EffectKind>;
  readonly enemyEffects: ReadonlySet<EffectKind>;
  /** Pre-resolved, so firing a rule is a lookup rather than another world scan. */
  readonly targets: Readonly<Record<TargetSelector, Vec2 | null>>;
}

/** What the hand and the bank allow right now, independent of the situation. */
export interface StrategyGate {
  readonly hand: readonly CardId[];
  readonly mana: number;
}

export interface StrategyDecision {
  readonly ruleId: string;
  readonly ruleIndex: number;
  readonly cardId: CardId;
  readonly position: Vec2;
}

/* ---- Evaluation ------------------------------------------------------------ */

/**
 * The first rule that can fire, or null.
 *
 * A rule is eligible when it is enabled, its card is in hand and affordable,
 * its condition holds, and its target resolves. Anything else **skips to the
 * next rule** — it never blocks the ones below it.
 *
 * That choice is worth stating because the alternative is tempting. If an
 * ineligible rule waited, the editor's fallthrough arrow would be a lie, and
 * the top rule could deny service to the rest of the player's own program.
 * Waiting stays perfectly expressible, just explicitly: bank for an expensive
 * card by guarding the cheap rules under it with `mana >= N`, which is exactly
 * how the genre's players already think.
 */
export function evaluateStrategy(
  strategy: Strategy,
  facts: StrategyFacts,
  gate: StrategyGate,
): StrategyDecision | null {
  for (let i = 0; i < strategy.rules.length; i++) {
    const rule = strategy.rules[i];
    if (!rule.enabled) continue;
    if (!gate.hand.includes(rule.card)) continue;

    const spell = spellFor(rule.card);
    if (!spell || spell.cost > gate.mana) continue;
    if (!holds(rule.when, facts)) continue;

    const position = facts.targets[rule.at] ?? null;
    if (!position) continue;

    return { ruleId: rule.id, ruleIndex: i, cardId: rule.card, position };
  }
  return null;
}

function holds(condition: Condition, facts: StrategyFacts): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'sudden_death':
      return facts.suddenDeath === condition.value;
    case 'intruder':
      return facts.hasIntruder;
    case 'posture':
      // A world with no squad plan has no opinion about posture, so a rule
      // guarded on one must not fire in it.
      return facts.posture !== null && facts.posture === condition.value;
    case 'ally_has_effect':
      return facts.allyEffects.has(condition.effect);
    case 'enemy_has_effect':
      return facts.enemyEffects.has(condition.effect);
    case 'not':
      return !holds(condition.of, facts);
    case 'all':
      return condition.of.every((c) => holds(c, facts));
    case 'any':
      return condition.of.some((c) => holds(c, facts));
    default:
      return compare(numericFact(condition.kind, facts), condition.op, condition.value);
  }
}

function numericFact(kind: NumericConditionKind, f: StrategyFacts): number {
  switch (kind) {
    case 'mana':
      return f.mana;
    case 'elapsed':
      return f.elapsed;
    case 'ally_count':
      return f.allyCount;
    case 'enemy_count':
      return f.enemyCount;
    case 'ally_health':
      return f.allyLowestHealthFraction;
    case 'enemy_health':
      return f.enemyLowestHealthFraction;
    case 'ally_cluster':
      return f.allyClusterSize;
    case 'enemy_cluster':
      return f.enemyClusterSize;
    case 'our_core':
      return f.ourCoreFraction;
    case 'enemy_core':
      return f.enemyCoreFraction;
    case 'our_towers':
      return f.ourTowersAlive;
    case 'enemy_towers':
      return f.enemyTowersAlive;
  }
}

function compare(actual: number, op: Comparator, value: number): boolean {
  switch (op) {
    case 'lt':
      return actual < value;
    case 'lte':
      return actual <= value;
    case 'gt':
      return actual > value;
    case 'gte':
      return actual >= value;
    case 'eq':
      return actual === value;
  }
}

/* ---- Validation ------------------------------------------------------------ */

export type StrategyValidation = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): StrategyValidation => ({ ok: false, reason });

/**
 * Gates a program before it is allowed to run, mirroring `validateDeck` and
 * `validateSquad` in shape and in *when*: on read from storage as well as on
 * write, so a hand-edited profile degrades to the default instead of reaching
 * the simulation.
 *
 * `deck` is required because a rule naming a card the player did not bring can
 * never fire. Rejecting it here is the difference between a program that is
 * wrong and one that is silently inert.
 */
export function validateStrategy(value: unknown, deck: readonly string[]): StrategyValidation {
  if (typeof value !== 'object' || value === null) return fail('strategy must be an object');

  const s = value as Partial<Strategy>;
  if (s.version !== STRATEGY_VERSION) return fail(`unsupported strategy version ${String(s.version)}`);
  if (typeof s.name !== 'string' || s.name.length > MAX_NAME_LENGTH) {
    return fail(`strategy name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (!Array.isArray(s.rules)) return fail('strategy must hold a list of rules');
  if (s.rules.length > STRATEGY_MAX_RULES) {
    return fail(`a strategy holds at most ${STRATEGY_MAX_RULES} rules, got ${s.rules.length}`);
  }

  const seen = new Set<string>();
  for (const raw of s.rules) {
    if (typeof raw !== 'object' || raw === null) return fail('every rule must be an object');
    const rule = raw as Partial<StrategyRule>;

    if (typeof rule.id !== 'string' || rule.id.length === 0 || rule.id.length > MAX_ID_LENGTH) {
      return fail(`every rule needs an id of 1..${MAX_ID_LENGTH} characters`);
    }
    if (seen.has(rule.id)) return fail(`duplicate rule id ${JSON.stringify(rule.id)}`);
    seen.add(rule.id);

    if (typeof rule.enabled !== 'boolean') return fail(`rule ${rule.id} must say whether it is enabled`);
    if (typeof rule.card !== 'string' || !isSpellId(rule.card)) {
      return fail(`unknown card ${JSON.stringify(rule.card)} in rule ${rule.id}`);
    }
    if (!deck.includes(rule.card)) {
      return fail(`rule ${rule.id} uses ${rule.card}, which is not in the deck`);
    }
    if (typeof rule.at !== 'string' || !ALL_TARGET_SELECTORS.includes(rule.at as TargetSelector)) {
      return fail(`unknown target ${JSON.stringify(rule.at)} in rule ${rule.id}`);
    }

    const when = validateCondition(rule.when, false);
    if (!when.ok) return fail(`rule ${rule.id}: ${when.reason}`);
  }

  return { ok: true };
}

function isGroup(value: unknown): boolean {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return kind === 'all' || kind === 'any';
}

/** `inGroup` is true while checking the children of an `all`/`any`. */
function validateCondition(value: unknown, inGroup: boolean): StrategyValidation {
  if (typeof value !== 'object' || value === null) return fail('condition must be an object');
  const c = value as { kind?: unknown; op?: unknown; value?: unknown; effect?: unknown; of?: unknown };

  if (typeof c.kind !== 'string') return fail('condition needs a kind');

  switch (c.kind) {
    case 'always':
    case 'intruder':
      return { ok: true };

    case 'sudden_death':
      return typeof c.value === 'boolean' ? { ok: true } : fail('sudden_death needs a boolean');

    case 'posture':
      return ALL_POSTURES.includes(c.value as Posture)
        ? { ok: true }
        : fail(`unknown posture ${JSON.stringify(c.value)}`);

    case 'ally_has_effect':
    case 'enemy_has_effect':
      return typeof c.effect === 'string' && isEffectKind(c.effect)
        ? { ok: true }
        : fail(`unknown effect ${JSON.stringify(c.effect)}`);

    // A modifier on one condition, not a level of its own — so "não há intruso
    // E mana >= 5" stays writable inside a group.
    case 'not':
      return isGroup(c.of)
        ? fail('not may negate one condition, not a whole group')
        : validateCondition(c.of, inGroup);

    case 'all':
    case 'any': {
      if (inGroup) return fail('a group of conditions cannot nest another group');
      if (!Array.isArray(c.of) || c.of.length === 0) return fail(`${c.kind} needs at least one condition`);
      if (c.of.length > STRATEGY_MAX_GROUP) {
        return fail(`${c.kind} holds at most ${STRATEGY_MAX_GROUP} conditions`);
      }
      for (const child of c.of) {
        const inner = validateCondition(child, true);
        if (!inner.ok) return inner;
      }
      return { ok: true };
    }

    default: {
      const range = NUMERIC_RANGE[c.kind as NumericConditionKind];
      if (!range) return fail(`unknown condition ${JSON.stringify(c.kind)}`);
      if (!COMPARATORS.includes(c.op as Comparator)) {
        return fail(`unknown comparator ${JSON.stringify(c.op)}`);
      }
      if (typeof c.value !== 'number' || !Number.isFinite(c.value)) {
        return fail(`${c.kind} needs a finite value`);
      }
      if (c.value < range[0] || c.value > range[1]) {
        return fail(`${c.kind} must be between ${range[0]} and ${range[1]}, got ${c.value}`);
      }
      return { ok: true };
    }
  }
}

/* ---- Starting points ------------------------------------------------------- */

/** The AFK baseline: a representable program that casts exactly nothing. */
export function emptyStrategy(): Strategy {
  return { version: STRATEGY_VERSION, name: '', rules: [] };
}

/**
 * What a player who never opened the editor brings, and what the editor opens
 * with — a working program to edit rather than a blank canvas.
 *
 * It is the bot Commander's heuristics written out as rules: answer a push
 * with a curse, shore up a squad that is taking a beating, otherwise make the
 * healthy push faster. Only cards actually in `deck` get a rule, so the result
 * always passes `validateStrategy` against that deck.
 */
export function defaultStrategy(deck: readonly CardId[]): Strategy {
  const has = (id: CardId): boolean => deck.includes(id);
  const rules: StrategyRule[] = [];
  const add = (id: string, card: CardId, when: Condition, at: TargetSelector): void => {
    if (has(card)) rules.push({ id, enabled: true, card, when, at });
  };

  add('answer-cluster', 'plague', { kind: 'enemy_cluster', op: 'gte', value: 2 }, 'enemy_cluster');
  add('answer-intruder', 'slow_curse', { kind: 'intruder' }, 'deepest_intruder');
  add('shore-up', 'arcane_shield', { kind: 'ally_health', op: 'lt', value: 0.6 }, 'ally_cluster');
  add('press-on', 'blessing', { kind: 'always' }, 'ally_frontline');

  // A deck holding none of the four still deserves a program that does
  // something, so fall back to the cheapest card on the healthy push.
  if (rules.length === 0 && deck.length > 0) {
    const cheapest = [...deck].sort((a, b) => (spellFor(a)?.cost ?? 99) - (spellFor(b)?.cost ?? 99))[0];
    rules.push({
      id: 'press-on',
      enabled: true,
      card: cheapest,
      when: { kind: 'always' },
      at: 'ally_frontline',
    });
  }

  return { version: STRATEGY_VERSION, name: 'Padrão', rules };
}
