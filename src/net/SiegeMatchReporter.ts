/**
 * Turns a finished siege into the two records it should leave behind: an entry
 * in the local history (everyone, always) and a `MatchLog` on the account
 * (signed-in players only).
 *
 * The legacy `MatchReporter` did this for the pre-pivot practice loop by
 * listening to combat events and always claimed `mode: 'sp-vs-ai'` — which is
 * why `'pvp'` was unreachable from the client. This works from the match
 * summary instead, so it says the same thing whether the match ran on the
 * server or in this tab.
 */

import { rosterFor } from '../../sim/cards';
import type { MatchResultMsg, TeamSummaryDTO } from './protocol';
import type { MatchRecord, MatchMode } from '../app/matchHistory';
import type { ElementStat, ReportMatchInput } from './ApiClient';

/** The arena every siege is played on; see `OnlineMatch.ONLINE_MAP`. */
const SIEGE_MAP = 'siege1.json';

/** Points per enemy structure brought down — the win metric (GDD §4). */
const POINTS_PER_STRUCTURE = 100;
const POINTS_FOR_WIN = 500;

export function recordFor(result: MatchResultMsg, myTeam: number, mode: MatchMode): MatchRecord | null {
  const mine = result.perTeam[myTeam] as TeamSummaryDTO | undefined;
  if (!mine) return null;

  return {
    at: Date.now(),
    mode,
    won: result.winnerTeam === -1 ? null : result.winnerTeam === myTeam,
    squad: mine.squad.filter((id) => rosterFor(id as never) !== undefined) as MatchRecord['squad'],
    cards: mine.casts.map((c) => ({ cardId: c.cardId as MatchRecord['cards'][number]['cardId'], casts: c.casts })),
    kills: mine.kills,
    deaths: mine.deaths,
    durationSeconds: result.durationSeconds,
    structuresDestroyed: mine.structuresDestroyed,
  };
}

/**
 * The account-side payload. `difficulty` and `map` are required by the API and
 * a ranked siege has neither a difficulty setting nor a map choice, so both are
 * reported as the constants they actually are.
 */
export function reportFor(record: MatchRecord, mode: 'sp-vs-ai' | 'pvp'): ReportMatchInput {
  return {
    mode,
    won: record.won === true,
    kills: record.kills,
    deaths: record.deaths,
    score: record.structuresDestroyed * POINTS_PER_STRUCTURE + (record.won === true ? POINTS_FOR_WIN : 0),
    difficulty: 'normal',
    timeSeconds: Math.round(record.durationSeconds),
    livesSpent: 0,
    map: SIEGE_MAP,
    elements: elementStatsFor(record),
    squad: [...record.squad],
    cards: record.cards.map((c) => ({ cardId: c.cardId, casts: c.casts })),
    structuresDestroyed: record.structuresDestroyed,
  };
}

/**
 * Attributes the match to elements through the squad that fought it. This is
 * what finally makes the dashboard's "favorite element" mean something: it used
 * to come from a menu preference the simulation ignores.
 */
function elementStatsFor(record: MatchRecord): ElementStat[] {
  const casts = record.cards.reduce((sum, c) => sum + c.casts, 0);
  const byElement = new Map<string, ElementStat>();

  for (const id of record.squad) {
    const entry = rosterFor(id);
    if (!entry) continue;
    const stat = byElement.get(entry.element) ?? { elementId: entry.element, casts: 0, hits: 0, kills: 0, damageDealt: 0 };
    byElement.set(entry.element, stat);
  }

  const mages = byElement.size;
  if (mages === 0) return [];

  // Spread the match's totals across the squad's elements. Per-mage damage is
  // not tracked in the sim yet, so an even split is the honest approximation
  // rather than a number that looks precise and is not.
  for (const stat of byElement.values()) {
    stat.casts = Math.round(casts / mages);
    stat.kills = Math.round(record.kills / mages);
  }

  return [...byElement.values()];
}
