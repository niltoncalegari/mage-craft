import { describe, expect, it } from 'vitest';
import { SPELL_GLOBAL_COOLDOWN } from '../../sim/config';
import { ALL_SPELLS, spellFor } from '../../sim/spells';
import { DEFAULT_SPELL_SFX, ENEMY_CAST_GAIN, SPELL_SFX, spellSfxFor } from '../engine/spellSfx';
import { planColumnFall } from './columnFall';
import { DEFAULT_SPELL_VFX, SPELL_VFX, spellVfxFor, type SpellShape } from './spellVfx';

/**
 * The catalog and its presentation are edited in different files, by different
 * kinds of change — a card is a `balance.json` entry, its beat is a table in
 * `src/render/`, its sound is a table in `src/engine/`. Nothing in the type
 * system connects the three, and the failure mode when they drift is the
 * quietest one this game has: the card works, the rule fires, the trace panel
 * names it, and **nothing appears on the field**. In a game the player only
 * watches, that is indistinguishable from a broken rule.
 *
 * So the coupling is asserted here instead — for both tables in one file,
 * because they answer the same question about the same list of cards, and a
 * card that is missing from one is usually missing from the other.
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
const VFX_FALLBACK_BY_DESIGN: readonly string[] = [];

/** The same allowlist for sound, and empty for the same reason. */
const SFX_FALLBACK_BY_DESIGN: readonly string[] = [];

describe('SPELL_VFX covers the catalog', () => {
  it('gives every card its own beat, or says out loud that it does not', () => {
    const missing = ALL_SPELLS.filter(
      (id) => !(id in SPELL_VFX) && !VFX_FALLBACK_BY_DESIGN.includes(id),
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
 * Sound is newer than the rest of this file by a whole phase, and it starts
 * from further back: until now **spells were silent**. `SpellCast` has been on
 * the event bus since the pivot and nothing was listening, so all seven cards
 * have been landing without a noise since the day they were written.
 *
 * That matters more in an idle match than it would have before. The player is
 * not clicking anything, so sound is half of the confirmation that the program
 * he wrote is alive at all — the other half being the trace panel, which he has
 * to be looking at.
 */
describe('SPELL_SFX covers the catalog', () => {
  it('gives every card its own sound, or says out loud that it does not', () => {
    const missing = ALL_SPELLS.filter((id) => !(id in SPELL_SFX) && !SFX_FALLBACK_BY_DESIGN.includes(id));
    expect(missing).toEqual([]);
  });

  it('has no rows for cards the catalog does not have', () => {
    const orphans = Object.keys(SPELL_SFX).filter((id) => !ALL_SPELLS.includes(id as never));
    expect(orphans).toEqual([]);
  });

  it('never leaves a card with nothing to play', () => {
    for (const id of ALL_SPELLS) {
      const sfx = spellSfxFor(id);
      expect(sfx.layers.length).toBeGreaterThan(0);
      for (const layer of sfx.layers) {
        expect(['tone', 'noise', 'chord']).toContain(layer.kind);
        expect(layer.duration).toBeGreaterThan(0);
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.at).toBeGreaterThanOrEqual(0);
        if (layer.kind === 'chord') expect(layer.freqs.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back for a card this build has never heard of', () => {
    expect(spellSfxFor('vortice_gravitacional')).toBe(DEFAULT_SPELL_SFX);
  });

  it('varies the pitch of every card it repeats', () => {
    // Two Tacticians casting on a 0.75s cooldown for a three-minute match is a
    // few hundred casts, drawn from a deck of eight. A card that plays back
    // identically every time is what makes synthesised audio read as cheap.
    for (const id of ALL_SPELLS) {
      expect(spellSfxFor(id).detune).toBeGreaterThan(0);
      expect(spellSfxFor(id).detune).toBeLessThanOrEqual(0.15);
    }
  });
});

/**
 * The two limits that keep a table of hand-written numbers from becoming a mess
 * nobody can hear through. Both are budget questions rather than correctness
 * ones — which is exactly why they belong in a test: a single card is always
 * defensible on its own, and it is the seventh one that ruins the mix.
 */
describe('a cast fits in the space the game gives it', () => {
  /** Where the last layer of a card's sound stops ringing. */
  function lengthOf(spellId: string): number {
    return spellSfxFor(spellId).layers.reduce((end, layer) => Math.max(end, layer.at + layer.duration), 0);
  }

  it('is over before the same side can cast again', () => {
    // `SPELL_GLOBAL_COOLDOWN` is the fastest a side can fire, so a sound longer
    // than it would stack on its own successor and never resolve — the same
    // number the simulation uses, rather than a guess written down twice.
    for (const id of ALL_SPELLS) {
      expect(lengthOf(id)).toBeLessThanOrEqual(SPELL_GLOBAL_COOLDOWN);
    }
  });

  it('never lets one card shout down the rest of the mix', () => {
    for (const id of ALL_SPELLS) {
      const loudest = spellSfxFor(id).layers.reduce((sum, layer) => sum + layer.gain, 0);
      expect(loudest).toBeLessThanOrEqual(0.3);
    }
  });

  it('places the enemy further away than you, without silencing them', () => {
    // Both casts are the same event on the same field; what separates them is
    // that one of them is *yours*. The white core flash says so on screen and
    // this says so in the mix — but an inaudible enemy cast would hide half the
    // match from a player who is only listening.
    expect(ENEMY_CAST_GAIN).toBeGreaterThan(0.2);
    expect(ENEMY_CAST_GAIN).toBeLessThan(1);
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

/**
 * A `column` card is one that hits from above, and every card that reaches for
 * that shape so far is a *shower*: several impacts scattered over an area, not
 * one shaft down the middle. The first cut drew the shaft, which contradicted
 * both halves of Chuva de Meteoros — its name, and the hazard it leaves (18
 * damage every half second across a radius of five).
 *
 * The shape's own field says how many fall and over how long, and both numbers
 * are held against the card in `balance.json` here, because a shower still
 * raining after its hazard has expired is the same species of lie as a
 * telegraph the simulation does not honour.
 */
describe('a column falls as a shower, not as a shaft', () => {
  const columns = ALL_SPELLS.filter((id) => spellVfxFor(id).shape === 'column');

  it('is the shape Chuva de Meteoros uses', () => {
    expect(columns).toContain('meteor_shower');
  });

  it('never claims to be a shower of one', () => {
    for (const id of columns) {
      expect(spellVfxFor(id).impacts ?? 1).toBeGreaterThan(1);
    }
  });

  it('stops raining before the card it belongs to is over', () => {
    for (const id of columns) {
      const card = spellFor(id);
      expect(card).toBeDefined();
      const window = spellVfxFor(id).impactWindow ?? 0;
      expect(window).toBeGreaterThan(0);
      expect(window).toBeLessThanOrEqual(card!.duration);
    }
  });

  it('scatters across the radius the card actually covers', () => {
    // Not a fraction of it: the hazard ticks over the whole disc, so meteors
    // landing in the middle third would show a smaller card than the one that
    // is hurting people.
    for (const id of columns) {
      const impacts = planColumnFall(24, spellFor(id)!.radius, 1, () => 0.97);
      const furthest = Math.max(...impacts.map((i) => Math.hypot(i.dx, i.dy)));
      expect(furthest).toBeGreaterThan(spellFor(id)!.radius * 0.9);
    }
  });
});
