/**
 * Who is commanding each side of a running match, keyed by *wire* team (0/1).
 *
 * The HUD used to say "You" and "Opponent", which is the one thing a player
 * already knows. The nick is the thing they don't — and it has to survive both
 * ways into a match, which name it from different places: the queue names the
 * pairing once, in `match_found`, while a custom room names every seat, over
 * and over, in `room_state`. Neither is available everywhere (a spectator never
 * gets a `match_found`; a queued player's `room_state` calls the AI seat
 * "Bot (normal)"), so this merges them in one place instead of leaving the HUD
 * to guess.
 */

import type { MatchFoundMsg } from '../net/protocol';
import type { RoomDetail } from './roomStore';

/** Longest nick the side boxes can show before it is cut short. */
export const MATCH_NAME_MAX = 18;

/** Separator between the nicks on a team, for 2v2 and up. */
const JOINER = ' + ';

export function shortenName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= MATCH_NAME_MAX) return trimmed;
  return `${trimmed.slice(0, MATCH_NAME_MAX - 1)}…`;
}

/**
 * The nicks seated on one wire team, humans first. Bots are only used when the
 * team has no human at all — in a 1v1 against the queue's AI fallback that is
 * the whole team, and in a filled 2v2 the human is who you are actually
 * playing against.
 */
function namesOnTeam(room: RoomDetail, team: number): { label: string; humans: boolean } {
  const seated = room.slots.filter((s) => s.team === team && s.name.trim() !== '');
  const humans = seated.filter((s) => !s.isBot);
  const chosen = humans.length > 0 ? humans : seated;
  return {
    label: chosen.map((s) => s.name.trim()).join(JOINER),
    humans: humans.length > 0,
  };
}

/**
 * Resolves both sides' labels for the match HUD.
 *
 * `myName` wins over whatever the room recorded for your own seat: the room
 * name is a per-join string, while the account name is the one the player
 * signed in under and expects to see.
 */
export function matchTeamNames(opts: {
  room: RoomDetail | null;
  found: MatchFoundMsg | null;
  /** Which wire team the local player commands; null while spectating. */
  localTeam: number | null;
  myName: string;
}): Record<number, string> {
  const names: Record<number, string> = {};

  if (opts.room?.online) {
    for (const team of [0, 1]) {
      const { label, humans } = namesOnTeam(opts.room, team);
      // A bot-only label is a placeholder — `match_found` below has a better
      // name for the queue's AI, and it should get the chance to replace it.
      if (label && humans) names[team] = label;
      else if (label) names[team] ??= label;
    }
  }

  if (opts.found) {
    const enemyTeam = opts.found.yourTeam === 1 ? 0 : 1;
    // Only fills a gap: in a 2v2 the room roster is richer than a single name.
    if (!names[enemyTeam] || opts.found.againstBot) names[enemyTeam] = opts.found.opponentName;
  }

  if (opts.localTeam !== null && opts.myName.trim() !== '') {
    names[opts.localTeam] = opts.myName.trim();
  }

  for (const team of Object.keys(names)) {
    names[Number(team)] = shortenName(names[Number(team)]);
  }
  return names;
}
