/**
 * The matchmaking queue (Clash Royale-style): a player presses Battle and the
 * server finds them a 1v1, rather than creating a room and reading a code to a
 * friend. Manual rooms still exist for private games — this is the front door.
 *
 * Deliberately not persistent and deliberately not skill-rated yet: pairing is
 * first-come-first-served, with a bot fallback so nobody stares at a spinner on
 * an empty server. Rating-aware pairing slots in at `pair()` without touching
 * anything else.
 */

import type { RosterId } from '../../sim/cards';
import type { CardId } from '../../sim/spells';

/** How long a player waits for a human before the server gives them a bot. */
export const BOT_FALLBACK_SECONDS = 12;

export interface QueueEntry {
  clientId: string;
  name: string;
  deck: CardId[];
  /** Undefined keeps the default squad — the other half of the loadout. */
  squad?: RosterId[];
  /** Epoch seconds, injected so tests can drive the clock. */
  joinedAt: number;
}

export interface Pairing {
  a: QueueEntry;
  /** Null when the wait timed out and the opponent is an AI commander. */
  b: QueueEntry | null;
}

export class Matchmaker {
  private readonly queue: QueueEntry[] = [];

  /** Adds a player, or refreshes their entry if they were already waiting. */
  join(entry: QueueEntry): void {
    this.leave(entry.clientId);
    this.queue.push(entry);
  }

  leave(clientId: string): boolean {
    const idx = this.queue.findIndex((e) => e.clientId === clientId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  has(clientId: string): boolean {
    return this.queue.some((e) => e.clientId === clientId);
  }

  get size(): number {
    return this.queue.length;
  }

  /** 1-based place in line, or 0 when not queued. */
  positionOf(clientId: string): number {
    return this.queue.findIndex((e) => e.clientId === clientId) + 1;
  }

  entryOf(clientId: string): QueueEntry | undefined {
    return this.queue.find((e) => e.clientId === clientId);
  }

  snapshot(): readonly QueueEntry[] {
    return [...this.queue];
  }

  /**
   * Drains everyone who can be matched right now: humans pair off two at a
   * time, and whoever is left over gets a bot once they have waited long
   * enough. Entries returned here are removed from the queue.
   */
  pair(now: number): Pairing[] {
    const out: Pairing[] = [];

    while (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      out.push({ a, b });
    }

    if (this.queue.length === 1 && now - this.queue[0].joinedAt >= BOT_FALLBACK_SECONDS) {
      out.push({ a: this.queue.shift()!, b: null });
    }

    return out;
  }
}
