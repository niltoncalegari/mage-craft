/**
 * The player's caster (GDD §7, §13).
 *
 * Since the idle pivot nobody plays cards by hand, so something has to sit
 * where the hand used to be. That something is this: it reads the program the
 * player authored before the match and answers the same question `Commander`
 * answers for a bot seat — which card, and where.
 *
 * It deliberately implements `Commander`'s signature exactly, because that is
 * what makes the pivot cheap: `Session` and `LocalSession` already drive a
 * caster this shape, and a player's program is simply another implementation
 * of it. `Commander` stays alive for bot seats and as the fallback if a
 * hand-authored default ever beats the heuristic one.
 *
 * Two things it does not do, both on purpose:
 *
 * - **It never mutates the world.** The caller casts, exactly as with
 *   `Commander`, which is what keeps it usable from a headless harness.
 * - **It never draws randomness.** The server shares one `Rng` between Brain,
 *   both deck shuffles and the bot Commander, so a caster that drew from it
 *   would make editing a rule list change how the mages fight. There is no
 *   difficulty knob here either: a program's quality is the program.
 */

import type { Deck } from '../Deck';
import type { Team } from '../entities';
import { buildFacts } from '../strategyFacts';
import { evaluateStrategy, type Strategy, type StrategyDecision } from '../strategy';
import type { World } from '../World';
import type { CastIntent } from './Commander';
import type { SquadPlan } from './Squad';

/**
 * Seconds between evaluations.
 *
 * This is a cost cap, not a fairness one — fairness is `SPELL_GLOBAL_COOLDOWN`
 * inside `World.castSpell`, which every caster including the human path goes
 * through. Sitting well under that cooldown means thinking less often can
 * never cost the player a cast, while `buildFacts` runs four times a second
 * per team instead of sixty.
 */
export const EVALUATE_INTERVAL = 0.25;

export class Tactician {
  private timer = EVALUATE_INTERVAL;
  private last: StrategyDecision | null = null;

  constructor(private readonly strategy: Strategy) {}

  /**
   * The cast to perform this tick, or null. Same contract as
   * `Commander.step`: the caller is responsible for `World.castSpell` and for
   * cycling the deck afterwards.
   *
   * `plan` comes from `Brain.planner` when there is one. Without it the
   * posture condition and the squad-relative selectors simply never resolve,
   * which reads as "those rules do not fire" rather than as an error.
   */
  step(w: World, team: Team, deck: Deck, dt: number, plan?: SquadPlan): CastIntent | null {
    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = EVALUATE_INTERVAL;

    const facts = buildFacts(w, team, plan);
    this.last = evaluateStrategy(this.strategy, facts, { hand: deck.hand(), mana: w.manaOf(team) });

    return this.last ? { cardId: this.last.cardId, position: this.last.position } : null;
  }

  /**
   * The rule the last evaluation settled on, or null when none applied.
   *
   * This is the idle player's only in-match feedback: they did not click, so
   * without being told which of their rules fired and why, a match is
   * something that happens near them rather than something they authored.
   */
  get lastDecision(): StrategyDecision | null {
    return this.last;
  }
}
