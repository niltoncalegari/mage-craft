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

import type { CardId } from './spells';
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

/* ---- The conditional deck --------------------------------------------------
 *
 * **Why any of this exists.** The three programs above are written against
 * `defaultDeck()`, which is four Tier 1 cards, and `scripts/ai-report.mts` gave
 * that deck to both sides of every match in the sweep. So when the catalog grew
 * from 7 cards to 22, the sweep measured *exactly the same thing* — same win
 * rates, same cast counts to within a handful — and it would have gone on doing
 * so however many cards were added. Fourteen of the twenty-two were unreachable
 * by any program in it, three of them from Tier 1.
 *
 * That matters because the sweep is what the GDD's §10 finding rests on:
 * `responsiva` × `plana` = exactly 50%, read as "reading the situation does not
 * pay", with the proposed explanation that the cards were too generic for the
 * situation to matter. The explanation may well be right — but the experiment
 * that produced the number could not have detected it being wrong, and running
 * it again after a card pass answers a question nobody asked.
 *
 * So: a second deck, of cards whose value genuinely depends on *when* the rule
 * fires, and the same responsive-versus-flat pair over it. The Tier 1 deck stays
 * exactly as it was — it is the comparison, and deleting it would throw away the
 * only measurement the two can be read against.
 */

/**
 * Eight cards, two colours, all of them situational. Blue and red because
 * `MAX_COLORS` is enforced now and the conditional cards are spread across four
 * colours — this is the pair that carries the most of them.
 *
 * Every card here is worth a different amount depending on the moment it is
 * played, which is the property the measurement is about:
 *
 * - **Marca do Carrasco** is inert against a healthy target and only pays under
 *   the execute threshold.
 * - **Clarão Nulo** is worth nothing until the enemy has spent mana, and then
 *   worth whatever they spent.
 * - **Erupção Vulcânica** warns before it lands, so a squad that is leaving
 *   anyway takes none of it.
 * - **Vórtice Gravitacional** does almost nothing alone and changes what a
 *   hazard is worth entirely.
 * - **Chuva de Meteoros** and **Campo de Sobrecarga** want a crowd.
 * - **Frenesi Sanguinário** wants your own squad together and in a fight.
 * - **Petrificar** — see {@link conditionalDeckWithoutStone}.
 *
 * Not run through `validateDeck` here, deliberately: this is a benchmark
 * fixture, and a preset that silently changed shape to satisfy a rule would
 * stop being the thing that was measured. It is built to be legal, and
 * `strategyPresets.test.ts` is what says so out loud.
 */
export function conditionalDeck(): CardId[] {
  return [
    'executioners_mark',
    'null_flash',
    'volcanic_eruption',
    'gravity_well',
    'meteor_shower',
    'overload_field',
    'blood_frenzy',
    'petrify',
  ];
}

/**
 * The same deck with Petrificar swapped for a second Fúria do Trovão.
 *
 * Petrify is the one card in the set that can *help the target*: it makes them
 * immune to damage while it runs. A flat program casting it on every cooldown
 * would spend the match protecting the enemy, so a large win for the responsive
 * program over the conditional deck could mean "guards pay" or it could mean
 * "one of these eight cards is a trap when mistimed" — two different sentences,
 * and only one of them is what §10 is asking about.
 *
 * Running both decks is what separates them. This is not a better deck; it is
 * the control that makes the other one legible.
 */
export function conditionalDeckWithoutStone(): CardId[] {
  return conditionalDeck().map((id) => (id === 'petrify' ? 'thunderstrike' : id));
}

/**
 * Reads the field with the conditional deck: every card guarded by the
 * situation it is actually good in, situational rules above the fallback.
 */
export function conditionalResponsiveProgram(): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'Condicional responsiva',
    rules: [
      rule('finish', 'executioners_mark', { kind: 'enemy_health', op: 'lte', value: 0.5 }, 'strongest_enemy'),
      rule('strip', 'null_flash', { kind: 'enemy_has_effect', effect: 'shield' }, 'enemy_cluster'),
      rule('bombard', 'meteor_shower', { kind: 'enemy_cluster', op: 'gte', value: 3 }, 'enemy_cluster'),
      rule('hold-them', 'gravity_well', { kind: 'enemy_cluster', op: 'gte', value: 2 }, 'enemy_cluster'),
      rule('erupt', 'volcanic_eruption', { kind: 'enemy_cluster', op: 'gte', value: 2 }, 'enemy_cluster'),
      rule('lock', 'petrify', { kind: 'intruder' }, 'deepest_intruder'),
      rule('overload', 'overload_field', { kind: 'enemy_count', op: 'gte', value: 3 }, 'enemy_cluster'),
      rule('frenzy', 'blood_frenzy', { kind: 'always' }, 'ally_cluster'),
    ],
  };
}

/**
 * The same eight cards, the same eight places, no guards — the control.
 *
 * The pairing has to hold the cards fixed and vary only the guards, which is the
 * correction the Tier 1 measurement already had to make once: its first control
 * had a single rule, so it measured card *variety* rather than situational
 * play. Ordered by cost so the cheap rule is reached first and the program keeps
 * casting rather than banking, which is a decision and this program makes none.
 */
export function conditionalFlatProgram(): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'Condicional plana',
    rules: [
      rule('finish', 'executioners_mark', { kind: 'always' }, 'strongest_enemy'),
      rule('strip', 'null_flash', { kind: 'always' }, 'enemy_cluster'),
      rule('lock', 'petrify', { kind: 'always' }, 'deepest_intruder'),
      rule('hold-them', 'gravity_well', { kind: 'always' }, 'enemy_cluster'),
      rule('overload', 'overload_field', { kind: 'always' }, 'enemy_cluster'),
      rule('frenzy', 'blood_frenzy', { kind: 'always' }, 'ally_cluster'),
      rule('erupt', 'volcanic_eruption', { kind: 'always' }, 'enemy_cluster'),
      rule('bombard', 'meteor_shower', { kind: 'always' }, 'enemy_cluster'),
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
