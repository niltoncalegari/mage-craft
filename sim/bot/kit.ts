/**
 * Which ability a mage spends, and when (plano v1.3 §3.4).
 *
 * This is the decision the player used to author as an ordered rule list. The
 * pivot moves it into the mage: each body carries a kit, each skill carries the
 * policy that says when it is worth spending, and the only dial the player
 * still turns before a match is the stance.
 *
 * Three properties are load-bearing, and they are the same three that made the
 * rule evaluator trustworthy:
 *
 * - **Pure.** No `World`, no clock, no side effects. Facts come in as data, an
 *   intent goes out; the caller is what touches the world.
 * - **Draws no randomness.** The server hands a single `Rng` to `Brain`, so a
 *   chooser that drew from it would make *editing a loadout* change how every
 *   mage on the field walks. Ties break on the skill's own cost and then on kit
 *   order, which are both fixed before the match starts.
 * - **Never waits.** A skill that cannot go off is skipped, not queued, exactly
 *   as an ineligible rule was. The alternative lets the most expensive skill in
 *   a kit deny service to the two beneath it.
 */

import {
  abilityPolicyFor,
  holds,
  type Condition,
  type MageFacts,
  type StrategyFacts,
  type TargetSelector,
} from '../abilityPolicy';
import type { Mage } from '../entities';
import { spellFor, type SpellId } from '../spells';
import type { Vec2 } from '../Vec2';

/** One mage's decision to spend one skill at one point. */
export interface AbilityIntent {
  readonly spellId: SpellId;
  /**
   * The point, not the selector that named it. `at` means the selector
   * everywhere else in this vocabulary (see `StrategyDecision`), and a mage
   * deciding for itself has no player to explain the choice to.
   */
  readonly position: Vec2;
}

/**
 * The extra situation a `hold` mage demands before it will spend anything.
 *
 * A held kit is meant to read as "saving it for when it matters", not as "off",
 * so the guard names the three moments that unambiguously matter: our Core is
 * being worked on, this mage is about to die, or somebody has crossed into our
 * ground. Anything looser and `hold` stops being distinguishable from `normal`;
 * anything tighter and it stops being a stance and becomes a disabled squad.
 */
export const HOLD_GUARD: Condition = {
  kind: 'any',
  of: [
    { kind: 'our_core', op: 'lt', value: 0.6 },
    { kind: 'self_health', op: 'lt', value: 0.5 },
    { kind: 'intruder' },
  ],
};

/** The one fact a body knows that its side does not. */
export function selfFacts(m: Mage): MageFacts {
  return { healthFraction: m.maxHealth > 0 ? m.health / m.maxHealth : 0 };
}

/**
 * The best ability this mage could spend right now, or null.
 *
 * "Best" is the most expensive one that is ready, whose moment has come, whose
 * target resolved, and that its stance allows — cost being the only ranking the
 * catalog already carries, and kit order the tiebreak beneath it.
 */
export function chooseAbility(
  mage: Mage,
  facts: StrategyFacts,
  self: MageFacts,
): AbilityIntent | null {
  // The per-mage GCD stops the whole kit rather than one slot of it, so there
  // is nothing to scan for.
  if (!mage.alive || mage.abilityGcd > 0) return null;

  let best: AbilityIntent | null = null;
  let bestCost = -Infinity;

  for (let i = 0; i < mage.abilities.length; i++) {
    if (mage.abilityCooldowns[i] > 0) continue;

    const spellId = mage.abilities[i];
    const policy = abilityPolicyFor(spellId);
    if (!policy) continue;

    if (!holds(policy.when, facts, self)) continue;
    if (mage.stance === 'hold' && !holds(HOLD_GUARD, facts, self)) continue;
    // `aggressive` spending its kit into a lone target is the whole of what the
    // stance buys, and the whole of what it costs.
    if (mage.stance !== 'aggressive' && targetsAt(policy.at, facts) < policy.minTargets) continue;

    const position = facts.targets[policy.at];
    if (!position) continue;
    if (mage.position.distanceTo(position) > policy.range) continue;

    // Strictly greater, so the earliest slot of the kit wins a tie.
    const cost = spellFor(spellId)?.cost ?? 0;
    if (cost > bestCost) {
      bestCost = cost;
      best = { spellId, position };
    }
  }

  return best;
}

/**
 * How many bodies the selector is pointing at.
 *
 * Only the two cluster selectors can answer with more than one; every other
 * selector resolves to a single mage, structure or point, so it counts as one
 * and `minTargets` above 1 would make it unfireable. `kits.test.ts` is what
 * keeps the catalog from authoring that.
 */
function targetsAt(at: TargetSelector, facts: StrategyFacts): number {
  if (at === 'enemy_cluster') return facts.enemyClusterSize;
  if (at === 'ally_cluster') return facts.allyClusterSize;
  return 1;
}
