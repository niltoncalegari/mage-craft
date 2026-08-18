/**
 * The firing policy a mage reads before spending one of its own abilities
 * (plano v1.3 §3.4) — and the vocabulary that policy is written in.
 *
 * This module exists because of a sequencing problem. The v1.3 pivot deletes
 * the player-authored program (`strategy.ts`) but keeps the *language* it was
 * written in: "when the enemy is bunched up, at the enemy cluster" is exactly
 * as useful to a mage deciding for itself as it was to a rule list. So the
 * language moves here first, and `strategy.ts` re-exports it for as long as the
 * editor still ships. When the editor goes, this file is what is left standing
 * — the deletion is then a deletion rather than a rewrite.
 *
 * Two deliberate differences from the program's vocabulary:
 *
 * - **`mana` is not an ability condition.** Team mana is gone (§3.3); a policy
 *   guarded on it would be a skill that can never fire, which the balance sweep
 *   of §5 would read as "weak" and nerf. `kits.test.ts` refuses one.
 * - **`self_health` is new.** It is the only fact that belongs to a body rather
 *   than to a side, and it is what "the Pyromancer panics when *it* is nearly
 *   dead" needs. A team-scoped `ally_health` cannot say that.
 */

import { isEffectKind, type EffectKind } from './effects';
import { MANA_MAX, SQUAD_SIZE } from './config';
import { BALANCE } from './balance';
import { ALL_SPELLS, type SpellId } from './spells';
import type { Posture } from './bot/Squad';
import type { Vec2 } from './Vec2';

/* ---- Vocabulary ------------------------------------------------------------ */

export type Comparator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export const COMPARATORS: readonly Comparator[] = ['lt', 'lte', 'gt', 'gte', 'eq'];

/**
 * A numeric condition and the fact it reads. One shape rather than one per
 * fact, so a reader (and, while it lasted, the editor) handles them uniformly.
 */
export type NumericConditionKind =
  | 'mana'
  | 'elapsed'
  | 'ally_count'
  | 'enemy_count'
  | 'ally_health'
  | 'enemy_health'
  | 'self_health'
  | 'ally_cluster'
  | 'enemy_cluster'
  | 'our_core'
  | 'enemy_core'
  | 'our_towers'
  | 'enemy_towers';

/** Inclusive bounds an authored value must fall in, per fact. */
export const NUMERIC_RANGE: Readonly<Record<NumericConditionKind, readonly [number, number]>> = {
  mana: [0, MANA_MAX],
  elapsed: [0, 600],
  ally_count: [0, SQUAD_SIZE],
  enemy_count: [0, SQUAD_SIZE],
  ally_health: [0, 1],
  enemy_health: [0, 1],
  self_health: [0, 1],
  ally_cluster: [0, SQUAD_SIZE],
  enemy_cluster: [0, SQUAD_SIZE],
  our_core: [0, 1],
  enemy_core: [0, 1],
  our_towers: [0, 2],
  enemy_towers: [0, 2],
};

export const ALL_NUMERIC_CONDITIONS = Object.keys(NUMERIC_RANGE) as readonly NumericConditionKind[];

/**
 * The union above is the *superset* both readers share, and each side is
 * missing one fact from it.
 *
 * `mana` has had no source since §3.3 took team mana out, so an ability guarded
 * on it could never fire — and a skill that never fires reads as "weak" to the
 * balance sweep of §5, which is the "nerf cego" failure the plan warns about.
 * `self_health` runs the other way: it belongs to a body, and the player's
 * program is evaluated once per team, so a rule reading it would have no self
 * to ask about.
 */
export const PROGRAM_ONLY_CONDITIONS: readonly NumericConditionKind[] = ['mana'];
export const ABILITY_ONLY_CONDITIONS: readonly NumericConditionKind[] = ['self_health'];

export const ABILITY_NUMERIC_CONDITIONS: readonly NumericConditionKind[] =
  ALL_NUMERIC_CONDITIONS.filter((k) => !PROGRAM_ONLY_CONDITIONS.includes(k));

export const PROGRAM_NUMERIC_CONDITIONS: readonly NumericConditionKind[] =
  ALL_NUMERIC_CONDITIONS.filter((k) => !ABILITY_ONLY_CONDITIONS.includes(k));

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
 * Where an ability lands. Every selector resolves to one point or to nothing;
 * "nothing" skips the ability rather than falling back, because a spell that
 * quietly lands somewhere nobody chose is worse than one that does not go off.
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

/* ---- Stance ---------------------------------------------------------------- */

/**
 * How eagerly one mage spends its kit (§3.4) — the one dial the player still
 * turns after losing, now that there is no rule list to edit.
 *
 * Not to be confused with `Posture` from `bot/Squad.ts`, which is what the
 * squad planner decided the *team* is doing this second. A stance is authored
 * before the match and belongs to a body; a posture is derived during it and
 * belongs to a side.
 */
export type Stance = 'hold' | 'normal' | 'aggressive';

export const ALL_STANCES: readonly Stance[] = ['hold', 'normal', 'aggressive'];

export const DEFAULT_STANCE: Stance = 'normal';

export function isStance(value: unknown): value is Stance {
  return typeof value === 'string' && (ALL_STANCES as readonly string[]).includes(value);
}

/* ---- The policy ------------------------------------------------------------ */

export interface AbilityPolicy {
  /** Seconds this ability takes to come back, counted on the mage's own body. */
  readonly cooldown: number;
  /** How far from the caster the target point may be. Beyond it, no cast. */
  readonly range: number;
  /** The situation that makes this ability worth spending. */
  readonly when: Condition;
  readonly at: TargetSelector;
  /**
   * How many bodies the selector's cluster must hold for a `normal` mage to
   * think this is the moment. `aggressive` ignores it — that is the whole
   * difference between the two stances.
   */
  readonly minTargets: number;
}

/* ---- The situation --------------------------------------------------------- */

/**
 * Everything a reader can see, from one team's point of view, for one tick.
 * Built once per evaluation by `buildFacts` — never once per rule or per
 * ability, which is what keeps a squad's four kits from costing four passes
 * over the field.
 */
export interface StrategyFacts {
  readonly elapsed: number;
  readonly suddenDeath: boolean;
  /** Null when the squad has no plan; posture conditions then never hold. */
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
  /** Pre-resolved, so firing is a lookup rather than another world scan. */
  readonly targets: Readonly<Record<TargetSelector, Vec2 | null>>;
}

/**
 * The overlay that turns team facts into *this mage's* facts.
 *
 * It holds one field and that is not an oversight: `self_health` is the only
 * thing in the vocabulary that a body knows and a side does not. Everything
 * else a mage might ask — who is clustered, who is hurt, who has crossed the
 * midline — is already true for the whole squad, so computing it per mage would
 * be four identical scans of the same field.
 */
export interface MageFacts {
  readonly healthFraction: number;
}

/* ---- Evaluation ------------------------------------------------------------ */

/**
 * Whether a condition is true of the given situation.
 *
 * `self` is optional because the player's program is evaluated once per team
 * and has no body to ask about. Its absence is not an error: `self_health`
 * answers "unhurt" without it, so a condition that slips through validation
 * reads inert rather than permanently true.
 */
export function holds(condition: Condition, facts: StrategyFacts, self?: MageFacts): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'sudden_death':
      return facts.suddenDeath === condition.value;
    case 'intruder':
      return facts.hasIntruder;
    case 'posture':
      // A world with no squad plan has no opinion about posture, so a condition
      // guarded on one must not hold in it.
      return facts.posture !== null && facts.posture === condition.value;
    case 'ally_has_effect':
      return facts.allyEffects.has(condition.effect);
    case 'enemy_has_effect':
      return facts.enemyEffects.has(condition.effect);
    case 'not':
      return !holds(condition.of, facts, self);
    case 'all':
      return condition.of.every((c) => holds(c, facts, self));
    case 'any':
      return condition.of.some((c) => holds(c, facts, self));
    default:
      return compare(numericFact(condition.kind, facts, self), condition.op, condition.value);
  }
}

function numericFact(kind: NumericConditionKind, f: StrategyFacts, self?: MageFacts): number {
  switch (kind) {
    // Inert, not absent: `mana` stays in the vocabulary so the player's saved
    // programs still parse until §5 deletes the reader, but there has been no
    // bar to read since §3.3. Zero is the honest answer — every `mana >= N`
    // guard reads false, which is what "this rule can no longer fire" means.
    case 'mana':
      return 0;
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
    case 'self_health':
      return self?.healthFraction ?? 1;
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

/** Structural check of the condition union; deep, and total on unknown input. */
export function isCondition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;

  switch (c.kind) {
    case 'always':
    case 'intruder':
      return true;
    case 'sudden_death':
      return typeof c.value === 'boolean';
    case 'posture':
      return (ALL_POSTURES as readonly unknown[]).includes(c.value);
    case 'ally_has_effect':
    case 'enemy_has_effect':
      return typeof c.effect === 'string' && isEffectKind(c.effect);
    case 'not':
      return isCondition(c.of);
    case 'all':
    case 'any':
      return Array.isArray(c.of) && c.of.length > 0 && c.of.every(isCondition);
    default:
      break;
  }

  if (!(ALL_NUMERIC_CONDITIONS as readonly unknown[]).includes(c.kind)) return false;
  if (!(COMPARATORS as readonly unknown[]).includes(c.op)) return false;
  if (typeof c.value !== 'number' || !Number.isFinite(c.value)) return false;
  const [lo, hi] = NUMERIC_RANGE[c.kind as NumericConditionKind];
  return c.value >= lo && c.value <= hi;
}

/** Whether a condition is legal in an *ability* policy specifically. */
export function isAbilityCondition(value: unknown): boolean {
  if (!isCondition(value)) return false;
  const c = value as Record<string, unknown>;
  if (PROGRAM_ONLY_CONDITIONS.includes(c.kind as NumericConditionKind)) return false;
  if (c.kind === 'not') return isAbilityCondition(c.of);
  if (c.kind === 'all' || c.kind === 'any') {
    return (c.of as readonly unknown[]).every(isAbilityCondition);
  }
  return true;
}

/* ---- The catalog ----------------------------------------------------------- */

/**
 * Built and validated eagerly at module load, the way `spells.ts` builds the
 * card catalog and for the same reason: these are hand-authored JSON, and a
 * policy that silently degrades to "never fires" is a bug that only shows up as
 * a skill quietly missing from a balance report weeks later.
 */
function build(): Readonly<Record<SpellId, AbilityPolicy>> {
  const out = {} as Record<SpellId, AbilityPolicy>;

  for (const id of ALL_SPELLS) {
    const raw = BALANCE.spells[id] as unknown as Partial<AbilityPolicy> | undefined;
    const where = `ability policy for ${JSON.stringify(id)}`;
    if (!raw) throw new Error(`${where}: spell missing from balance.json`);

    for (const [field, value] of [
      ['cooldown', raw.cooldown],
      ['range', raw.range],
      ['minTargets', raw.minTargets],
    ] as const) {
      if (!Number.isFinite(value) || (value as number) <= 0) {
        throw new Error(`${where}: ${field} must be a positive number, got ${String(value)}`);
      }
    }
    if (!(ALL_TARGET_SELECTORS as readonly unknown[]).includes(raw.at)) {
      throw new Error(`${where}: unknown selector ${JSON.stringify(raw.at)}`);
    }
    if (!isAbilityCondition(raw.when)) {
      throw new Error(`${where}: \`when\` is not a legal ability condition`);
    }

    out[id] = {
      cooldown: raw.cooldown as number,
      range: raw.range as number,
      when: raw.when as Condition,
      at: raw.at as TargetSelector,
      minTargets: raw.minTargets as number,
    };
  }

  return out;
}

const POLICIES = build();

export function abilityPolicyFor(id: string): AbilityPolicy | undefined {
  return POLICIES[id as SpellId];
}
