/**
 * The behaviours a card can have that are not "apply a status effect".
 *
 * Riders are registered rather than switched on, which is what lets `spells.ts`
 * reject a typo at module load — so the thing worth testing here is that each
 * registered name actually *does* something, and does it to the right people. A
 * rider that quietly no-ops is the exact failure the registry exists to make
 * impossible, and it is invisible in a match nobody is watching closely.
 */

import { describe, expect, it } from 'vitest';
import { applyEffect, hasEffect, magnitudeOf } from './effects';
import { TEAM_A, TEAM_B } from './entities';
import { isSpellRider } from './spellRiders';
import { Vec2 } from './Vec2';
import { World } from './World';

describe('spell riders', () => {
  it('registers the riders the catalog names, and nothing else', () => {
    expect(isSpellRider('puddle')).toBe(true);
    expect(isSpellRider('strike')).toBe(true);
    expect(isSpellRider('dispel')).toBe(true);
    expect(isSpellRider('teleport')).toBe(false);
  });

  /**
   * Clarão Nulo, and the first card in the game whose value is entirely a
   * function of what the *opponent* did. Every other card is worth the same
   * whether it is cast into a fresh squad or a fought-over one; this one is
   * worth nothing until they have spent mana, and then it is worth whatever
   * they spent.
   *
   * It catches both squads, which is what makes it a card rather than a
   * button: the flash undoes **what the other side did**, so it takes the
   * enemy's shields off and takes your own squad's roots off in the same beat.
   * Fired into a scrum where both teams have committed, it is a bet on whose
   * buffs were worth more — and firing it into a fresh fight does nothing at
   * all, which is the decision the rule has to learn to wait for.
   */
  describe('dispel', () => {
    it('strips what is helping the enemy, and leaves what is hurting them', () => {
      const w = new World();
      const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));
      applyEffect(victim, { kind: 'shield', magnitude: 60, duration: 6 });
      applyEffect(victim, { kind: 'haste', magnitude: 0.4, duration: 5 });
      applyEffect(victim, { kind: 'slow', magnitude: 0.5, duration: 4 });
      applyEffect(victim, { kind: 'burn', duration: 4, tickInterval: 0.5, tickDamage: 4 });

      w.castSpell(TEAM_A, 'null_flash', victim.position);

      expect(hasEffect(victim, 'shield')).toBe(false);
      expect(hasEffect(victim, 'haste')).toBe(false);
      expect(hasEffect(victim, 'slow')).toBe(true);
      expect(hasEffect(victim, 'burn')).toBe(true);
    });

    it('does the opposite to the squad that cast it', () => {
      const w = new World();
      const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
      applyEffect(ally, { kind: 'shield', magnitude: 60, duration: 6 });
      applyEffect(ally, { kind: 'slow', magnitude: 0.5, duration: 4 });
      applyEffect(ally, { kind: 'root', duration: 2 });

      w.castSpell(TEAM_A, 'null_flash', ally.position);

      expect(hasEffect(ally, 'slow')).toBe(false);
      expect(hasEffect(ally, 'root')).toBe(false);
      expect(hasEffect(ally, 'shield')).toBe(true);
    });

    /**
     * A stunned mage is rooted by `Mage.stunTimer`, not by the effect — the
     * effect is the readout and the timer is what `updateMage` reads. A dispel
     * that took only the effect would leave a mage standing there unable to
     * move with nothing on screen saying why, which is the same bug the cast
     * path already had to fix in the other direction.
     */
    it('lets go of the body, not just of the label', () => {
      const w = new World();
      const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0));
      w.castSpell(TEAM_B, 'thunderstrike', ally.position);
      expect(ally.stunTimer).toBeGreaterThan(0);

      w.castSpell(TEAM_A, 'null_flash', ally.position);

      expect(hasEffect(ally, 'stun')).toBe(false);
      expect(ally.stunTimer).toBe(0);
    });
  });

  /**
   * `strike` is the first card damage in the game that is not a hazard ticking
   * underfoot. Praga and Chuva de Meteoros hurt you for standing somewhere;
   * this hurts you for having been there when it landed, which is a different
   * card and needs a different rider.
   */
  it('deals its damage once, to the enemies it caught and to nobody else', () => {
    const w = new World();
    const caught = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));
    const spared = w.summon(TEAM_B, 'pyromancer', new Vec2(10, 0));
    const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(-10, 0.4));

    const before = caught.health;
    w.castSpell(TEAM_A, 'thunderstrike', caught.position);

    expect(caught.health).toBeLessThan(before);
    expect(spared.health).toBe(spared.maxHealth);
    expect(ally.health).toBe(ally.maxHealth);
  });

  /**
   * A stun applied by a card has to root the body the same way a Stormcaller's
   * third hit does. `Mage.stunTimer` is what `updateMage` actually reads, and
   * the element path mirrors the effect onto it — a spell that set only the
   * effect would show the motes over the head and let the mage keep walking.
   */
  it('mirrors a cast stun onto the timer the world actually reads', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(-10, 0));

    w.castSpell(TEAM_A, 'thunderstrike', victim.position);

    expect(magnitudeOf(victim, 'stun')).toBeGreaterThanOrEqual(0);
    expect(victim.stunTimer).toBeGreaterThan(0);
  });
});
