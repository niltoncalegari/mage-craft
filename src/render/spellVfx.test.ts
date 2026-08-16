import { describe, expect, it } from 'vitest';
import { ALL_SPELLS, spellFor } from '../../sim/spells';
import { DEFAULT_SPELL_VFX, SPELL_VFX, spellVfxFor, type SpellShape } from './spellVfx';

/**
 * The catalog and its look are edited in two different files, by two different
 * kinds of change — a card is a `balance.json` entry, its beat is a table in
 * `src/render/`. Nothing in the type system connects them, and the failure mode
 * when they drift is the quietest one this game has: the card works, the rule
 * fires, the trace panel names it, and **nothing appears on the field**. In a
 * game the player only watches, that is indistinguishable from a broken rule.
 *
 * So the coupling is asserted here instead.
 */

const KNOWN_SHAPES: readonly SpellShape[] = ['burst', 'dome', 'column', 'torus'];

/**
 * Cards that are meant to fall through to {@link DEFAULT_SPELL_VFX}.
 *
 * Empty today, and that is the useful state: every card in the catalog has been
 * looked at. It exists so that "this card has no beat yet" has to be *written
 * down* when the Tier 2/3 cards land one commit at a time — the alternative is
 * a card that silently inherits the generic violet burst and ships that way
 * because nobody noticed it never got its own row.
 */
const FALLBACK_BY_DESIGN: readonly string[] = [];

describe('SPELL_VFX covers the catalog', () => {
  it('gives every card its own beat, or says out loud that it does not', () => {
    const missing = ALL_SPELLS.filter(
      (id) => !(id in SPELL_VFX) && !FALLBACK_BY_DESIGN.includes(id),
    );
    expect(missing).toEqual([]);
  });

  it('has no rows for cards the catalog does not have', () => {
    const orphans = Object.keys(SPELL_VFX).filter((id) => !ALL_SPELLS.includes(id as never));
    expect(orphans).toEqual([]);
  });

  it('never leaves a card with nothing to draw', () => {
    for (const id of ALL_SPELLS) {
      const vfx = spellVfxFor(id);
      expect(KNOWN_SHAPES).toContain(vfx.shape);
      expect(vfx.moteCount).toBeGreaterThan(0);
      expect(vfx.motes.length).toBeGreaterThan(0);
    }
  });

  it('falls back for a card this build has never heard of', () => {
    expect(spellVfxFor('vortice_gravitacional')).toBe(DEFAULT_SPELL_VFX);
  });
});

/**
 * `telegraph` (renderer) and `delay` (sim) are two numbers, in two repos-worth
 * of different files, that have to be the same number. The card that breaks the
 * contract does not crash: it deals its damage some time after the warning
 * stops, or with no warning at all, and reads as damage out of nowhere.
 *
 * No Tier 1 card is delayed, so the forward direction is vacuous right now —
 * **that is what this pair of assertions is for.** It is a trap set for the
 * Tier 2 cards that bring the `delayed` rider (Erupção Vulcânica, Chuva de
 * Meteoros): the day one of them gets a `delay` in `balance.json` without a
 * matching `telegraph`, this goes red. The backward direction is not vacuous
 * and never was — it forbids a warning the simulation does not actually honour,
 * which is the same lie told from the other side.
 */
describe('telegraph matches the delay it is warning about', () => {
  /**
   * The sim has no `delayed` rider yet, so `SpellApplyRule` has no `delay`
   * field to read — adding one to the schema before anything honours it would
   * be worse than this cast, because a card could then set it and be silently
   * ignored by the sim. The name is the contract; the rider that arrives with
   * Tier 2 has to use it.
   */
  function delayOf(spellId: string): number {
    const card = spellFor(spellId);
    if (!card) return 0;
    let longest = 0;
    for (const app of card.apply) {
      const delay = (app as { delay?: number }).delay ?? 0;
      if (delay > longest) longest = delay;
    }
    return longest;
  }

  it('warns for exactly as long as the card takes to land', () => {
    for (const id of ALL_SPELLS) {
      const delay = delayOf(id);
      if (delay <= 0) continue;
      expect(spellVfxFor(id).telegraph ?? 0).toBe(delay);
    }
  });

  it('never promises a warning the simulation does not honour', () => {
    for (const id of ALL_SPELLS) {
      const telegraph = spellVfxFor(id).telegraph ?? 0;
      if (telegraph <= 0) continue;
      expect(delayOf(id)).toBe(telegraph);
    }
  });
});

describe('trauma stays inside what a watched game can take', () => {
  /*
   * The ceiling is a design limit, not a technical one. `ShakeRig` clamps
   * accumulated trauma at 1 by itself; what this guards is a single *card*
   * being allowed to spend a large fraction of that budget. The player is
   * reading the field to see his program react — a camera that lurches on a
   * cast hides the cluster the next rule is about to be evaluated against.
   */
  it('keeps any one cast well under a full shake', () => {
    for (const id of ALL_SPELLS) {
      const trauma = spellVfxFor(id).trauma ?? 0;
      expect(trauma).toBeGreaterThanOrEqual(0);
      expect(trauma).toBeLessThanOrEqual(0.4);
    }
  });

  it('spends it on the heavy cards only', () => {
    const shaking = ALL_SPELLS.filter((id) => (spellVfxFor(id).trauma ?? 0) > 0);
    expect(shaking).toEqual(['meteor_shower']);
  });
});
