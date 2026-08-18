/**
 * A local record of what you played and how it went.
 *
 * The server's `MatchLog` only ever saw offline practice runs, and only for
 * signed-in accounts — so "which comps do I actually win with" had no data
 * behind it at all. This store is written at the end of every match, ranked or
 * practice, which makes the answer available immediately even when the report
 * to the account API fails; that API mirrors it for cross-device history.
 *
 * Capped as a ring buffer: the questions this answers are about recent form,
 * and unbounded localStorage growth is how a save file becomes a bug report.
 */

import type { RosterId } from '../../sim/cards';
import { rosterFor } from '../../sim/cards';
import type { CardId } from '../../sim/spells';

const HISTORY_KEY = 'mage-craft.history.v1';
const HISTORY_MAX = 50;

/** Comps below this are noise, not a trend. */
const MIN_GAMES_FOR_COMP = 2;

export type MatchMode = 'pvp' | 'practice';

export interface MatchRecord {
  /** Epoch ms, and the de-dupe key when merging server history. */
  at: number;
  mode: MatchMode;
  /** null is a draw — the sim can end a match with no winner (GDD §4). */
  won: boolean | null;
  squad: RosterId[];
  cards: { cardId: CardId; rosterId?: string; casts: number }[];
  kills: number;
  deaths: number;
  durationSeconds: number;
  structuresDestroyed: number;
}

export function loadHistory(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMatchRecord);
  } catch {
    return [];
  }
}

export function recordMatch(record: MatchRecord): void {
  try {
    const next = [record, ...loadHistory()].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* private browsing / quota — losing history must never break a match end */
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* nothing to do */
  }
}

function isMatchRecord(value: unknown): value is MatchRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<MatchRecord>;
  return typeof r.at === 'number' && Array.isArray(r.squad) && Array.isArray(r.cards);
}

export interface CompStat {
  /** Sorted squad ids joined by '+', stable across pick order. */
  signature: string;
  squad: RosterId[];
  games: number;
  wins: number;
  /** 0..1 */
  winRate: number;
}

/**
 * Win rate grouped by squad, ignoring the order the mages were picked in —
 * `[golem, cleric]` and `[cleric, golem]` are the same composition.
 */
export function bestComps(records: readonly MatchRecord[], minGames = MIN_GAMES_FOR_COMP): CompStat[] {
  const groups = new Map<string, { squad: RosterId[]; games: number; wins: number }>();

  for (const record of records) {
    if (record.squad.length === 0) continue;
    const sorted = [...record.squad].sort();
    const signature = sorted.join('+');
    const group = groups.get(signature) ?? { squad: sorted, games: 0, wins: 0 };
    group.games += 1;
    if (record.won === true) group.wins += 1;
    groups.set(signature, group);
  }

  return [...groups.entries()]
    .filter(([, g]) => g.games >= minGames)
    .map(([signature, g]) => ({ signature, squad: g.squad, games: g.games, wins: g.wins, winRate: g.wins / g.games }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export interface CardStat {
  cardId: CardId;
  casts: number;
}

/** Total casts per card across the stored history, most-cast first. */
export function mostUsedCards(records: readonly MatchRecord[]): CardStat[] {
  const totals = new Map<CardId, number>();
  for (const record of records) {
    for (const { cardId, casts } of record.cards) {
      totals.set(cardId, (totals.get(cardId) ?? 0) + casts);
    }
  }
  return [...totals.entries()]
    .map(([cardId, casts]) => ({ cardId, casts }))
    .filter((s) => s.casts > 0)
    .sort((a, b) => b.casts - a.casts);
}

/** Display label for a comp — falls back to the raw id for unknown mages. */
export function compLabel(squad: readonly RosterId[]): string {
  return squad.map((id) => rosterFor(id)?.name ?? id).join(' · ');
}
