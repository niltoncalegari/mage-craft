/**
 * The pre-game lobby and its state machine (GDD §7): joining, team/element
 * selection, bots filling empty slots, spectator join during in-progress
 * matches, claim-for-rematch, and the transition into an authoritative
 * simulation once a match starts.
 *
 * Depends only on the shared `sim` package (to build the World at match start);
 * it deliberately knows nothing about bot AI or the WebSocket transport, so
 * those stay independently testable and are wired together in App.ts.
 */

import { ALL_ELEMENTS, elementDefFor, type ElementId } from '../../sim/elements';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { World } from '../../sim/World';

export type RoomState = 'lobby' | 'in_progress' | 'ended';

export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 6;
const MAX_SPECTATORS = 8;
const DEFAULT_BOT_DIFFICULTY = 'normal';

const TEAMS: readonly Team[] = [TEAM_A, TEAM_B];

/** One seat on a team: empty, held by a connected human, or filled by a bot. */
export interface Slot {
  id: string;
  team: Team;

  /** Empty for a bot slot. */
  playerId: string;
  name: string;

  isBot: boolean;
  /** Only meaningful when `isBot`. */
  difficulty: string;

  /** Null until chosen. */
  element: ElementId | null;
  ready: boolean;

  /**
   * Set while a spectator has reserved this bot (or empty) slot for the next
   * rematch; the bot keeps playing until then.
   */
  pendingClaimPlayerId: string;
}

/** A human watching an in-progress match. */
export interface Spectator {
  playerId: string;
  name: string;
  claimedSlotId: string;
}

interface Member {
  name: string;
  /** Null until selectTeam. */
  team: Team | null;
}

/** The compact view used by `list_rooms`. */
export interface RoomSummary {
  roomId: string;
  teamSize: number;
  state: RoomState;
  filled: number;
  capacity: number;
  openBotSlots: number;
  acceptsSpectators: boolean;
}

export class Room {
  /** Set at create time; App calls fillEmptyWithBots once the host has a seat. */
  fillBots = false;
  botDifficulty = DEFAULT_BOT_DIFFICULTY;

  private roomState: RoomState = 'lobby';

  private readonly members = new Map<string, Member>();
  private readonly spectatorsById = new Map<string, Spectator>();
  private readonly slotsByTeam = new Map<Team, Slot[]>([
    [TEAM_A, []],
    [TEAM_B, []],
  ]);
  private nextSeq = 0;

  private liveWorld: World | null = null;

  /** Team size is between 1 and 6; capacity is 2 * teamSize (GDD §7). */
  constructor(
    readonly id: string,
    readonly teamSize: number,
  ) {
    if (!Number.isInteger(teamSize) || teamSize < MIN_TEAM_SIZE || teamSize > MAX_TEAM_SIZE) {
      throw new Error(
        `room: teamSize must be an integer between ${MIN_TEAM_SIZE} and ${MAX_TEAM_SIZE}, got ${teamSize}`,
      );
    }
  }

  get state(): RoomState {
    return this.roomState;
  }

  /** The live simulation once a match has started, or null before that. */
  get world(): World | null {
    return this.liveWorld;
  }

  /** Registers a connected player in the lobby without a team yet. */
  join(playerId: string, name: string): void {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot join, room is ${this.roomState}`);
    }
    if (this.members.has(playerId)) throw new Error(`room: player ${playerId} already joined`);
    if (this.spectatorsById.has(playerId)) {
      throw new Error(`room: player ${playerId} already spectating`);
    }
    if (this.occupiedCount() >= this.capacity()) throw new Error('room: room is full');

    this.members.set(playerId, { name, team: null });
  }

  /**
   * Registers a viewer during an in-progress match. They do not occupy a team
   * slot until they claim one and a rematch applies the claim.
   */
  joinAsSpectator(playerId: string, name: string): void {
    if (this.roomState !== 'in_progress') {
      throw new Error(`room: cannot spectate, room is ${this.roomState}`);
    }
    if (this.members.has(playerId)) throw new Error(`room: player ${playerId} already joined`);
    if (this.spectatorsById.has(playerId)) {
      throw new Error(`room: player ${playerId} already spectating`);
    }
    if (this.spectatorsById.size >= MAX_SPECTATORS) throw new Error('room: spectator limit reached');

    this.spectatorsById.set(playerId, { playerId, name, claimedSlotId: '' });
  }

  /** Removes a player (member or spectator), freeing their slot / pending claim. */
  leave(playerId: string): void {
    const spec = this.spectatorsById.get(playerId);
    if (spec) {
      if (spec.claimedSlotId) this.clearClaimOnSlot(spec.claimedSlotId);
      this.spectatorsById.delete(playerId);
      return;
    }

    const mem = this.members.get(playerId);
    if (!mem) throw new Error(`room: player ${playerId} is not in this room`);
    if (mem.team !== null) this.removeSlotFor(mem.team, playerId);
    this.members.delete(playerId);
  }

  /** Assigns (or re-assigns) a player to a team, allocating them a slot. */
  selectTeam(playerId: string, team: Team): void {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot select team, room is ${this.roomState}`);
    }
    const mem = this.members.get(playerId);
    if (!mem) throw new Error(`room: player ${playerId} has not joined this room`);
    if (mem.team === team) return;
    if (this.slotsFor(team).length >= this.teamSize) throw new Error(`room: team ${team} is full`);

    if (mem.team !== null) this.removeSlotFor(mem.team, playerId);

    this.nextSeq++;
    this.slotsFor(team).push({
      id: `${this.id}-slot-${this.nextSeq}`,
      team,
      playerId,
      name: mem.name,
      isBot: false,
      difficulty: '',
      element: null,
      ready: false,
      pendingClaimPlayerId: '',
    });
    mem.team = team;
  }

  /**
   * Whether `element` is still free on a team (GDD §7 uniqueness rule: no two
   * mages on the same team share an element).
   */
  canSelectElement(team: Team, element: ElementId): boolean {
    return !this.slotsFor(team).some((s) => s.element === element);
  }

  selectElement(playerId: string, element: string): void {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot select element, room is ${this.roomState}`);
    }
    const mem = this.members.get(playerId);
    if (!mem) throw new Error(`room: player ${playerId} has not joined this room`);
    if (mem.team === null) {
      throw new Error(`room: player ${playerId} must select a team before an element`);
    }
    if (!elementDefFor(element as ElementId)) {
      throw new Error(`room: unknown element ${JSON.stringify(element)}`);
    }
    if (!this.canSelectElement(mem.team, element as ElementId)) {
      throw new Error(`room: element ${JSON.stringify(element)} is already taken on team ${mem.team}`);
    }

    const slot = this.findSlot(mem.team, playerId);
    if (!slot) throw new Error(`room: internal error: no slot found for player ${playerId}`);
    slot.element = element as ElementId;
  }

  /**
   * Fills an empty seat with a bot, auto-selecting the first catalog element
   * that isn't already used on that team (GDD §7).
   */
  addBot(team: Team, difficulty: string): Slot {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot add bot, room is ${this.roomState}`);
    }
    if (this.slotsFor(team).length >= this.teamSize) throw new Error(`room: team ${team} is full`);

    const diff = difficulty || DEFAULT_BOT_DIFFICULTY;
    const element = this.firstFreeElement(team);
    if (!element) throw new Error(`room: no free element left on team ${team}`);

    this.nextSeq++;
    const slot: Slot = {
      id: `${this.id}-slot-${this.nextSeq}`,
      team,
      playerId: '',
      name: `Bot (${diff})`,
      isBot: true,
      difficulty: diff,
      element,
      ready: true,
      pendingClaimPlayerId: '',
    };
    this.slotsFor(team).push(slot);
    return slot;
  }

  /** Fills every remaining seat on both teams with bots. */
  fillEmptyWithBots(difficulty: string): void {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot fill bots, room is ${this.roomState}`);
    }
    const diff = difficulty || this.botDifficulty || DEFAULT_BOT_DIFFICULTY;
    for (const team of TEAMS) {
      while (this.slotsFor(team).length < this.teamSize) this.addBot(team, diff);
    }
  }

  /** Removes a bot slot, freeing its team capacity and element. */
  removeBot(slotId: string): void {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot remove bot, room is ${this.roomState}`);
    }
    for (const team of TEAMS) {
      const slots = this.slotsFor(team);
      const i = slots.findIndex((s) => s.id === slotId && s.isBot);
      if (i === -1) continue;

      const claimant = slots[i].pendingClaimPlayerId;
      if (claimant) {
        const spec = this.spectatorsById.get(claimant);
        if (spec) spec.claimedSlotId = '';
      }
      slots.splice(i, 1);
      return;
    }
    throw new Error(`room: no bot slot ${JSON.stringify(slotId)} found`);
  }

  /**
   * Lets a spectator reserve a bot slot for the next rematch. The bot keeps
   * playing until applyClaims runs at round end.
   */
  claimSlot(playerId: string, slotId: string): void {
    if (this.roomState !== 'in_progress' && this.roomState !== 'lobby') {
      throw new Error(`room: cannot claim slot, room is ${this.roomState}`);
    }
    const spec = this.spectatorsById.get(playerId);
    if (!spec) throw new Error(`room: player ${playerId} is not a spectator`);

    const slot = this.findSlotById(slotId);
    if (!slot) throw new Error(`room: slot ${JSON.stringify(slotId)} not found`);
    if (!slot.isBot && slot.playerId) {
      throw new Error(`room: slot ${JSON.stringify(slotId)} is occupied by a human`);
    }
    if (slot.pendingClaimPlayerId && slot.pendingClaimPlayerId !== playerId) {
      throw new Error(`room: slot ${JSON.stringify(slotId)} already claimed`);
    }
    if (spec.claimedSlotId && spec.claimedSlotId !== slotId) {
      this.clearClaimOnSlot(spec.claimedSlotId);
    }

    slot.pendingClaimPlayerId = playerId;
    spec.claimedSlotId = slotId;
  }

  setReady(playerId: string, ready: boolean): void {
    const mem = this.members.get(playerId);
    if (!mem) throw new Error(`room: player ${playerId} has not joined this room`);
    if (mem.team === null) throw new Error(`room: player ${playerId} must select a team first`);

    const slot = this.findSlot(mem.team, playerId);
    if (!slot) throw new Error(`room: internal error: no slot found for player ${playerId}`);
    slot.ready = ready;
  }

  /**
   * Validates that both teams are completely filled with valid elements, builds
   * the authoritative World, and moves the room to in_progress.
   */
  startMatch(): World {
    if (this.roomState !== 'lobby') {
      throw new Error(`room: cannot start match, room is ${this.roomState}`);
    }
    for (const team of TEAMS) {
      const slots = this.slotsFor(team);
      if (slots.length !== this.teamSize) {
        throw new Error(`room: team ${team} has ${slots.length}/${this.teamSize} slots filled`);
      }
      for (const s of slots) {
        if (!s.element) {
          throw new Error(
            `room: slot ${JSON.stringify(s.id)} on team ${team} has no element selected`,
          );
        }
      }
    }

    /*
     * Room only builds the empty World — the squads themselves are Session's
     * job (`World.initSquad`, GDD §4, §7), since Session is what knows the
     * bot roster and the AI commanders that squad needs wiring to. Slot and
     * element selection survive above purely as lobby state for custom rooms
     * — the simulation no longer reads either.
     */
    const world = new World();

    this.liveWorld = world;
    this.roomState = 'in_progress';
    return world;
  }

  /** "player", "spectator", or "" if the id is unknown. */
  roleOf(playerId: string): string {
    if (this.members.has(playerId)) return 'player';
    if (this.spectatorsById.has(playerId)) return 'spectator';
    return '';
  }

  /** Every human connected to the room (seated players and spectators). */
  memberIds(): string[] {
    return [...this.members.keys(), ...this.spectatorsById.keys()];
  }

  spectators(): Spectator[] {
    return [...this.spectatorsById.values()].map((s) => ({ ...s }));
  }

  /** A value-copy snapshot of every occupied slot across both teams. */
  slots(): Slot[] {
    return TEAMS.flatMap((team) => this.slotsFor(team).map((s) => ({ ...s })));
  }

  summary(): RoomSummary {
    const slots = this.slots();
    return {
      roomId: this.id,
      teamSize: this.teamSize,
      state: this.roomState,
      filled: slots.length,
      openBotSlots: slots.filter((s) => s.isBot && !s.pendingClaimPlayerId).length,
      capacity: this.capacity(),
      acceptsSpectators: this.roomState === 'in_progress' && this.spectatorsById.size < MAX_SPECTATORS,
    };
  }

  /** Abandon path; a rematch uses resetToLobby instead. */
  markEnded(): void {
    this.roomState = 'ended';
  }

  /** Converts pending spectator claims into seated human slots. */
  applyClaims(): void {
    for (const team of TEAMS) {
      for (const s of this.slotsFor(team)) {
        if (!s.pendingClaimPlayerId) continue;

        const spec = this.spectatorsById.get(s.pendingClaimPlayerId);
        if (!spec) {
          s.pendingClaimPlayerId = '';
          continue;
        }

        s.isBot = false;
        s.difficulty = '';
        s.playerId = spec.playerId;
        s.name = spec.name;
        s.ready = false;
        s.pendingClaimPlayerId = '';

        this.members.set(spec.playerId, { name: spec.name, team });
        this.spectatorsById.delete(spec.playerId);
      }
    }
  }

  /**
   * Clears the live world and returns the room to lobby for a rematch. Humans
   * keep their seats and bots stay until claimed/removed; ready is cleared so
   * everyone confirms for the next round.
   */
  resetToLobby(): void {
    this.liveWorld = null;
    this.roomState = 'lobby';
    for (const team of TEAMS) {
      for (const s of this.slotsFor(team)) {
        if (!s.isBot) s.ready = false;
      }
    }
  }

  private capacity(): number {
    return this.teamSize * 2;
  }

  private occupiedCount(): number {
    // Members that already have a team are represented both in `members` and in
    // a team's slot list, so subtract them to avoid double counting.
    const seated = [...this.members.values()].filter((m) => m.team !== null).length;
    return this.members.size + this.slotsFor(TEAM_A).length + this.slotsFor(TEAM_B).length - seated;
  }

  private slotsFor(team: Team): Slot[] {
    return this.slotsByTeam.get(team) as Slot[];
  }

  private firstFreeElement(team: Team): ElementId | null {
    return ALL_ELEMENTS.find((id) => this.canSelectElement(team, id)) ?? null;
  }

  /** Exposed for tests; App goes through slots(). */
  findSlot(team: Team, playerId: string): Slot | undefined {
    return this.slotsFor(team).find((s) => s.playerId === playerId);
  }

  private findSlotById(slotId: string): Slot | undefined {
    for (const team of TEAMS) {
      const found = this.slotsFor(team).find((s) => s.id === slotId);
      if (found) return found;
    }
    return undefined;
  }

  private clearClaimOnSlot(slotId: string): void {
    const s = this.findSlotById(slotId);
    if (s) s.pendingClaimPlayerId = '';
  }

  private removeSlotFor(team: Team, playerId: string): void {
    const slots = this.slotsFor(team);
    const i = slots.findIndex((s) => s.playerId === playerId);
    if (i !== -1) slots.splice(i, 1);
  }
}
