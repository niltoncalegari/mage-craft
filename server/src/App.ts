/**
 * The composition root's message dispatcher: it decodes protocol messages,
 * drives RoomManager + Session, and broadcasts results back out through the
 * Hub. The only piece of the server that knows about every layer, by design.
 */

import { isRosterId, type RosterId } from '../../sim/cards';
import type { Team } from '../../sim/entities';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import { isStance, type Stance } from '../../sim/abilityPolicy';
import { PICKABLE_ELEMENTS } from '../../sim/elements';
import type { MatchSummary } from '../../sim/matchStats';
import { validateSquad } from '../../sim/squad';
import type {
  AddBotMsg,
  ClaimSlotMsg,
  CreateRoomMsg,
  JoinQueueMsg,
  JoinRoomMsg,
  PlayerSlotDTO,
  RemoveBotMsg,
  RoomStateMsg,
  SelectElementMsg,
  SelectTeamMsg,
  SendEmoteMsg,
  ServerMsg,
  SetLoadoutMsg,
  SetReadyMsg,
  SpectatorDTO,
  TeamSummaryDTO,
} from '../../sim/protocol';
import { peekType } from '../../sim/protocol';
import { toSnapshotMsg } from '../../sim/snapshot';
import { Matchmaker, type Pairing } from './Matchmaker';
import { RoomManager } from './RoomManager';
import { Session, type Snapshot } from './Session';

/** How often the queue is swept for pairings. */
const MATCHMAKING_INTERVAL_MS = 1000;

/** Element assigned to a queued seat; vestigial lobby state, see startQueuedMatch. */
const QUEUE_ELEMENT = PICKABLE_ELEMENTS[0];

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
  /**
   * Loadouts registered before the player has a room. `set_loadout` has to work
   * pre-join — the queue seats you with no lobby at all — so this cannot live on
   * a Session the way decks used to.
   */
  private readonly loadouts = new Map<
    string,
    { squad?: RosterId[]; stances?: Partial<Record<RosterId, Stance>> }
  >();
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
      case 'set_loadout':
        this.handleSetLoadout(clientId, msg as SetLoadoutMsg);
        break;
      case 'cast':
        // Since the idle pivot a seat is played by the program its player wrote
        // before the match, so there is no by-hand cast to route. Answered
        // rather than dropped: an older client still sends this, and silence
        // would read to it as a lost message worth retrying.
        this.sendError(clientId, 'cast rejected: idle_mode');
        break;
      case 'send_emote':
        this.withRoom(clientId, (_sess, roomId) => {
          const emoteId = (msg as SendEmoteMsg).emoteId;
          if (typeof emoteId !== 'string' || emoteId.length === 0 || emoteId.length > 32) return;
          this.broadcastToHumans(roomId, { type: 'emote', playerId: clientId, emoteId });
        });
        break;
      default:
        this.sendError(clientId, `unknown message type ${JSON.stringify(type)}`);
    }
  }

  /** The Hub's disconnect handler. */
  handleDisconnect(clientId: string): void {
    this.matchmaker.leave(clientId);
    this.loadouts.delete(clientId);

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
      onMatchResult: (summary) => this.broadcastMatchResult(roomId, summary),
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
    // A loadout sent before the room existed still has to reach this seat.
    this.applyLoadout(clientId);
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

  /* ---- matchmaking (GDD §4) ---------------------------------------------- */

  private handleJoinQueue(clientId: string, msg: JoinQueueMsg): void {
    const stored = this.loadouts.get(clientId);

    this.matchmaker.join({
      clientId,
      name: msg.name || 'Conjurer',
      squad: stored?.squad,
      stances: stored?.stances,
      joinedAt: this.now() / 1000,
      rating: msg.rating,
    });
    this.sendQueueStatus(clientId);
    this.sweepQueue();
  }

  /** Validates a submitted squad. Absence means "keep the default". */
  private resolveSquad(clientId: string, ids: string[] | undefined): RosterId[] | null {
    if (!ids) return null;

    const check = validateSquad(ids);
    if (!check.ok) {
      this.sendError(clientId, `invalid squad: ${check.reason}`);
      return null;
    }
    return ids.filter(isRosterId);
  }

  /**
   * Validates the postures a client assigned their squad.
   *
   * Both halves are untrusted: the key has to be a roster entry that exists and
   * the value one of the three stances, so a client cannot smuggle an arbitrary
   * string into a `Record` the sim will later index. Rejected whole rather than
   * filtered, for the reason the squad is: silently dropping the half of a
   * loadout that did not parse fields a squad the player did not choose.
   *
   * A stance for a mage the player is not fielding is *not* an error. The two
   * halves arrive in either order and a builder may well remember a posture for
   * a mage on the bench; `initSquad` reads only what it needs.
   */
  private resolveStances(
    clientId: string,
    value: Record<string, string> | undefined,
  ): Partial<Record<RosterId, Stance>> | null {
    if (!value) return null;

    const out: Partial<Record<RosterId, Stance>> = {};
    for (const [id, stance] of Object.entries(value)) {
      if (!isRosterId(id)) {
        this.sendError(clientId, `invalid stances: unknown mage ${JSON.stringify(id)}`);
        return null;
      }
      if (!isStance(stance)) {
        this.sendError(clientId, `invalid stances: unknown stance ${JSON.stringify(stance)}`);
        return null;
      }
      out[id] = stance;
    }
    return out;
  }

  /**
   * Records what this client brings to their next match. Deliberately outside
   * `withRoom`: it arrives before a room exists on the queue path, and applying
   * it to an already-joined room is handled here too so the order of the two
   * messages never matters.
   */
  private handleSetLoadout(clientId: string, msg: SetLoadoutMsg): void {
    // Validate every part before committing any: a message that half-applies
    // would leave the player fielding mages they can see standing in postures
    // they did not choose, with only an error message to explain the difference.
    const squad = msg.squad ? this.resolveSquad(clientId, msg.squad) : undefined;
    if (msg.squad && !squad) return;

    const stances = msg.stances ? this.resolveStances(clientId, msg.stances) : undefined;
    if (msg.stances && !stances) return;

    const stored = this.loadouts.get(clientId) ?? {};
    if (squad) stored.squad = squad;
    if (stances) stored.stances = { ...stored.stances, ...stances };

    this.loadouts.set(clientId, stored);
    this.applyLoadout(clientId);
  }

  /** Pushes a stored loadout into the client's session, if they are already seated. */
  private applyLoadout(clientId: string): void {
    const loadout = this.loadouts.get(clientId);
    if (!loadout) return;

    const roomId = this.clientRoom.get(clientId);
    const sess = roomId ? this.sessions.get(roomId) : null;
    if (!sess) return;

    if (loadout.squad) sess.setSquad(clientId, loadout.squad);
    if (loadout.stances) sess.setStances(clientId, loadout.stances);
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
      onMatchResult: (summary) => this.broadcastMatchResult(roomId, summary),
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
        if (entry.squad) session.setSquad(entry.clientId, entry.squad);
        if (entry.stances) session.setStances(entry.clientId, entry.stances);
        session.setReady(entry.clientId, true);
        this.clientRoom.set(entry.clientId, roomId);
      }
      // The AI's seat has to exist for the room to be startable; Session gives
      // any bot seat the default squad, which spends its kits like any other.
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
        opponentName: opponent?.name ?? 'Arcane Automaton',
        yourTeam: team,
        againstBot: !opponent,
        opponentRating: opponent?.rating ?? null,
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
    // The board itself is the same bytes for everybody; what is per-receiver is
    // the account of your own squad. A spectator has no squad, so they get none.
    const sess = this.sessions.get(roomId);
    for (const id of this.humanIds(roomId)) {
      const team = sess?.teamOf(id) ?? null;
      if (team === null) {
        this.sendJSON(id, toSnapshotMsg(snap, {}));
        continue;
      }

      this.sendJSON(
        id,
        toSnapshotMsg(snap, {
          // Per-recipient: which of *your* mages just spent what is the only
          // in-match feedback an idle player gets, and the cadence of a squad's
          // kits must not be readable off the opponent's wire.
          firedAbility: sess?.firedAbilityFor(team) ?? null,
        }),
      );
    }
  }

  /**
   * The finished match's numbers, sent just before `round_end` so a client that
   * navigates on round end has already received them.
   */
  private broadcastMatchResult(roomId: string, summary: MatchSummary): void {
    const perTeam: Record<number, TeamSummaryDTO> = {};
    for (const [team, side] of Object.entries(summary.perTeam)) {
      perTeam[Number(team)] = {
        squad: [...side.squad],
        kills: side.kills,
        deaths: side.deaths,
        structuresDestroyed: side.structuresDestroyed,
        casts: side.casts.map((c) => ({
          cardId: c.cardId,
          ...(c.rosterId ? { rosterId: c.rosterId } : {}),
          casts: c.casts,
        })),
        mages: side.mages.map((m) => ({
          role: m.role,
          kills: m.kills,
          deaths: m.deaths,
          ...(m.rosterId ? { rosterId: m.rosterId } : {}),
        })),
      };
    }

    this.broadcastToHumans(roomId, {
      type: 'match_result',
      winnerTeam: summary.winnerTeam,
      durationSeconds: summary.durationSeconds,
      suddenDeath: summary.suddenDeath,
      perTeam,
    });
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

function teamFromWire(team: number): Team {
  return team === 1 ? TEAM_B : TEAM_A;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
