import { describe, expect, it } from 'vitest';
import { prefersSquadFocus, type FocusChoice } from './focus';

const ENGAGE_SQ = 36;

function choice(over: Partial<FocusChoice> = {}): FocusChoice {
  return {
    focusVisible: true,
    focusDistSq: 25,
    nearestDistSq: 16,
    engageRangeSq: ENGAGE_SQ,
    confused: false,
    ...over,
  };
}

describe('following the squad', () => {
  it('goes with the focus when it is already in range', () => {
    expect(prefersSquadFocus(choice({ focusDistSq: 25, nearestDistSq: 1 }))).toBe(true);
  });

  it('goes with the focus out of range when it is barely a detour', () => {
    expect(prefersSquadFocus(choice({ focusDistSq: 49, nearestDistSq: 36 }))).toBe(true);
  });

  /**
   * The ratio is what stops a squad walking past somebody standing on top of
   * them to answer a call from across the arena.
   */
  it('answers what is in front of it when the focus is far off', () => {
    expect(prefersSquadFocus(choice({ focusDistSq: 400, nearestDistSq: 4 }))).toBe(false);
  });

  it('cannot follow a target it cannot see', () => {
    expect(prefersSquadFocus(choice({ focusVisible: false, focusDistSq: 1 }))).toBe(false);
  });

  /**
   * Paranoia, and the whole of it: the mage is still shooting, still in range,
   * still has line of sight — and no longer does what the squad agreed. That it
   * overrides even a focus target standing right there is deliberate; a
   * confusion a good position could argue with would be a card that does
   * nothing in the fights that matter.
   */
  it('never follows the squad while it is paranoid', () => {
    expect(prefersSquadFocus(choice({ confused: true }))).toBe(false);
    expect(prefersSquadFocus(choice({ confused: true, focusDistSq: 0, nearestDistSq: 400 }))).toBe(false);
  });
});
