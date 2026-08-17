/**
 * Whether a mage goes along with what its squad decided to shoot.
 *
 * Split out of `Brain.perceive` for the reason the renderer splits
 * `planColumnFall` out of the particle code: the half that is a *rule* can be
 * checked directly, and the half that is behaviour can only be watched. What a
 * bot ends up aiming at in a given tick depends on its cooldown, its decision
 * timer, how close it is standing and whether it felt like dodging — none of
 * which this question is about.
 *
 * The rule is the bot's only teamwork. `chooseFocusTarget` names one enemy per
 * team — hurt, visible, close — and everyone who can reasonably reach it shoots
 * that one instead of whatever happens to be nearest. It is why anybody ever
 * dies: four mages each answering their own nearest body are four squads of
 * one, spreading damage over four health bars and finishing none of them.
 */

export interface FocusChoice {
  /** No focus target, or none this mage can see, is an easy no. */
  readonly focusVisible: boolean;
  /** Squared distances, as `perceive` has them — no square roots on this path. */
  readonly focusDistSq: number;
  readonly nearestDistSq: number;
  readonly engageRangeSq: number;
  /**
   * Paranoia. A confused mage does not stop shooting — it stops *agreeing*,
   * which is a different card from a stun and has to stay one: the squad keeps
   * its plan and this one wanders off it.
   */
  readonly confused: boolean;
}

/**
 * The 1.8x rule, inherited from the client's `AISystem.perceive`: follow the
 * squad's target when it is already in throwing range, or when going for it
 * instead of the nearest body is not much of a detour. The ratio is what stops
 * a squad walking past a mage standing on top of them to answer a focus call
 * from across the arena.
 */
export function prefersSquadFocus(c: FocusChoice): boolean {
  if (!c.focusVisible || c.confused) return false;
  return c.focusDistSq <= c.engageRangeSq || c.focusDistSq <= c.nearestDistSq * 1.8;
}
