/**
 * Spell riders: the things a card can do that are not "apply a status effect".
 *
 * The catalog is data (`spells.ts`), and most of a card is covered by
 * `effects.ts` — slow somebody, shield somebody, burn somebody. What is left
 * are the behaviours that touch the world itself: leaving a hazard on the
 * ground, moving a body, stripping what is already running. Those live here,
 * one entry per behaviour, so growing the catalog stays a `balance.json` edit
 * and only a genuinely new *kind* of behaviour costs code.
 *
 * This is the same split `World.applyOnHit` already makes for elements. The
 * difference is only that riders are registered rather than switched on, which
 * is what lets `spells.ts` validate a card at module load: a rider name that
 * is not in this table is a typo, and a typo that silently becomes a no-op is
 * the most expensive kind of bug in a data-driven catalog.
 */

import type { SpellApplyRule } from './balance';
import { polarityOf } from './effects';
import type { Mage, Team } from './entities';
import type { SpellCard } from './spells';
import type { Vec2 } from './Vec2';
import type { World } from './World';

/** What a rider is handed: the cast, and who it caught. */
export interface SpellRiderContext {
  readonly team: Team;
  readonly spell: SpellCard;
  readonly app: SpellApplyRule;
  readonly position: Vec2;
  /** Empty for a `ground` card, which affects a place rather than people. */
  readonly targets: readonly Mage[];
}

export type SpellRider = (w: World, ctx: SpellRiderContext) => void;

/**
 * Praga and its descendants (GDD §9): a hazard that hurts whoever overlaps it.
 *
 * Ground-targeted, so it ignores `targets` entirely — that is the point. A
 * zone is a bet on where the enemy will be, not on where they are.
 */
const puddle: SpellRider = (w, { spell, app, position }) => {
  w.spawnSpellPuddle(position, {
    spellId: spell.id,
    radius: app.radius ?? spell.radius,
    duration: app.duration ?? spell.duration,
    tickInterval: app.tickInterval ?? 1,
    tickDamage: app.tickDamage ?? 0,
    bypassShield: app.bypassShield ?? false,
  });
};

/**
 * Instant damage to everyone the card caught.
 *
 * The first card damage in the game that is not a hazard underfoot. Praga and
 * Chuva de Meteoros hurt you for *standing* somewhere and tick while you do;
 * this hurts you for having been there at the moment it landed, and then it is
 * over. That is a different card, so it is a different rider rather than a
 * puddle with a one-tick duration — a hazard that expires immediately would
 * still be a hazard, and would still miss anyone who walked in a frame later.
 *
 * Credited to `'spell'` rather than to a mage, the same string Praga's zone
 * uses: no caster is on the field for a card, so `kill` finds nobody to score
 * it and the death goes uncredited instead of to an arbitrary body.
 */
const strike: SpellRider = (w, { app, targets }) => {
  const damage = app.magnitude ?? 0;
  if (damage <= 0) return;
  for (const m of targets) w.dealDamage(m, damage, { attackerId: 'spell' });
};

/**
 * Clarão Nulo: takes away **what the other side did**, to everyone it caught.
 *
 * Direction is per body rather than per card, which is what makes one rider do
 * both halves of the card: an enemy loses their buffs, an ally loses their
 * curses, in the same flash. That is the whole design — it is a bet on whose
 * commitments were worth more at the moment it went off, and it does nothing
 * at all in a fight where nobody has spent anything yet. No other card in the
 * catalog is worth zero on purpose.
 *
 * The polarity itself is a tag in `balance.json` next to each effect's stacking
 * rule, not a list of kinds written down here. A list here would be correct
 * until the next card, and then quietly incomplete: a new kind would simply be
 * un-dispellable, with nothing to notice it by.
 */
const dispel: SpellRider = (_w, { team, targets }) => {
  for (const m of targets) {
    const strip = m.team === team ? 'debuff' : 'buff';
    for (let i = m.effects.length - 1; i >= 0; i--) {
      const kind = m.effects[i].kind;
      if (polarityOf(kind) !== strip) continue;
      m.effects.splice(i, 1);
      // The effect is the readout; `stunTimer` is what actually holds the body
      // (see `applySpellEffect`, which mirrors it on the way in). Lifting one
      // without the other leaves a mage rooted with nothing saying why.
      if (kind === 'stun') m.stunTimer = 0;
    }
  }
};

/**
 * Erupção Vulcânica's shove: everyone it caught leaves the disc outward.
 *
 * Damage-free on purpose, and separate from the `strike` next to it in the
 * same card. Bundling the two would have made "hit them" and "move them" one
 * behaviour that no other card could take half of — and moving a squad is
 * worth something on its own here, because a program that spent four seconds
 * arranging itself around a cluster has to arrange itself again.
 *
 * A mage standing exactly on the centre gets nothing rather than a direction
 * chosen for it. The alternative is picking an angle out of nowhere, which
 * either reads for a `Rng` this rider must not touch or bakes in a compass
 * bearing that would be visible as every eruption throwing bodies the same way.
 */
const knockback: SpellRider = (w, { app, position, targets }) => {
  const magnitude = app.magnitude ?? 0;
  for (const m of targets) w.shove(m, m.position.sub(position), magnitude);
};

/**
 * Tributo Obscuro: mana for blood, `magnitude` of it per body that answered.
 *
 * The first resource trade in the game. Mana arrives on a fixed clock for both
 * sides, so no program has ever been able to get *ahead* on tempo — only to be
 * better at spending what the clock handed it. This card is a program saying
 * "not yet" to that clock, and paying its own squad's health for the privilege.
 *
 * Per body rather than flat, which is what makes it a decision instead of a
 * button: a scattered squad returns less than the card cost to ask, and a squad
 * tight enough to make it pay is a squad tight enough for the enemy's zone
 * cards to be worth their mana too. The damage is a separate `strike` in the
 * same card, so what bleeds and what pays stay two numbers a designer can move
 * independently.
 */
const tribute: SpellRider = (w, { team, app, targets }) => {
  w.grantMana(team, (app.magnitude ?? 0) * targets.length);
};

/**
 * Chamado à Batalha: the dead lying inside the disc get up `magnitude` seconds
 * sooner.
 *
 * The only rider addressed to mages who are not on the field, and so the only
 * one that cannot use `targets` — `spellTargets` filters the dead out, which is
 * right for every other card and exactly wrong for this one. It reads the world
 * directly and matches on where the body fell.
 *
 * That the corpse's position is what qualifies it is the design, not a
 * shortcut. Six seconds a body down is the largest swing in the game no card
 * could argue with (GDD §4), and a card that shortened it from anywhere would
 * be correct the instant anybody died — no read, no timing, no place. Cast over
 * the spot your squad was wiped, it is a comeback; cast anywhere else, it is a
 * haste spell.
 */
const rally: SpellRider = (w, { team, spell, app, position }) => {
  const seconds = app.magnitude ?? 0;
  const radius = app.radius ?? spell.radius;
  for (const m of w.mages.values()) {
    if (m.alive || m.team !== team) continue;
    if (m.position.distanceTo(position) > radius) continue;
    w.hastenRespawn(m, seconds);
  }
};

/**
 * Fluxo de Mana: the caster's team regenerates `magnitude` times faster for
 * the card's duration.
 *
 * Tributo Obscuro's opposite number. That one buys mana with health, now; this
 * buys it with time, and so it is the only card in the catalog that gets worse
 * the later it is cast — three mana spent two seconds before a fight ends is
 * three mana burned. A program that plays it well is a program that decided the
 * match was going long.
 *
 * It does nothing at all with nobody in the disc, which is the only thing
 * keeping an economy card on the map: without that, a rule could fire at a
 * fixed spot for a whole match and never once look at the field.
 */
const attune: SpellRider = (w, { team, spell, app, targets }) => {
  if (targets.length === 0) return;
  w.attuneMana(team, app.magnitude ?? 1, app.duration ?? spell.duration);
};

const RIDERS: Readonly<Record<string, SpellRider>> = {
  puddle,
  strike,
  dispel,
  knockback,
  tribute,
  rally,
  attune,
};

export function isSpellRider(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RIDERS, name);
}

export function spellRiderFor(name: string): SpellRider | undefined {
  return RIDERS[name];
}
