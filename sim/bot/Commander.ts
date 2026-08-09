/**
 * The bot *commander* (GDD §10, §11).
 *
 * This is a different agent from `Brain.ts`, and the distinction matters: Brain
 * drives the squad's mages, which fight on their own regardless of the player,
 * while Commander plays the one thing a human actually does since the pivot
 * (GDD §13): it decides which spell to spend mana on, and where to aim it — a
 * curse on the enemy cluster pressuring us, or a blessing/shield on our own
 * push. It is what the matchmaking queue falls back to, and what makes the
 * agency test ("AFK must lose") something you can actually run.
 */

import { TEAM_A, type Mage, type Team } from '../entities';
import type { Deck } from '../Deck';
import type { Rng } from '../rng';
import { spellFor, type CardId, type SpellCard, type SpellId } from '../spells';
import { Vec2 } from '../Vec2';
import type { World } from '../World';
import type { Difficulty } from './Brain';

export interface CastIntent {
  cardId: CardId;
  position: Vec2;
}

interface CommanderTuning {
  /** Seconds between cast decisions. */
  interval: number;
  /** Mana it tries to keep banked for a response instead of spending on sight. */
  reserve: number;
  /** Chance per decision to act at all — a lower value reads as a slower player. */
  eagerness: number;
  /** Whether it answers a push at all, or only ever plays its own game. */
  respondsToThreats: boolean;
  /** Whether it picks the spell suited to the situation, or whatever is cheapest. */
  picksByRole: boolean;
}

/*
 * Both players are mana-limited, not decision-limited: over a full match every
 * difficulty gets to spend roughly the same total. So cadence alone separates
 * almost nothing. The axes that actually express skill are *whether you
 * defend* and *whether you cast the right spell*, so those are what the
 * difficulties differ on.
 */
export const COMMANDER_TUNINGS: Readonly<Record<Difficulty, CommanderTuning>> = {
  easy: { interval: 2.6, reserve: 0, eagerness: 0.7, respondsToThreats: false, picksByRole: false },
  normal: {
    interval: 1.6,
    reserve: 1,
    eagerness: 0.9,
    respondsToThreats: true,
    picksByRole: true,
  },
  hard: { interval: 1.1, reserve: 1, eagerness: 1, respondsToThreats: true, picksByRole: true },
};

/** Radius used to judge "is this a cluster" — matches the spells' own radii (GDD §9). */
const CLUSTER_RADIUS = 4;
/** Health fraction below which an advancing ally reads as "under pressure". */
const UNDER_FIRE_HEALTH_FRACTION = 0.6;

export class Commander {
  private timer = 0;

  constructor(
    private readonly rng: Rng,
    private readonly difficulty: Difficulty = 'normal',
  ) {}

  /**
   * Returns a cast to perform this tick, or null. The caller is responsible for
   * actually calling `World.castSpell` — Commander never mutates the world,
   * which keeps it usable from a headless balance harness.
   */
  step(w: World, team: Team, deck: Deck, dt: number): CastIntent | null {
    const tune = COMMANDER_TUNINGS[this.difficulty] ?? COMMANDER_TUNINGS.normal;

    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = tune.interval;

    if (this.rng.float() > tune.eagerness) return null;

    const threat = tune.respondsToThreats ? this.biggestThreat(w, team) : null;
    // Under real pressure the reserve goes out of the window — holding mana
    // while the enemy squad walks up to our Core is how a bot loses without
    // playing.
    const reserve = threat ? 0 : tune.reserve;
    const budget = w.manaOf(team) - reserve;

    const position = threat ? threat.position : this.ownPushCenter(w, team);
    if (!position) return null;

    const spellId = this.pickSpell(w, team, deck, budget, threat, position, tune.picksByRole);
    return spellId ? { cardId: spellId, position } : null;
  }

  /**
   * The enemy unit furthest into our own half — what a curse should answer.
   *
   * Null unless one is genuinely *in* our ground. Without that floor this
   * returned the enemy nearest the midline no matter where it stood, so a
   * commander that "responds to threats" was permanently responding to one:
   * it dropped every curse it could afford on the enemy's own front line,
   * banked no mana, and never once buffed its own push.
   */
  private biggestThreat(w: World, team: Team): Mage | null {
    const forward = team === TEAM_A ? 1 : -1;
    let best: Mage | null = null;
    let deepest = 0;
    for (const m of w.mages.values()) {
      if (!m.alive || m.team === team) continue;
      // Depth into our territory: positive once it is past the midline, which
      // is exactly when it becomes our problem rather than our opportunity.
      const depth = -m.position.x * forward;
      if (depth > deepest) {
        deepest = depth;
        best = m;
      }
    }
    return best;
  }

  /** The center of our own most-advanced living cluster — where a blessing/shield goes. */
  private ownPushCenter(w: World, team: Team): Vec2 | null {
    const forward = team === TEAM_A ? 1 : -1;
    let best: Mage | null = null;
    let deepest = -Infinity;
    for (const m of w.mages.values()) {
      if (!m.alive || m.team !== team) continue;
      const reach = m.position.x * forward;
      if (reach > deepest) {
        deepest = reach;
        best = m;
      }
    }
    return best?.position ?? null;
  }

  /**
   * Picks what to cast. Answering a threat prefers a curse — Praga once
   * enough enemies are clustered to make the AoE worth it, Maldição da
   * Lentidão otherwise; supporting our own push prefers Escudo Arcano when it
   * is already taking a beating, Bênção de Ímpeto when it is healthy and
   * should just go faster.
   */
  private pickSpell(
    w: World,
    team: Team,
    deck: Deck,
    budget: number,
    threat: Mage | null,
    position: Vec2,
    byRole: boolean,
  ): CardId | null {
    const affordable = deck
      .hand()
      .map((id) => ({ id, spell: spellFor(id) }))
      .filter((e): e is { id: SpellId; spell: SpellCard } => e.spell !== undefined && e.spell.cost <= budget);
    if (affordable.length === 0) return null;

    // A weak commander just casts whatever it can afford.
    if (!byRole) return affordable[Math.floor(this.rng.float() * affordable.length)].id;

    const wantedOrder = threat
      ? this.rankCurses(w, team, position)
      : this.rankBuffs(w, team, position);

    for (const id of wantedOrder) {
      const found = affordable.find((e) => e.id === id);
      if (found) return found.id;
    }

    // Nothing in the preferred order is affordable — spend the most it can on
    // the right kind of spell rather than passing entirely.
    const wantedKind = threat ? 'curse' : 'buff';
    const sameKind = affordable.filter((e) => e.spell.kind === wantedKind);
    const pool = sameKind.length > 0 ? sameKind : affordable;
    let best = pool[0];
    for (const e of pool) {
      if (e.spell.cost > best.spell.cost) best = e;
    }
    return best.id;
  }

  /** Praga once the enemy is clustered enough to make the AoE worth it; otherwise the single-target slow. */
  private rankCurses(w: World, team: Team, position: Vec2): SpellId[] {
    const nearby = this.countNear(w, position, CLUSTER_RADIUS, (m) => m.alive && m.team !== team);
    return nearby >= 2 ? ['plague', 'slow_curse'] : ['slow_curse', 'plague'];
  }

  /** A push already under fire wants the shield; a healthy one wants to go faster. */
  private rankBuffs(w: World, team: Team, position: Vec2): SpellId[] {
    let underFire = false;
    for (const m of w.mages.values()) {
      if (!m.alive || m.team !== team) continue;
      if (m.position.distanceTo(position) > CLUSTER_RADIUS) continue;
      if (m.health < m.maxHealth * UNDER_FIRE_HEALTH_FRACTION) {
        underFire = true;
        break;
      }
    }
    return underFire ? ['arcane_shield', 'blessing'] : ['blessing', 'arcane_shield'];
  }

  private countNear(w: World, position: Vec2, radius: number, filter: (m: Mage) => boolean): number {
    let n = 0;
    for (const m of w.mages.values()) {
      if (filter(m) && m.position.distanceTo(position) <= radius) n++;
    }
    return n;
  }
}
