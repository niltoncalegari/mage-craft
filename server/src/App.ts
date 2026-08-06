/**
 * The composition root's message dispatcher: it decodes protocol messages,
 * drives RoomManager + Session, and broadcasts results back out through the
 * Hub. The only piece of the server that knows about every layer, by design.
 */

import type { Team } from '../../sim/entities';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import { defaultDeck, validateDeck } from '../../sim/Deck';
import { ALL_ELEMENTS } from '../../sim/elements';
import { isSpellId, type CardId } from '../../sim/spells';
import type {
  AddBotMsg,
  CastMsg,
  ClaimSlotMsg,
  CreateRoomMsg,
  JoinQueueMsg,
  JoinRoomMsg,
  PlayerSlotDTO,
  RemoveBotMsg,
  RoomStateMsg,
  SelectElementMsg,
  SelectTeamMsg,
  ServerMsg,
  SetReadyMsg,
  SnapshotMsg,
  SpectatorDTO,
  Vec2DTO,
} from '../../sim/protocol';
import { peekType } from '../../sim/protocol';
import { Vec2 } from '../../sim/Vec2';
import { Matchmaker, type Pairing } from './Matchmaker';
import { RoomManager } from './RoomManager';
import { Session, type Snapshot } from './Session';

/** How often the queue is swept for pairings. */
const MATCHMAKING_INTERVAL_MS = 1000;

/** Element assigned to a queued seat; vestigial lobby state, see startQueuedMatch. */
const QUEUE_ELEMENT = ALL_ELEMENTS[0];

/** How hard the queue's fallback commander plays (GDD §10). */
const QUEUE_BOT_DIFFICULTY = 'normal';

/**
 * The slice of the Hub that App actually uses. Depending on the interface
 * rather than the class keeps App testable against a recording double without
 * opening real sockets — Hub satisfies it structurally.
 */
export interface Transport {
  sendTo(clientId: string, data: string): boolean;
  broadcast(clientIds: Iterable<string>, data: string): void;
}

export class App {
  private readonly rooms = new RoomManager();
  private readonly sessions = new Map<string, Session>();
  private readonly clientRoom = new Map<string, string>();
  private readonly matchmaker = new Matchmaker();
  private queueTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly hub: Transport,
    /** Injected so tests can drive the bot-fallback timeout without waiting. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Starts the periodic queue sweep. Required in production because the
   * bot-fallback fires on elapsed time, not on a player action — a lone player
   * on an empty server would otherwise wait forever.
   */
  startMatchmaking(): void {
    this.stopMatchmaking();
    this.queueTimer = setInterval(() => this.sweepQueue(), MATCHMAKING_INTERVAL_MS);
    this.queueTimer.unref?.();
  }

  stopMatchmaking(): void {
    if (this.queueTimer !== null) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
  }

  /** The Hub's message handler. */
  handleMessage(clientId: string, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      this.sendError(clientId, `malformed message: ${errorMessage(err)}`);
      return;
    }

    const type = peekType(msg);
    if (!type) {
      this.sendError(clientId, 'protocol: message is missing a "type" field');
      return;
    }

    switch (type) {
      case 'create_room':
        this.handleCreateRoom(clientId, msg as CreateRoomMsg);
        break;
      case 'join_room':
        this.handleJoinRoom(clientId, msg as JoinRoomMsg);
        break;
      case 'list_rooms':
        this.handleListRooms(clientId);
        break;
      case 'select_team':
        this.withRoom(clientId, (sess, roomId) => {
          sess.selectTeam(clientId, teamFromWire((msg as SelectTeamMsg).team));
          this.broadcastRoomState(roomId);
        });
        break;
      case 'select_element':
        this.withRoom(clientId, (sess, roomId) => {
          sess.selectElement(clientId, (msg as SelectElementMsg).element);
          // Auto-fill remaining seats when the room was created with fillBots.
          if (sess.room.fillBots) {
            try {
              sess.fillEmptyWithBots(sess.room.botDifficulty);
            } catch {
              // Best-effort: a full room or an exhausted element catalog is not
              // an error the player who picked an element should hear about.
            }
          }
          this.broadcastRoomState(roomId);
        });
        break;
      case 'add_bot':
        this.withRoom(clientId, (sess, roomId) => {
          const m = msg as AddBotMsg;
          sess.addBot(teamFromWire(m.team), m.difficulty);
          this.broadcastRoomState(roomId);
        });
        break;
      case 'remove_bot':
        this.withRoom(clientId, (sess, roomId) => {
          sess.removeBot((msg as RemoveBotMsg).slotId);
          this.broadcastRoomState(roomId);
        });
        break;
      case 'claim_slot':
        this.withRoom(clientId, (sess, roomId) => {
          sess.claimSlot(clientId, (msg as ClaimSlotMsg).slotId);
          this.broadcastRoomState(roomId);
        });
        break;
      case 'set_ready':
        this.withRoom(clientId, (sess, roomId) => {
          sess.setReady(clientId, (msg as SetReadyMsg).ready);
          this.broadcastRoomState(roomId);
        });
        break;
      case 'start_match':
        this.withRoom(clientId, (sess, roomId) => {
          sess.startMatch();
          this.broadcastRoomState(roomId);
          this.broadcastToHumans(roomId, { type: 'match_start' });
          sess.runLoop();
        });
        break;
      case 'join_queue':
        this.handleJoinQueue(clientId, msg as JoinQueueMsg);
        break;
      case 'leave_queue':
        this.matchmaker.leave(clientId);
        break;
      case 'cast':
        this.handleCast(clientId, msg as CastMsg);
        break;
      default:
        this.sendError(clientId, `unknown message type ${JSON.stringify(type)}`);
    }
  }

  /** The Hub's disconnect handler. */
  handleDisconnect(clientId: string): void {
    this.matchmaker.leave(clientId);

    const roomId = this.clientRoom.get(clientId);
    this.clientRoom.delete(clientId);
    if (!roomId) return;

    const sess = this.sessions.get(roomId);
    if (!sess) return;
    try {
      sess.leave(clientId);
    } catch {
      return; // Not a member — nothing to broadcast.
    }
    this.broadcastRoomState(roomId);
  }

  /** Stops every running match loop. Used on shutdown and by tests. */
  dispose(): void {
    this.stopMatchmaking();
    for (const sess of this.sessions.values()) sess.stop();
  }

  /* ---- handlers --------------------------------------------------------- */

  private handleCreateRoom(clientId: string, msg: CreateRoomMsg): void {
    let room;
    try {
      room = this.rooms.createRoom(msg.teamSize);
    } catch (err) {
      this.sendError(clientId, errorMessage(err));
      return;
    }

    room.fillBots = msg.fillBots ?? false;
    if (msg.botDifficulty) room.botDifficulty = msg.botDifficulty;

    const roomId = room.id;
    const session = new Session(room, {
      onSnapshot: (snap) => this.broadcastSnapshot(roomId, snap),
      onRoundEnd: (winner) => this.broadcastRoundEnd(roomId, winner),
    });
    this.sessions.set(roomId, session);

    // The creator hasn't joined yet (create_room carries no player name); they
    // still get the fresh, empty room so the client can show the room code and
    // immediately follow up with join_room.
    this.sendJSON(clientId, { ...this.buildRoomState(roomId), youRole: session.roleOf(clientId) });
  }

  private handleJoinRoom(clientId: string, msg: JoinRoomMsg): void {
    const sess = this.sessions.get(msg.roomId);
    if (!sess) {
      this.sendError(clientId, `room ${JSON.stringify(msg.roomId)} not found`);
      return;
    }
    try {
      sess.join(clientId, msg.name);
    } catch (err) {
      this.sendError(clientId, errorMessage(err));
      return;
    }

    this.clientRoom.set(clientId, msg.roomId);
    this.broadcastRoomState(msg.roomId);
  }

  private handleListRooms(clientId: string): void {
    this.sendJSON(clientId, {
      type: 'room_list',
      rooms: [...this.sessions.values()]
        .map((s) => s.summary())
        .filter((s) => s.state !== 'ended'),
    });
  }

  /**
   * The one in-match action (GDD §13). Unlike the ~60 Hz input it replaced this
   * is a sparse, discrete event, so a rejection is worth telling the player
   * about — they just tried to spend mana and nothing happened.
   */
  private handleCast(clientId: string, msg: CastMsg): void {
    const sess = this.sessionForClient(clientId);
    if (!sess) return;

    try {
      const result = sess.submitCast(clientId, msg.cardId, toVec2(msg.position));
      if (!result.ok) this.sendError(clientId, `cast rejected: ${result.reason}`);
    } catch {
      // A cast that lands before the match starts isn't worth a round-trip.
    }
  }

  /* ---- matchmaking (GDD §4) ---------------------------------------------- */

  private handleJoinQueue(clientId: string, msg: JoinQueueMsg): void {
    const deck = this.resolveDeck(clientId, msg.deck);
    if (!deck) return;

    this.matchmaker.join({
      clientId,
      name: msg.name || 'Conjurador',
      deck,
      joinedAt: this.now() / 1000,
    });
    this.sendQueueStatus(clientId);
    this.sweepQueue();
  }

  /** Validates a submitted deck, falling back to the default when none is sent. */
  private resolveDeck(clientId: string, cards: string[] | undefined): CardId[] | null {
    if (!cards) return defaultDeck();

    const check = validateDeck(cards);
    if (!check.ok) {
      this.sendError(clientId, `invalid deck: ${check.reason}`);
      return null;
    }
    return cards.filter(isSpellId);
  }

  private sendQueueStatus(clientId: string): void {
    const entry = this.matchmaker.entryOf(clientId);
    if (!entry) return;
    this.sendJSON(clientId, {
      type: 'queue_status',
      waiting: this.matchmaker.size,
      position: this.matchmaker.positionOf(clientId),
      elapsedSeconds: Math.max(0, this.now() / 1000 - entry.joinedAt),
    });
  }

  /** Pairs whoever is ready and starts their matches. Safe to call often. */
  sweepQueue(): void {
    for (const pairing of this.matchmaker.pair(this.now() / 1000)) {
      this.startQueuedMatch(pairing);
    }
  }

  /**
   * Builds a 1v1 room for a pairing and starts it immediately — no lobby, no
   * ready-up, no room code. An unpaired player gets a bot seat, which Session
   * hands to an AI commander.
   */
  private startQueuedMatch(pairing: Pairing): void {
    const { a, b } = pairing;

    let room;
    try {
      room = this.rooms.createRoom(1);
    } catch (err) {
      this.sendError(a.clientId, errorMessage(err));
      return;
    }

    const roomId = room.id;
    const session = new Session(room, {
      onSnapshot: (snap) => this.broadcastSnapshot(roomId, snap),
      onRoundEnd: (winner) => this.broadcastRoundEnd(roomId, winner),
    });
    this.sessions.set(roomId, session);

    const seated: { entry: typeof a; team: Team }[] = [{ entry: a, team: TEAM_A }];
    if (b) seated.push({ entry: b, team: TEAM_B });

    try {
      for (const { entry, team } of seated) {
        session.join(entry.clientId, entry.name);
        session.selectTeam(entry.clientId, team);
        /*
         * The lobby still refuses to start a room with a seat that has no
         * element, even though the simulation stopped reading slot elements at
         * the pivot (a unit's element comes from its card now). A queued player
         * is never asked to pick one, so the queue picks for them. Delete this
         * line the day Room drops the requirement.
         */
        session.selectElement(entry.clientId, QUEUE_ELEMENT);
        session.setDeck(entry.clientId, entry.deck);
        session.setReady(entry.clientId, true);
        this.clientRoom.set(entry.clientId, roomId);
      }
      // The AI's seat has to exist for the room to be startable; Session gives
      // any bot seat a Commander.
      if (!b) session.addBot(TEAM_B, QUEUE_BOT_DIFFICULTY);
      session.startMatch();
    } catch (err) {
      this.sessions.delete(roomId);
      this.rooms.removeRoom(roomId);
      for (const { entry } of seated) {
        this.clientRoom.delete(entry.clientId);
        this.sendError(entry.clientId, errorMessage(err));
      }
      return;
    }

    for (const { entry, team } of seated) {
      const opponent = seated.find((s) => s.entry !== entry)?.entry;
      this.sendJSON(entry.clientId, {
        type: 'match_found',
        roomId,
        opponentName: opponent?.name ?? 'Autômato Arcano',
        yourTeam: team,
        againstBot: !opponent,
      });
    }

    this.broadcastRoomState(roomId);
    this.broadcastToHumans(roomId, { type: 'match_start' });
    session.runLoop();
  }

  /**
   * Resolves the caller's session and runs `fn`, reporting any rejection back
   * to that client as an `error` message. This is the shape every lobby action
   * shares.
   */
  private withRoom(clientId: string, fn: (sess: Session, roomId: string) => void): void {
    const roomId = this.clientRoom.get(clientId);
    const sess = roomId ? this.sessions.get(roomId) : undefined;
    if (!roomId || !sess) {
      this.sendError(clientId, 'you have not joined a room');
      return;
    }
    try {
      fn(sess, roomId);
    } catch (err) {
      this.sendError(clientId, errorMessage(err));
    }
  }

  private sessionForClient(clientId: string): Session | undefined {
    const roomId = this.clientRoom.get(clientId);
    return roomId ? this.sessions.get(roomId) : undefined;
  }

  /* ---- broadcasts ------------------------------------------------------- */

  private buildRoomState(roomId: string): RoomStateMsg {
    const sess = this.sessions.get(roomId);
    if (!sess) throw new Error(`app: no session for room ${roomId}`);

    return {
      type: 'room_state',
      roomId,
      teamSize: sess.room.teamSize,
      state: sess.state,
      fillBots: sess.room.fillBots,
      slots: sess.slots().map(
        (s): PlayerSlotDTO => ({
          slotId: s.id,
          team: s.team,
          // Empty strings are omitted rather than sent, matching the Go
          // server's `omitempty` — the client tests fields for presence.
          playerId: s.playerId || undefined,
          name: s.name || undefined,
          isBot: s.isBot,
          element: s.element ?? undefined,
          ready: s.ready,
          pendingClaimPlayerId: s.pendingClaimPlayerId || undefined,
        }),
      ),
      spectators: sess.spectators().map(
        (sp): SpectatorDTO => ({
          playerId: sp.playerId,
          name: sp.name,
          claimedSlotId: sp.claimedSlotId || undefined,
        }),
      ),
    };
  }

  /** Sends the current room_state to every connected human, each with their own youRole. */
  private broadcastRoomState(roomId: string): void {
    const sess = this.sessions.get(roomId);
    if (!sess) return;

    const base = this.buildRoomState(roomId);
    for (const id of this.humanIds(roomId)) {
      this.sendJSON(id, { ...base, youRole: sess.roleOf(id) });
    }
  }

  private broadcastSnapshot(roomId: string, snap: Snapshot): void {
    const msg: Omit<SnapshotMsg, 'mana' | 'hand' | 'next'> = {
      type: 'snapshot',
      tick: snap.tick,
      elapsed: snap.elapsed,
      suddenDeath: snap.suddenDeath,
      structures: snap.structures.map((s) => ({
        id: s.id,
        team: s.team,
        kind: s.kind,
        position: fromVec2(s.position),
        radius: s.radius,
        health: s.health,
        maxHealth: s.maxHealth,
        alive: s.alive,
        invulnerable: s.invulnerable,
      })),
      mages: snap.mages.map((m) => ({
        id: m.id,
        team: m.team,
        position: fromVec2(m.position),
        facing: fromVec2(m.facing),
        health: m.health,
        maxHealth: m.maxHealth,
        charging: m.charging,
        charge: m.charge,
        element: m.element,
        role: m.role,
        shielded: m.shielded,
        hasted: m.hasted,
        slowed: m.slowed,
        ...(m.rosterId ? { rosterId: m.rosterId } : {}),
      })),
      projectiles: snap.projectiles.map((p) => ({
        id: p.id,
        element: p.element,
        position: fromVec2(p.position),
        velocity: fromVec2(p.velocity),
        height: p.height,
        radius: p.radius,
      })),
      puddles: snap.puddles.map((pu) => ({
        id: pu.id,
        position: fromVec2(pu.position),
        radius: pu.radius,
        remaining: pu.remaining,
      })),
      spells: snap.spells.map((fx) => ({
        id: fx.id,
        spellId: fx.spellId,
        team: fx.team,
        position: fromVec2(fx.position),
        radius: fx.radius,
      })),
    };

    // Mana and hand are per-receiver: you see your own bar and your own cards,
    // never the opponent's. A spectator has neither.
    const sess = this.sessions.get(roomId);
    for (const id of this.humanIds(roomId)) {
      const team = sess?.teamOf(id) ?? null;
      if (team === null) {
        this.sendJSON(id, { ...msg, mana: 0, hand: [] });
        continue;
      }

      const deck = sess?.deckFor(team) ?? null;
      const next = deck?.next() ?? null;
      this.sendJSON(id, {
        ...msg,
        mana: snap.mana[team] ?? 0,
        hand: deck?.hand() ?? [],
        ...(next ? { next } : {}),
      });
    }
  }

  private broadcastRoundEnd(roomId: string, winnerTeam: number): void {
    this.broadcastToHumans(roomId, { type: 'round_end', winnerTeam });
    // A rematch resets the room to lobby; push the new roster (claims applied).
    this.broadcastRoomState(roomId);
  }

  /**
   * Every connected human in a room: the roster plus any seated player whose
   * membership record was already dropped (they still hold a slot).
   */
  private humanIds(roomId: string): string[] {
    const sess = this.sessions.get(roomId);
    if (!sess) return [];

    const ids = new Set(sess.memberIds());
    for (const s of sess.slots()) {
      if (!s.isBot && s.playerId) ids.add(s.playerId);
    }
    return [...ids];
  }

  private broadcastToHumans(roomId: string, msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    this.hub.broadcast(this.humanIds(roomId), payload);
  }

  private sendError(clientId: string, message: string): void {
    this.sendJSON(clientId, { type: 'error', message });
  }

  private sendJSON(clientId: string, msg: ServerMsg): void {
    this.hub.sendTo(clientId, JSON.stringify(msg));
  }
}

function toVec2(v: Vec2DTO | undefined): Vec2 {
  if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') return Vec2.zero;
  return new Vec2(v.x, v.y);
}

function fromVec2(v: Vec2): Vec2DTO {
  return { x: v.x, y: v.y };
}

function teamFromWire(team: number): Team {
  return team === 1 ? TEAM_B : TEAM_A;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
