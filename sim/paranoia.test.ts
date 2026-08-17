/**
 * Paranoia at the seam where it is visible: a bot with two enemies in front of
 * it, one closer and one the squad has decided to finish.
 *
 * The rule itself is `prefersSquadFocus` and is tested directly in
 * `bot/focus.test.ts` — this is the other half, and it asks the only question
 * a unit test of a pure predicate cannot: that the card reaches the Brain at
 * all. A `confused` effect that nothing consulted would pass every test in that
 * file and do nothing whatsoever in a match.
 *
 * Read through `input.aim`, which is a world-space point and the only public
 * trace of which enemy a mage settled on. It is deliberately asserted narrowly:
 * whether a bot is aiming at any given tick depends on its cooldown, its
 * decision timer and how close it is standing, none of which this card is about.
 */

import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { hasEffect } from './effects';
import { TEAM_A, TEAM_B, type Mage } from './entities';
import { Rng } from './rng';
import { Vec2 } from './Vec2';
import { World } from './World';

/**
 * The closer enemy is at 1.6 and the badly hurt one at 2.4, which is inside the
 * 1.8x detour the focus rule allows — so which one the bot picks is genuinely
 * the focus mechanism's decision and not distance wearing its coat.
 */
function standoff(confused: boolean): { bot: Mage; near: Mage; hurt: Mage } {
  const w = new World();
  const bot = w.summon(TEAM_A, 'pyromancer', new Vec2(0, 0));
  const near = w.summon(TEAM_B, 'pyromancer', new Vec2(1.6, 0));
  const hurt = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 2.4));
  w.dealDamage(hurt, hurt.maxHealth * 0.8, {});
  if (confused) w.castSpell(TEAM_B, 'paranoia', bot.position);

  const brain = new Brain(new Rng(1));
  const units = new Map<string, Difficulty>([[bot.id, 'normal']]);
  for (let i = 0; i < 6; i++) {
    brain.step(w, units, 1 / 60);
    w.step(1 / 60);
  }
  return { bot, near, hurt };
}

describe('paranoia reaches the bot that has it', () => {
  it('leaves an untroubled mage shooting what the squad picked', () => {
    const { bot, near, hurt } = standoff(false);

    expect(bot.input.aim.distanceTo(hurt.position)).toBeLessThan(0.5);
    expect(bot.input.aim.distanceTo(near.position)).toBeGreaterThan(1);
  });

  it('takes a paranoid mage off the squad target', () => {
    const { bot, hurt } = standoff(true);

    expect(bot.input.aim.distanceTo(hurt.position)).toBeGreaterThan(0.5);
  });

  it('is a curse on the enemy, applied to everyone the cast caught', () => {
    const w = new World();
    const caught = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));
    const spared = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 14));
    const ours = w.summon(TEAM_A, 'pyromancer', new Vec2(0, 0.5));

    w.castSpell(TEAM_A, 'paranoia', new Vec2(0, 0));

    expect(hasEffect(caught, 'confused')).toBe(true);
    expect(hasEffect(spared, 'confused')).toBe(false);
    expect(hasEffect(ours, 'confused')).toBe(false);
  });
});
