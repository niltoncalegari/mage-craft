/**
 * Which ability a mage spends, and when (plano v1.3 §3.4).
 *
 * This is the decision the player used to write out as a rule list. It now
 * lives in the mage, and the only thing the player still turns is the stance —
 * so these tests are the specification of what a stance actually buys.
 *
 * Facts are built from a real `World` through `buildFacts` rather than
 * hand-forged, because half of what makes a choice correct is that the selector
 * resolved to a point the caster can actually reach.
 */

import { describe, expect, it } from 'vitest';
import { TEAM_A, TEAM_B, type Mage } from '../entities';
import { Vec2 } from '../Vec2';
import { World } from '../World';
import { buildFacts } from '../strategyFacts';
import { isCondition } from '../abilityPolicy';
import { chooseAbility, HOLD_GUARD, selfFacts } from './kit';

describe('chooseAbility — spending the kit', () => {
  it('picks the ability whose moment has come, at the point its selector names', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));

    const intent = chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric));

    // Bênção is the only one of the three whose `when` holds on a healthy
    // squad: the other two are guarded on somebody being hurt.
    expect(intent?.spellId).toBe('blessing');
    expect(intent?.position).toEqual(new Vec2(-10, 1));
  });

  /**
   * Cost is the only ranking the catalog already carries, and it is the one the
   * player's own program used to imply by rule order. A mage that spent the
   * cheap skill first would burn its GCD on Bênção while the squad it was meant
   * to save stood in the fire.
   */
  it('spends the most expensive skill whose moment has come', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const hurt = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    hurt.health = hurt.maxHealth * 0.5;

    // All three of the Cleric's skills are legal now: Bênção is unguarded,
    // Solo Consagrado wants an ally under 70%, Brisa wants one under 60%.
    const intent = chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric));

    expect(intent?.spellId).toBe('consecrated_ground');
  });

  it('skips a recharging skill rather than waiting on it', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const hurt = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    hurt.health = hurt.maxHealth * 0.5;

    const slot = cleric.abilities.indexOf('consecrated_ground');
    cleric.abilityCooldowns[slot] = 5;

    // Brisa Rejuvenescedora is next by cost, and it goes *now* — the point of
    // the rule is that the best skill being down does not silence the kit.
    expect(chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric))?.spellId).toBe(
      'rejuvenating_breeze',
    );
  });

  it('holds the whole kit while the mage is inside its own global cooldown', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    cleric.abilityGcd = 0.4;

    expect(chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric))).toBeNull();
  });

  it('refuses a target its arm does not reach', () => {
    const w = new World();
    // Bênção reaches 12m. Two allies 30m apart cluster separately, so the
    // selector resolves — to a point this Cleric cannot cover.
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-30, 0));
    w.summon(TEAM_A, 'stone_golem', new Vec2(-2, 0));
    w.summon(TEAM_A, 'stormcaller', new Vec2(-2, 2));

    const intent = chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric));

    expect(intent).toBeNull();
  });

  it('makes the same choice twice from the same state', () => {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    w.summon(TEAM_B, 'pyromancer', new Vec2(10, 0));

    const facts = buildFacts(w, TEAM_A);
    const first = chooseAbility(cleric, facts, selfFacts(cleric));
    const second = chooseAbility(cleric, facts, selfFacts(cleric));

    expect(second).toEqual(first);
  });
});

/**
 * The stance is the only dial the player still turns during a match's lifetime,
 * so the difference between the three has to be visible in the same situation —
 * these four tests are all one field, read three ways.
 */
describe('chooseAbility — what a stance buys', () => {
  /** A Cleric and a hurt squadmate: `normal` spends Solo Consagrado here. */
  function calmField(): World {
    const w = new World();
    const cleric = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));
    const hurt = w.summon(TEAM_A, 'stone_golem', new Vec2(-10, 2));
    hurt.health = hurt.maxHealth * 0.5;
    cleric.stance = 'hold';
    return w;
  }

  const clericOf = (w: World): Mage => [...w.mages.values()].find((m) => m.rosterId === 'cleric')!;

  it('keeps a held kit quiet while nothing is actually at stake', () => {
    const w = calmField();
    const cleric = clericOf(w);

    // Same board that fires Solo Consagrado on `normal` above. Nothing about
    // the skill changed; the mage is saving it.
    expect(chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric))).toBeNull();
  });

  /**
   * `self_health` is the one fact that belongs to a body rather than to a side,
   * and this is the test that proves it reaches the policy: the squad's health
   * has not moved, only the caster's own.
   */
  it('unseals a held kit once the mage itself is nearly dead', () => {
    const w = calmField();
    const cleric = clericOf(w);
    cleric.health = cleric.maxHealth * 0.4;

    expect(chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric))?.spellId).toBe(
      'consecrated_ground',
    );
  });

  it('unseals a held kit once an enemy is in our ground', () => {
    const w = calmField();
    const cleric = clericOf(w);
    // TEAM_A defends negative x, so this one has crossed the midline.
    w.summon(TEAM_B, 'pyromancer', new Vec2(-6, 0));

    expect(chooseAbility(cleric, buildFacts(w, TEAM_A), selfFacts(cleric))?.spellId).toBe(
      'consecrated_ground',
    );
  });

  /**
   * The whole of the difference between `normal` and `aggressive`: one waits
   * for the shot to be worth the charge, the other does not.
   */
  /**
   * The guard is hand-written rather than authored in `balance.json`, so it
   * misses the catalog check in `kits.test.ts`. TypeScript keeps its shape
   * honest but cannot stop it naming `mana`, which has had no source since
   * §3.3 — and a `hold` squad guarded on a dead fact would be a squad that
   * never casts at all.
   */
  it('writes its guard in a vocabulary a mage can actually read', () => {
    expect(isCondition(HOLD_GUARD)).toBe(true);
  });

  it('lets an aggressive mage spend a skill on a target normal would not', () => {
    const w = new World();
    const alone = w.summon(TEAM_A, 'cleric', new Vec2(-10, 0));

    // Bênção wants two bodies in the cluster and there is only one.
    expect(chooseAbility(alone, buildFacts(w, TEAM_A), selfFacts(alone))).toBeNull();

    alone.stance = 'aggressive';
    expect(chooseAbility(alone, buildFacts(w, TEAM_A), selfFacts(alone))?.spellId).toBe('blessing');
  });
});
