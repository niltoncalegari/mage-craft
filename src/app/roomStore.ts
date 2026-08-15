/**
 * Client-side lobby state for the room a matched or rematching player is
 * currently seated in. Room browsing/creation no longer exists — the only
 * path into a room is matchmaking — so this just mirrors server room state.
 */

import type { ElementId } from '../game/elements';
import type { RoomStateMsg } from '../net/protocol';

export type RoomPhase = 'lobby' | 'starting' | 'in_progress' | 'ended';

export interface RoomSlot {
  slotId: string;
  team: 0 | 1;
  name: string;
  isBot: boolean;
  element: ElementId | '';
  ready: boolean;
  /** True when this slot is the local player. */
  isYou?: boolean;
  pendingClaimPlayerId?: string;
  playerId?: string;
}

export interface SpectatorInfo {
  playerId: string;
  name: string;
  claimedSlotId?: string;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  teamSize: number;
  filled: number;
  capacity: number;
  state: RoomPhase;
  hostName: string;
}

export interface RoomDetail extends RoomSummary {
  slots: RoomSlot[];
  /** Local player is host of this lobby. */
  isHost: boolean;
  youRole?: 'player' | 'spectator' | '';
  spectators?: SpectatorInfo[];
  fillBots?: boolean;
  online?: boolean;
}

const RECENT_KEY = 'mage-craft.recent-rooms.v1';

function loadRecent(): RoomSummary[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RoomSummary[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(rooms: RoomSummary[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(rooms.slice(0, 8)));
}

export function rememberRoom(room: RoomSummary): void {
  const next = [room, ...loadRecent().filter((r) => r.roomId !== room.roomId)];
  saveRecent(next);
}

export function roomFromServerState(
  msg: RoomStateMsg,
  localClientId: string,
  opts?: { name?: string; isHost?: boolean },
): RoomDetail {
  const slots: RoomSlot[] = msg.slots.map((s) => ({
    slotId: s.slotId,
    team: (s.team === 1 ? 1 : 0) as 0 | 1,
    name: s.name ?? '',
    isBot: s.isBot,
    element: (s.element ?? '') as ElementId | '',
    ready: s.ready,
    isYou: s.playerId === localClientId,
    pendingClaimPlayerId: s.pendingClaimPlayerId,
    playerId: s.playerId,
  }));

  // Capacity grid: ensure empty visual slots when server only lists occupied.
  const teamSize = msg.teamSize;
  for (const team of [0, 1] as const) {
    const onTeam = slots.filter((s) => s.team === team).length;
    for (let i = onTeam; i < teamSize; i++) {
      slots.push({
        slotId: `empty-${team}-${i}`,
        team,
        name: '',
        isBot: false,
        element: '',
        ready: false,
      });
    }
  }

  const filled = msg.slots.length;
  const youRole = (msg.youRole === 'spectator' || msg.youRole === 'player'
    ? msg.youRole
    : '') as RoomDetail['youRole'];

  return {
    roomId: msg.roomId,
    name: opts?.name ?? `Hall ${msg.roomId}`,
    teamSize,
    filled,
    capacity: teamSize * 2,
    state: (msg.state as RoomPhase) || 'lobby',
    hostName: opts?.name ? 'Host' : 'Host',
    slots,
    isHost: opts?.isHost ?? false,
    youRole,
    spectators: (msg.spectators ?? []).map((s) => ({
      playerId: s.playerId,
      name: s.name,
      claimedSlotId: s.claimedSlotId,
    })),
    fillBots: msg.fillBots,
    online: true,
  };
}

