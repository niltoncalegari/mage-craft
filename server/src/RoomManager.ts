/**
 * Creates and tracks rooms in memory. No persistence: rooms disappear on
 * process restart, which is fine at this stage (no matchmaking, GDD §7/§10.3).
 */

import { randomBytes } from 'node:crypto';
import { Room, type RoomSummary } from './Room';

/** No 0/O/1/I — room codes get read aloud. */
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_ID_LENGTH = 4;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly nextId: () => string = randomRoomId) {}

  /** Allocates a room with a freshly generated, unique room code. */
  createRoom(teamSize: number): Room {
    let id = this.nextId();
    while (this.rooms.has(id)) id = this.nextId();

    // Constructed before insertion so an invalid team size rejects cleanly.
    const room = new Room(id, teamSize);
    this.rooms.set(id, room);
    return room;
  }

  room(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  removeRoom(id: string): void {
    this.rooms.delete(id);
  }

  /** Every room that is still joinable (lobby or in_progress). */
  summaries(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => r.state !== 'ended').map((r) => r.summary());
  }
}

function randomRoomId(): string {
  const buf = randomBytes(ROOM_ID_LENGTH);
  let out = '';
  for (const v of buf) out += ROOM_ID_ALPHABET[v % ROOM_ID_ALPHABET.length];
  return out;
}
