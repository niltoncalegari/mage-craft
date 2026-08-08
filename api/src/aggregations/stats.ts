import { Types } from 'mongoose';
import { MatchLog } from '../models/MatchLog.js';
import { User } from '../models/User.js';

export interface UserSummary {
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  kdr: number;
  favoriteElement: string | null;
}

export interface ElementStat {
  elementId: string;
  casts: number;
  hits: number;
  kills: number;
  damageDealt: number;
}

export interface RankingEntry {
  userId: string;
  username: string;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  kdr: number;
}

/** Kills-per-death ratio; a player with zero deaths is ranked by raw kills. */
function computeKdr(kills: number, deaths: number): number {
  return deaths > 0 ? kills / deaths : kills;
}

export async function getUserElementStats(userId: string): Promise<ElementStat[]> {
  const rows = await MatchLog.aggregate<ElementStat & { _id: string }>([
    { $match: { userId: new Types.ObjectId(userId) } },
    { $unwind: '$elements' },
    {
      $group: {
        _id: '$elements.elementId',
        casts: { $sum: '$elements.casts' },
        hits: { $sum: '$elements.hits' },
        kills: { $sum: '$elements.kills' },
        damageDealt: { $sum: '$elements.damageDealt' },
      },
    },
    { $sort: { casts: -1 } },
  ]);
  return rows.map((r) => ({ elementId: r._id, casts: r.casts, hits: r.hits, kills: r.kills, damageDealt: r.damageDealt }));
}

export async function getUserSummary(userId: string): Promise<UserSummary> {
  const [totals] = await MatchLog.aggregate<{
    matchesPlayed: number;
    wins: number;
    kills: number;
    deaths: number;
  }>([
    { $match: { userId: new Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        matchesPlayed: { $sum: 1 },
        wins: { $sum: { $cond: ['$won', 1, 0] } },
        kills: { $sum: '$kills' },
        deaths: { $sum: '$deaths' },
      },
    },
  ]);

  const elements = await getUserElementStats(userId);
  const favoriteElement = elements[0]?.elementId ?? null;

  if (!totals) {
    return { matchesPlayed: 0, wins: 0, losses: 0, kills: 0, deaths: 0, kdr: 0, favoriteElement };
  }

  return {
    matchesPlayed: totals.matchesPlayed,
    wins: totals.wins,
    losses: totals.matchesPlayed - totals.wins,
    kills: totals.kills,
    deaths: totals.deaths,
    kdr: computeKdr(totals.kills, totals.deaths),
    favoriteElement,
  };
}

/**
 * Comps played fewer times than this are noise: one lucky match would show as a
 * 100% win rate and outrank everything the player actually relies on.
 */
const MIN_GAMES_FOR_COMP = 2;

export interface SquadStat {
  /** Sorted mage ids joined by '+', so pick order does not split a comp in two. */
  signature: string;
  squad: string[];
  games: number;
  wins: number;
  /** 0..1 */
  winRate: number;
  structuresDestroyed: number;
}

export interface CardStat {
  cardId: string;
  casts: number;
}

/** Win rate per squad composition — the "which comps do I win with" question. */
export async function getUserSquadStats(userId: string): Promise<SquadStat[]> {
  const rows = await MatchLog.aggregate<{
    _id: string;
    squad: string[];
    games: number;
    wins: number;
    structuresDestroyed: number;
  }>([
    { $match: { userId: new Types.ObjectId(userId), 'squad.0': { $exists: true } } },
    { $addFields: { sortedSquad: { $sortArray: { input: '$squad', sortBy: 1 } } } },
    {
      $group: {
        _id: { $reduce: { input: '$sortedSquad', initialValue: '', in: { $concat: ['$$value', '+', '$$this'] } } },
        squad: { $first: '$sortedSquad' },
        games: { $sum: 1 },
        wins: { $sum: { $cond: ['$won', 1, 0] } },
        structuresDestroyed: { $sum: '$structuresDestroyed' },
      },
    },
    { $match: { games: { $gte: MIN_GAMES_FOR_COMP } } },
  ]);

  return rows
    .map((r) => ({
      // The $reduce leaves a leading separator; the client never parses this,
      // but a stray '+' would look like a bug in any log that prints it.
      signature: r._id.replace(/^\+/, ''),
      squad: r.squad,
      games: r.games,
      wins: r.wins,
      winRate: r.games > 0 ? r.wins / r.games : 0,
      structuresDestroyed: r.structuresDestroyed,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

/** Total casts per card across every logged match, most-cast first. */
export async function getUserCardStats(userId: string): Promise<CardStat[]> {
  const rows = await MatchLog.aggregate<{ _id: string; casts: number }>([
    { $match: { userId: new Types.ObjectId(userId) } },
    { $unwind: '$cards' },
    { $group: { _id: '$cards.cardId', casts: { $sum: '$cards.casts' } } },
    { $match: { casts: { $gt: 0 } } },
    { $sort: { casts: -1 } },
  ]);
  return rows.map((r) => ({ cardId: r._id, casts: r.casts }));
}

export async function getRanking(options: { skip: number; limit: number; sort: 'wins' | 'kdr' }): Promise<RankingEntry[]> {
  const rows = await MatchLog.aggregate<{
    _id: Types.ObjectId;
    wins: number;
    losses: number;
    kills: number;
    deaths: number;
  }>([
    {
      $group: {
        _id: '$userId',
        wins: { $sum: { $cond: ['$won', 1, 0] } },
        losses: { $sum: { $cond: ['$won', 0, 1] } },
        kills: { $sum: '$kills' },
        deaths: { $sum: '$deaths' },
      },
    },
  ]);

  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }, { username: 1 }).lean();
  const usernameById = new Map(users.map((u) => [u._id.toString(), u.username]));

  const entries: RankingEntry[] = rows.map((r) => ({
    userId: r._id.toString(),
    username: usernameById.get(r._id.toString()) ?? 'unknown',
    wins: r.wins,
    losses: r.losses,
    kills: r.kills,
    deaths: r.deaths,
    kdr: computeKdr(r.kills, r.deaths),
  }));

  entries.sort((a, b) => (options.sort === 'kdr' ? b.kdr - a.kdr : b.wins - a.wins));
  return entries.slice(options.skip, options.skip + options.limit);
}
