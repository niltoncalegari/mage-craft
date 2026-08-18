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
import { TEAM_A, TEAM_B, type Mage, type Team } from './entities';
import { isSpellRider } from './spellRiders';
import { Vec2 } from './Vec2';
import { World } from './World';

describe('spell riders', () => {
  it('registers the riders the catalog names, and nothing else', () => {
    expect(isSpellRider('puddle')).toBe(true);
    expect(isSpellRider('strike')).toBe(true);
    expect(isSpellRider('dispel')).toBe(true);
    expect(isSpellRider('knockback')).toBe(true);
    expect(isSpellRider('tribute')).toBe(true);
    expect(isSpellRider('rally')).toBe(true);
    expect(isSpellRider('attune')).toBe(true);
    expect(isSpellRider('teleport')).toBe(false);
  });

  /**
   * Fluxo de Mana, re-pointed (plano v1.3 §3.3). Tributo Obscuro buys tempo
   * with health, all at once; this buys it with *time*, which is the other half
   * of the same idea and the reason blue and black both get an economy card
   * instead of one of them getting the only one.
   *
   * What it buys changed, not what it is: the team bar is gone, so the card now
   * turns the whole side's kits around faster for as long as it lasts. It is
   * still the one card in the catalog that is worse the later it is cast.
   */
  describe('attune', () => {
    /** Seconds of charge a Stormcaller burns off Sobrecarga in one second. */
    function rechargedInOneSecond(cast: (w: World, caster: Mage) => void): number {
      const w = new World();
      const caster = w.summon(TEAM_A, 'stormcaller', new Vec2(0, 0));
      w.summon(TEAM_A, 'pyromancer', new Vec2(0, 1));
      expect(w.castAbility(caster.id, 'overload_field', new Vec2(0, 0.5)).ok).toBe(true);
      const spent = w.abilityCooldownOf(caster.id, 'overload_field');

      cast(w, caster);
      w.step(1);

      return spent - w.abilityCooldownOf(caster.id, 'overload_field');
    }

    it('turns the side’s kits around faster than ordinary time', () => {
      const flowing = rechargedInOneSecond((w, caster) => {
        w.castSpell(caster.team, 'mana_flow', new Vec2(0, 0.5));
      });

      expect(flowing).toBeGreaterThan(1);
    });

    /**
     * A card cast where none of your squad is standing does nothing at all,
     * which is what keeps an economy card on the map. Without it, a mage could
     * fire it at a fixed spot for a whole match and never look at the field.
     */
    it('needs somebody to channel through', () => {
      const nobody = rechargedInOneSecond((w, caster) => {
        w.castSpell(caster.team, 'mana_flow', new Vec2(0, 14));
      });

      expect(nobody).toBeCloseTo(1, 5);
    });

    it('lets go when the flow runs out', () => {
      const w = new World();
      const caster = w.summon(TEAM_A, 'stormcaller', new Vec2(0, 0));
      w.summon(TEAM_A, 'pyromancer', new Vec2(0, 1));
      w.castSpell(TEAM_A, 'mana_flow', new Vec2(0, 0.5));

      // Fluxo runs 6s. Step well past it before spending anything, so the
      // charge measured below has only ever seen ordinary time.
      for (let t = 0; t < 8; t += 0.5) w.step(0.5);
      expect(w.castAbility(caster.id, 'overload_field', new Vec2(0, 0.5)).ok).toBe(true);
      const spent = w.abilityCooldownOf(caster.id, 'overload_field');
      w.step(1);

      expect(spent - w.abilityCooldownOf(caster.id, 'overload_field')).toBeCloseTo(1, 5);
    });
  });

  /**
   * Chamado à Batalha, and the only card in the catalog that is addressed to
   * mages who are not on the field.
   *
   * Death costs presence, not the mage (GDD §4), so the six seconds a squad
   * spends one body down is the largest swing in the game that no card could
   * previously argue with. This one argues with it — at the place they fell,
   * which is what keeps it a positional card rather than a button that is
   * always correct the moment anybody dies.
   */
  describe('rally', () => {
    function killAt(w: World, team: Team, at: Vec2): Mage {
      const m = w.summon(team, 'pyromancer', at);
      w.dealDamage(m, m.maxHealth * 2, {});
      return m;
    }

    it('brings back the bodies lying where it was cast, and not the ones elsewhere', () => {
      const w = new World();
      const near = killAt(w, TEAM_A, new Vec2(0, 0));
      const far = killAt(w, TEAM_A, new Vec2(0, 14));

      w.castSpell(TEAM_A, 'call_to_battle', new Vec2(0, 0));

      expect(near.respawnTimer).toBeLessThan(far.respawnTimer);
    });

    /**
     * The trap, and it is not the obvious one. `updateMage` only decays a
     * respawn timer it finds **above zero** — a timer cut to exactly 0 is never
     * decayed, so it never reaches the branch that puts the mage back on the
     * field. A card meant to shorten a death would have made it permanent, and
     * only for the mages it helped the most.
     */
    it('never cuts a death so short that it stops ending', () => {
      const w = new World();
      const fallen = killAt(w, TEAM_A, new Vec2(0, 0));
      // Wait until what is left is less than the card takes off.
      for (let t = 0; t < 4; t += 1 / 60) w.step(1 / 60);
      expect(fallen.respawnTimer).toBeGreaterThan(0);

      w.castSpell(TEAM_A, 'call_to_battle', new Vec2(0, 0));
      for (let t = 0; t < 0.5; t += 1 / 60) w.step(1 / 60);

      expect(fallen.alive).toBe(true);
    });

    it('leaves the enemy dead where they are', () => {
      const w = new World();
      const theirs = killAt(w, TEAM_B, new Vec2(0, 0));
      const before = theirs.respawnTimer;

      w.castSpell(TEAM_A, 'call_to_battle', new Vec2(0, 0));

      expect(theirs.respawnTimer).toBe(before);
    });
  });

  /**
   * Tributo Obscuro, re-pointed the same way, and black's whole argument in one
   * card: the only tempo in the game that does not come from waiting.
   *
   * Charges come back on a fixed clock for both sides (§3.3), so no squad can
   * be *ahead* on tempo — only better at spending it. This one buys a cast out
   * of turn and pays for it in its own squad's health.
   *
   * It pays the *body* that cast it rather than the side, which is the one real
   * difference from the mana version: a bar could be filled by anyone, and a
   * charge belongs to whoever is waiting on it.
   */
  describe('tribute', () => {
    it('pays the caster in charge and the squad in blood', () => {
      const w = new World();
      const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(0, 0));
      const ally = w.summon(TEAM_A, 'pyromancer', new Vec2(0, 1));
      expect(w.castAbility(alchemist.id, 'plague', new Vec2(0, 0.5)).ok).toBe(true);
      const spent = w.abilityCooldownOf(alchemist.id, 'plague');
      w.step(1);

      expect(w.castAbility(alchemist.id, 'dark_tribute', new Vec2(0, 0.5)).ok).toBe(true);

      expect(alchemist.health).toBeLessThan(alchemist.maxHealth);
      expect(ally.health).toBeLessThan(ally.maxHealth);
      // A second of ordinary decay plus the refund the two bodies bled for.
      expect(w.abilityCooldownOf(alchemist.id, 'plague')).toBeLessThan(spent - 1);
    });

    it('pays per body, so a scattered squad is a bad trade', () => {
      const refund = (allies: number): number => {
        const w = new World();
        const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(0, 0));
        for (let i = 1; i < allies; i++) w.summon(TEAM_A, 'pyromancer', new Vec2(0, i * 0.6));
        expect(w.castAbility(alchemist.id, 'plague', new Vec2(0, 0.3)).ok).toBe(true);
        const spent = w.abilityCooldownOf(alchemist.id, 'plague');
        w.step(1);
        expect(w.castAbility(alchemist.id, 'dark_tribute', new Vec2(0, 0.3)).ok).toBe(true);
        return spent - w.abilityCooldownOf(alchemist.id, 'plague');
      };

      expect(refund(3)).toBeGreaterThan(refund(1));
    });

    it('never pushes a charge past ready', () => {
      const w = new World();
      const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(0, 0));
      for (let i = 1; i < 4; i++) w.summon(TEAM_A, 'pyromancer', new Vec2(0, i * 0.6));

      expect(w.castAbility(alchemist.id, 'dark_tribute', new Vec2(0, 0.9)).ok).toBe(true);

      expect(w.abilityCooldownOf(alchemist.id, 'plague')).toBe(0);
    });

    it('takes nothing from the other squad, in either direction', () => {
      const w = new World();
      const enemy = w.summon(TEAM_B, 'alchemist', new Vec2(0, 0));
      expect(w.castAbility(enemy.id, 'plague', new Vec2(0, 0)).ok).toBe(true);
      const theirs = w.abilityCooldownOf(enemy.id, 'plague');

      const alchemist = w.summon(TEAM_A, 'alchemist', new Vec2(0, 0.5));
      w.summon(TEAM_A, 'pyromancer', new Vec2(0, 0.6));
      expect(w.castAbility(alchemist.id, 'dark_tribute', new Vec2(0, 0.55)).ok).toBe(true);

      expect(enemy.health).toBe(enemy.maxHealth);
      expect(w.abilityCooldownOf(enemy.id, 'plague')).toBe(theirs);
    });
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

/**
 * Erupção Vulcânica, and the first card in the game that does not land when it
 * is cast.
 *
 * `delay` is a field on the application rather than a rider of its own,
 * because *anything* a card does can be worth postponing — damage, a shove, a
 * burn — and a rider would have had to be told what to run afterwards. It is
 * also the half of a contract whose other half has been sitting in
 * `spellVfx.ts` since the VFX pass: `telegraph` is the seconds of warning drawn
 * on the ground, and `spellVfx.test.ts` asserts the two numbers are equal in
 * both directions. Until this card there was nothing on the sim side to be
 * equal to.
 */
describe('a delayed card', () => {
  function stepFor(w: World, seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60);
  }

  it('does nothing at all on the tick it is cast', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));

    w.castSpell(TEAM_A, 'volcanic_eruption', victim.position);

    expect(victim.health).toBe(victim.maxHealth);
    expect(hasEffect(victim, 'burn')).toBe(false);
  });

  it('lands once the warning is over', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));

    w.castSpell(TEAM_A, 'volcanic_eruption', victim.position);
    stepFor(w, 1.5);

    expect(victim.health).toBeLessThan(victim.maxHealth);
    expect(hasEffect(victim, 'burn')).toBe(true);
  });

  /**
   * The reason a telegraph is worth drawing at all. A delayed card that
   * remembered who it caught at cast time would be an instant card with a
   * decorative wind-up — the warning on the ground would be telling the player
   * something he cannot act on, which is worse than not drawing it.
   */
  it('catches who is standing there when it goes off, not who was there when it was cast', () => {
    const w = new World();
    const fled = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));
    const stayed = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 1));

    w.castSpell(TEAM_A, 'volcanic_eruption', new Vec2(0, 0));
    fled.position = new Vec2(10, 0);
    stepFor(w, 1.5);

    expect(fled.health).toBe(fled.maxHealth);
    expect(stayed.health).toBeLessThan(stayed.maxHealth);
  });

  /**
   * The failure a queue makes cheap: an entry that fires without being removed
   * erupts *every tick* from then on, which kills the whole squad in about a
   * second and looks like a damage bug rather than a bookkeeping one. Every
   * other test here passes while that is happening.
   */
  it('fires once, not once per tick', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 0));

    w.castSpell(TEAM_A, 'volcanic_eruption', victim.position);
    stepFor(w, 5);

    expect(victim.alive).toBe(true);
    // One eruption is the hit plus the whole burn; anything past that is the
    // card going off more than once.
    expect(victim.health).toBeGreaterThan(victim.maxHealth - 70);
  });

  /**
   * The shove is what makes the card read as an *eruption* rather than as a
   * slow fireball: bodies leave the disc outward, which is also the only reason
   * a squad that survived it is no longer standing where their program put
   * them.
   */
  it('throws what it caught away from the middle', () => {
    const w = new World();
    const victim = w.summon(TEAM_B, 'pyromancer', new Vec2(0, 2));

    w.castSpell(TEAM_A, 'volcanic_eruption', new Vec2(0, 0));
    // Far enough past the delay for the shove to have moved the body, and
    // still inside the hit stun it slides during.
    stepFor(w, 1.5);

    expect(victim.position.y).toBeGreaterThan(2.05);
  });
});
