/**
 * What a finished match leaves behind.
 *
 * `round_end` carries a single number — who won — and everything else about the
 * match (how long it ran, who traded well, which spells were actually spent)
 * lived in the `World` object right up until the session dropped it. That made
 * "which comps do I win with" unanswerable in principle, not just unimplemented.
 *
 * This is a pure read of a finished world, so it works identically for a server
 * session, a locally simulated practice match, and a headless harness run.
 */

import type { RosterId } from './cards';
import { TEAM_A, TEAM_B, type Team } from './entities';
import type { SpellId } from './spells';
import type { World } from './World';

export interface MageStat {
  rosterId: RosterId | null;
  role: string;
  kills: number;
  deaths: number;
  /** Abilities this body spent out of its own kit (plano v1.3 §7.1). */
  casts: number;
}

export interface CastStat {
  cardId: SpellId;
  casts: number;
}

export interface TeamSummary {
  /** The mages this side fielded, in squad order. */
  squad: RosterId[];
  /**
   * Enemy mages this side put down. Read off the *opponent's* deaths rather
   * than this side's kills: tower bolts and Praga ticks kill without a mage
   * attacker, so summing own-kills quietly loses them (see `World.kill`).
   */
  kills: number;
  deaths: number;
  structuresDestroyed: number;
  casts: CastStat[];
  mages: MageStat[];
}

export interface MatchSummary {
  /** -1 is a draw, matching the `round_end` convention. */
  winnerTeam: number;
  durationSeconds: number;
  suddenDeath: boolean;
  perTeam: Record<number, TeamSummary>;
}

export function summarize(world: World): MatchSummary {
  const teams = [TEAM_A, TEAM_B] as Team[];
  const perTeam: Record<number, TeamSummary> = {};

  for (const team of teams) {
    const mages = [...world.mages.values()].filter((m) => m.team === team);
    const enemies = [...world.mages.values()].filter((m) => m.team !== team);

    perTeam[team] = {
      squad: mages.map((m) => m.rosterId).filter((id): id is RosterId => id !== null),
      kills: enemies.reduce((sum, m) => sum + m.deaths, 0),
      deaths: mages.reduce((sum, m) => sum + m.deaths, 0),
      structuresDestroyed: world.structuresDestroyedBy(team),
      casts: [...(world.castsBySpell.get(team) ?? new Map<SpellId, number>())]
        .map(([cardId, casts]) => ({ cardId, casts }))
        .sort((a, b) => b.casts - a.casts),
      mages: mages.map((m) => ({
        rosterId: m.rosterId,
        role: m.role,
        kills: m.kills,
        deaths: m.deaths,
        casts: world.castsOf(m.id),
      })),
    };
  }

  return {
    winnerTeam: world.winner ?? -1,
    durationSeconds: world.elapsed,
    suddenDeath: world.suddenDeath,
    perTeam,
  };
}
