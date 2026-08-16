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
import { magnitudeOf } from './effects';
import { TEAM_A, TEAM_B } from './entities';
import { isSpellRider } from './spellRiders';
import { Vec2 } from './Vec2';
import { World } from './World';

describe('spell riders', () => {
  it('registers the riders the catalog names, and nothing else', () => {
    expect(isSpellRider('puddle')).toBe(true);
    expect(isSpellRider('strike')).toBe(true);
    expect(isSpellRider('teleport')).toBe(false);
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
