/**
 * The programs the game is measured against (GDD §10, §14).
 *
 * Since the idle pivot a match is decided by the program each side authored,
 * so "is this game balanced?" became "do better programs beat worse ones?".
 * Answering it needs a fixed set of opponents that does not move underneath
 * the measurement — the strategy equivalent of a benchmark suite.
 *
 * They live here rather than inside `agency.test.ts` because two callers need
 * exactly the same programs: the test, which asserts a floor, and
 * `scripts/ai-report.mts`, which reports where the number actually sits. If
 * each kept its own copy, the report would stop corroborating the test the
 * first time either was edited, and neither would say so.
 *
 * Every rule here names a card from `defaultDeck()`, so all of them pass
 * `validateStrategy` against it. A program that names a card the deck does not
 * carry is not invalid — the rule is simply inert (`evaluateStrategy` skips
 * it) — but a benchmark made of inert rules would measure nothing.
 */

import { STRATEGY_VERSION, type Strategy, type StrategyRule } from './strategy';

const rule = (
  id: string,
  card: StrategyRule['card'],
  when: StrategyRule['when'],
  at: StrategyRule['at'],
): StrategyRule => ({ id, enabled: true, card, when, at });

/**
 * Reads the field and answers it: break up a group with the zone, slow the one
 * enemy that got through, shield a squad that is losing the trade, and press
 * on only when none of that applies.
 *
 * The order is the whole point. `evaluateStrategy` is first-match-wins, so the
 * situational rules have to sit above the unconditional one; moving `press-on`
 * to the top would turn the other three into decoration.
 */
export function responsiveProgram(): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'Responsiva',
    rules: [
      rule('answer-cluster', 'plague', { kind: 'enemy_cluster', op: 'gte', value: 2 }, 'enemy_cluster'),
      rule('answer-intruder', 'sticky_swamp', { kind: 'intruder' }, 'deepest_intruder'),
      rule('shore-up', 'arcane_shield', { kind: 'ally_health', op: 'lt', value: 0.6 }, 'ally_cluster'),
      rule('press-on', 'blessing', { kind: 'always' }, 'ally_frontline'),
    ],
  };
}

/**
 * Every card, no guards: the control for `responsiveProgram`.
 *
 * Because evaluation is first-match-wins and every condition here is `always`,
 * this plays whichever of its cards is in hand and affordable, with no regard
 * for what the field looks like. That is what makes it the right thing to
 * measure branching against: it spends the same mana on the same cards at the
 * same cadence, and differs from the responsive program *only* in whether the
 * choice is situational.
 *
 * Ordered by cost so the cheap rule is reached first and the program keeps
 * casting rather than banking — banking is something a program does on
 * purpose, with a `mana >=` guard, and this one does nothing on purpose.
 */
export function flatProgram(): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'Plana',
    rules: [
      rule('press-on', 'blessing', { kind: 'always' }, 'ally_frontline'),
      rule('shield-up', 'arcane_shield', { kind: 'always' }, 'ally_cluster'),
      rule('bog-them', 'sticky_swamp', { kind: 'always' }, 'enemy_cluster'),
      rule('rot-them', 'plague', { kind: 'always' }, 'enemy_cluster'),
    ],
  };
}

/**
 * One rule, one card. Not a control for anything — a **finding**, kept as a
 * preset because it is the cheapest demonstration of a real design property.
 *
 * A card leaves the hand only by being played, and the deck only cycles on a
 * play. So a program naming a single card plays it once, watches it go to the
 * back of an eight-card queue, and never sees it again. Measured over the sweep
 * in `scripts/ai-report.mts` it cast **45 times across 48 matches** — about
 * once each — and finished dead even (6-6) against a program with no rules at
 * all, while `flatProgram` takes 92% against that same opponent.
 *
 * That is the trap the deck rule and the program have to be read together to
 * avoid (GDD §7): eight slots and one rule is a dead deck, and nothing in the
 * game says so except this measurement. It is why `defaultStrategy` spends a
 * rule on every card it can, and why the editor opens on a working program
 * instead of an empty list.
 */
export function naiveProgram(): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'Ingênua',
    rules: [rule('press-on', 'blessing', { kind: 'always' }, 'ally_frontline')],
  };
}
