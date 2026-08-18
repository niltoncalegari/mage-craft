/**
 * The phrasebook shrank to one entry, and this is what still has to hold about
 * it: every selector the sim can send has Portuguese to show for it, and one it
 * cannot send still renders something a player can read.
 *
 * The file used to check keywords, comparators, fact labels and numeric field
 * specs too. Those were vocabulary for the rule editor, and v1.3 retired the
 * editor with the program — the labels went with it rather than being kept
 * warm for a screen nobody can open.
 */

import { describe, expect, it } from 'vitest';
import { ALL_TARGET_SELECTORS } from '../../sim/abilityPolicy';
import { SELECTOR_LABEL, selectorLabel } from './strategyText';

describe('selector labels', () => {
  it('names every selector the simulation can aim with', () => {
    const missing = ALL_TARGET_SELECTORS.filter((s) => !SELECTOR_LABEL[s]);
    expect(missing).toEqual([]);
  });

  it('has no label for a selector that does not exist', () => {
    expect(Object.keys(SELECTOR_LABEL).sort()).toEqual([...ALL_TARGET_SELECTORS].sort());
  });

  /*
   * The HUD reads this off the wire, so the argument is whatever the server
   * said. A build one version behind must not blank the line.
   */
  it('falls back to the raw identifier a newer server might send', () => {
    expect(selectorLabel('a_selector_from_the_future')).toBe('a_selector_from_the_future');
  });

  it('translates a selector it does know', () => {
    expect(selectorLabel('enemy_cluster')).toBe('aglomerado inimigo');
  });
});
