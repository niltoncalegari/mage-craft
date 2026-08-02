/**
 * Client-side room browser / lobby state. Until the Go server exposes a public
 * room list, we keep a local catalog (recent + demo halls) and treat create/join
 * by code as the real online path.
 */

import type { ElementId } from '../game/elements';

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
}

export interface RoomSummary {
  roomId: string;
  name: string;
  teamSize: number;
  filled: number;
  capacity: number;
  state: RoomPhase;
  hostName: string;
  /** Demo halls are local-only previews; real rooms use a code for join. */
  isDemo?: boolean;
}

export interface RoomDetail extends RoomSummary {
  slots: RoomSlot[];
  /** Local player is host of this lobby. */
  isHost: boolean;
}

const RECENT_KEY = 'mage-craft.recent-rooms.v1';

const DEMO_HALLS: RoomSummary[] = [
  {
    roomId: 'HALL-1',
    name: 'Ember Practice',
    teamSize: 1,
    filled: 1,
    capacity: 2,
    state: 'lobby',
    hostName: 'Sparks',
    isDemo: true,
  },
  {
    roomId: 'HALL-2',
    name: 'Twin Pillars 2v2',
    teamSize: 2,
    filled: 3,
    capacity: 4,
    state: 'lobby',
    hostName: 'Rook',
    isDemo: true,
  },
  {
    roomId: 'HALL-3',
    name: 'Storm Bracket 3v3',
    teamSize: 3,
    filled: 4,
    capacity: 6,
    state: 'lobby',
    hostName: 'Gale',
    isDemo: true,
  },
];

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

export function listRooms(): RoomSummary[] {
  const recent = loadRecent().map((r) => ({ ...r, isDemo: false }));
  const ids = new Set(recent.map((r) => r.roomId));
  return [...recent, ...DEMO_HALLS.filter((d) => !ids.has(d.roomId))];
}

function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function emptySlots(teamSize: number, hostName: string, element: ElementId): RoomSlot[] {
  const slots: RoomSlot[] = [];
  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < teamSize; i++) {
      const isHostSlot = team === 0 && i === 0;
      slots.push({
        slotId: `t${team}-s${i}`,
        team: team as 0 | 1,
        name: isHostSlot ? hostName : '',
        isBot: false,
        element: isHostSlot ? element : '',
        ready: isHostSlot,
        isYou: isHostSlot,
      });
    }
  }
  return slots;
}

export function createLocalRoom(opts: {
  name: string;
  teamSize: number;
  hostName: string;
  element: ElementId;
}): RoomDetail {
  const teamSize = Math.min(6, Math.max(1, Math.round(opts.teamSize)));
  const roomId = makeRoomCode();
  const slots = emptySlots(teamSize, opts.hostName, opts.element);
  const room: RoomDetail = {
    roomId,
    name: opts.name.trim() || `${opts.hostName}'s Hall`,
    teamSize,
    filled: 1,
    capacity: teamSize * 2,
    state: 'lobby',
    hostName: opts.hostName,
    slots,
    isHost: true,
  };
  rememberRoom(room);
  return room;
}

export function joinLocalRoom(
  roomId: string,
  playerName: string,
  element: ElementId,
): RoomDetail {
  const code = roomId.trim().toUpperCase();
  const summary = listRooms().find((r) => r.roomId.toUpperCase() === code);
  const teamSize = summary?.teamSize ?? 1;
  const slots = emptySlots(teamSize, summary?.hostName ?? 'Host', 'fire');

  // Put the joining player on team 1 first empty slot (or team 0 if demo empty).
  let placed = false;
  for (const slot of slots) {
    if (!slot.name) {
      slot.name = playerName;
      slot.element = element;
      slot.ready = false;
      slot.isYou = true;
      placed = true;
      break;
    }
  }
  if (!placed) {
    // Replace a non-host empty by expanding narrative: sit as spectator-turned-player on last slot.
    const last = slots[slots.length - 1];
    last.name = playerName;
    last.element = element;
    last.isYou = true;
    last.isBot = false;
  }

  // Clear isYou from host placeholder if we overwrote narrative
  for (const slot of slots) {
    if (slot.name !== playerName) slot.isYou = false;
  }

  const filled = slots.filter((s) => s.name).length;
  const room: RoomDetail = {
    roomId: code || makeRoomCode(),
    name: summary?.name ?? `Room ${code}`,
    teamSize,
    filled,
    capacity: teamSize * 2,
    state: 'lobby',
    hostName: summary?.hostName ?? 'Host',
    slots,
    isHost: false,
  };
  rememberRoom(room);
  return room;
}

export function rememberRoom(room: RoomSummary): void {
  const next = [room, ...loadRecent().filter((r) => r.roomId !== room.roomId)];
  saveRecent(next);
}

export function setSlotElement(room: RoomDetail, element: ElementId): RoomDetail {
  const slots = room.slots.map((s) => (s.isYou ? { ...s, element } : s));
  return { ...room, slots };
}

export function setSlotTeam(room: RoomDetail, team: 0 | 1): RoomDetail {
  const you = room.slots.find((s) => s.isYou);
  if (!you || you.team === team) return room;

  const target = room.slots.find((s) => s.team === team && !s.name);
  if (!target) return room;

  const slots = room.slots.map((s) => {
    if (s.slotId === you.slotId) return { ...s, name: '', element: '' as ElementId | '', ready: false, isYou: false };
    if (s.slotId === target.slotId) {
      return {
        ...s,
        name: you.name,
        element: you.element,
        ready: you.ready,
        isYou: true,
        isBot: false,
      };
    }
    return s;
  });
  return { ...room, slots, filled: slots.filter((s) => s.name).length };
}

export function toggleReady(room: RoomDetail): RoomDetail {
  const slots = room.slots.map((s) => (s.isYou ? { ...s, ready: !s.ready } : s));
  return { ...room, slots };
}

export function addBotToRoom(room: RoomDetail, team: 0 | 1, difficulty: string): RoomDetail {
  const used = new Set(room.slots.filter((s) => s.team === team && s.element).map((s) => s.element));
  const catalog: ElementId[] = ['fire', 'ice', 'lightning', 'poison', 'stone', 'arcane', 'wind'];
  const free = catalog.find((e) => !used.has(e));
  if (!free) return room;

  const empty = room.slots.find((s) => s.team === team && !s.name);
  if (!empty) return room;

  const slots = room.slots.map((s) =>
    s.slotId === empty.slotId
      ? {
          ...s,
          name: `Bot (${difficulty})`,
          isBot: true,
          element: free,
          ready: true,
        }
      : s,
  );
  return { ...room, slots, filled: slots.filter((s) => s.name).length };
}

export function removeBot(room: RoomDetail, slotId: string): RoomDetail {
  const slots = room.slots.map((s) =>
    s.slotId === slotId && s.isBot
      ? { ...s, name: '', isBot: false, element: '' as ElementId | '', ready: false }
      : s,
  );
  return { ...room, slots, filled: slots.filter((s) => s.name).length };
}
