/**
 * The bot *commander* (GDD §10, §11).
 *
 * This is a different agent from `Brain.ts`, and the distinction matters: Brain
 * drives units that already exist, while Commander plays the game the human
 * plays — it decides which card to spend mana on, and where to put it. It is
 * what the matchmaking queue falls back to, and what makes the agency test
 * ("AFK must lose") something you can actually run.
 */

import { cardFor, type CardId } from '../cards';
import type { Deck } from '../Deck';
import { TEAM_A, TEAM_B, type Mage, type Team } from '../entities';
import type { Rng } from '../rng';
import { Vec2 } from '../Vec2';
import type { World } from '../World';
import type { Difficulty } from './Brain';

export interface CastIntent {
  cardId: CardId;
  position: Vec2;
}

interface CommanderTuning {
  /** Seconds between deploy decisions. */
  interval: number;
  /** Mana it tries to keep banked for a response instead of spending on sight. */
  reserve: number;
  /** Chance per decision to act at all — a lower value reads as a slower player. */
  eagerness: number;
  /** Whether it answers a push at all, or only ever plays its own game. */
  respondsToThreats: boolean;
  /** Whether it plays the right role for the situation, or whatever is cheapest. */
  picksByRole: boolean;
}

/*
 * Both players are mana-limited, not decision-limited: over a full match every
 * difficulty gets to spend roughly the same total. So cadence alone separates
 * almost nothing — measured, hard cast 30 cards to easy's 27 and still drew.
 * The axes that actually express skill are *whether you defend* and *whether
 * you play the right card*, so those are what the difficulties differ on.
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

/**
 * How far in front of its own Core the bot plants an offensive push. Kept well
 * clear of its own Towers, which sit at inset ~5 and would block the summon.
 */
const PUSH_LINE_INSET = 8;
const DEPLOY_ATTEMPTS = 6;

export class Commander {
  private timer = 0;

  constructor(
    private readonly rng: Rng,
    private readonly difficulty: Difficulty = 'normal',
  ) {}

  /**
   * Returns a cast to perform this tick, or null. The caller is responsible for
   * actually calling `World.deploy` — Commander never mutates the world, which
   * keeps it usable from a headless balance harness.
   */
  step(w: World, team: Team, deck: Deck, dt: number): CastIntent | null {
    const tune = COMMANDER_TUNINGS[this.difficulty] ?? COMMANDER_TUNINGS.normal;

    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = tune.interval;

    if (this.rng.float() > tune.eagerness) return null;

    const threat = tune.respondsToThreats ? this.biggestThreat(w, team) : null;
    // Under real pressure the reserve goes out of the window — holding mana
    // while a Golem walks into your Tower is how a bot loses without playing.
    const reserve = threat ? 0 : tune.reserve;
    const budget = w.manaOf(team) - reserve;

    const cardId = this.pickCard(w, team, deck, budget, threat !== null, tune.picksByRole);
    if (!cardId) return null;

    const position = this.pickPosition(w, team, threat);
    return position ? { cardId, position } : null;
  }

  /** The enemy unit furthest into our own half — what a response should answer. */
  private biggestThreat(w: World, team: Team): Mage | null {
    const forward = team === TEAM_A ? 1 : -1;
    let best: Mage | null = null;
    let deepest = 0;
    for (const m of w.mages.values()) {
      if (!m.alive || m.team === team) continue;
      // Depth into our territory: positive once it is past the midline.
      const depth = -m.position.x * forward;
      if (depth > deepest) {
        deepest = depth;
        best = m;
      }
    }
    return best;
  }

  /**
   * Picks what to play. Answering a threat prefers a damage dealer (kill it);
   * opening a push prefers a tank to soak the Tower that will shoot back.
   */
  private pickCard(
    w: World,
    team: Team,
    deck: Deck,
    budget: number,
    responding: boolean,
    byRole: boolean,
  ): CardId | null {
    const affordable = deck
      .hand()
      .map((id) => ({ id, card: cardFor(id) }))
      .filter((e) => e.card && e.card.cost <= budget);
    if (affordable.length === 0) return null;

    // A weak commander just plays something it can afford.
    if (!byRole) return affordable[Math.floor(this.rng.float() * affordable.length)].id;

    const hasFriendlyPush = [...w.mages.values()].some((m) => m.alive && m.team === team);

    const wanted = responding ? 'damage' : hasFriendlyPush ? 'support' : 'tank';
    const preferred = affordable.filter((e) => e.card!.role === wanted);
    const pool = preferred.length > 0 ? preferred : affordable;

    // Within the preferred role, spend the most it can afford — a bot that
    // always plays its cheapest card never threatens anything.
    let best = pool[0];
    for (const e of pool) {
      if (e.card!.cost > best.card!.cost) best = e;
    }
    return best.id;
  }

  /**
   * Where to plant it. Defensively, just in front of the threat; offensively,
   * on the push line of the flank whose enemy Tower is still up.
   */
  private pickPosition(w: World, team: Team, threat: Mage | null): Vec2 | null {
    const forward = team === TEAM_A ? 1 : -1;

    let base: Vec2;
    if (threat) {
      // Intercept: stand between the threat and our Core, a little in front.
      base = new Vec2(threat.position.x - forward * 2.5, threat.position.y);
    } else {
      const core = w
        .structuresOf(team)
        .find((s) => s.kind === 'core' && s.alive)
        ?.position;
      const x = (core?.x ?? -forward * 17) + forward * PUSH_LINE_INSET;
      base = new Vec2(x, this.chooseFlank(w, team));
    }

    for (let i = 0; i < DEPLOY_ATTEMPTS; i++) {
      // Jitter widens with each retry so a blocked first choice still lands.
      const spread = i * 1.2;
      const candidate = new Vec2(
        base.x + (this.rng.float() * 2 - 1) * spread,
        base.y + (this.rng.float() * 2 - 1) * spread,
      );
      // Must be canSummonAt, not canDeployAt: the latter knows the zone rules
      // but nothing about obstacles or structures standing in the way.
      if (w.canSummonAt(team, candidate)) return candidate;
    }
    return w.canSummonAt(team, base) ? base : null;
  }

  /** Pushes the flank whose enemy Tower is weakest — finish what is already hurt. */
  private chooseFlank(w: World, team: Team): number {
    let best: number | null = null;
    let bestHealth = Infinity;
    for (const s of w.structuresOf(team === TEAM_A ? TEAM_B : TEAM_A)) {
      if (s.kind !== 'tower' || !s.alive) continue;
      if (s.health < bestHealth) {
        bestHealth = s.health;
        best = s.position.y;
      }
    }
    return best ?? (this.rng.float() < 0.5 ? -8 : 8);
  }
}
