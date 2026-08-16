/**
 * The composition root's message dispatcher: it decodes protocol messages,
 * drives RoomManager + Session, and broadcasts results back out through the
 * Hub. The only piece of the server that knows about every layer, by design.
 */

import { isRosterId, type RosterId } from '../../sim/cards';
import type { Team } from '../../sim/entities';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import { defaultDeck, validateDeck } from '../../sim/Deck';
import { PICKABLE_ELEMENTS } from '../../sim/elements';
import type { MatchSummary } from '../../sim/matchStats';
import { validateSquad } from '../../sim/squad';
import { isSpellId, type CardId } from '../../sim/spells';
import { validateStrategy, type Strategy } from '../../sim/strategy';
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
    { deck?: CardId[]; squad?: RosterId[]; strategy?: Strategy }
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
    // `join_queue.deck` predates `set_loadout` and still wins when sent, so an
    // older client keeps working; everything else comes from the stored loadout.
    const deck = msg.deck ? this.resolveDeck(clientId, msg.deck) : (stored?.deck ?? defaultDeck());
    if (!deck) return;

    this.matchmaker.join({
      clientId,
      name: msg.name || 'Conjurer',
      deck,
      squad: stored?.squad,
      strategy: this.strategyFor(clientId, deck),
      joinedAt: this.now() / 1000,
      rating: msg.rating,
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

  /** Validates a submitted squad. Unlike a deck, absence means "keep the default". */
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
   * Validates a submitted strategy program against the deck it will be played
   * with. Like a squad, absence means "keep what you had".
   *
   * The deck argument is not optional for a reason: a rule naming a card the
   * player did not bring can never fire, so a program is only meaningful
   * relative to a deck. `validateStrategy` enforces that, which is what turns a
   * silently inert program into a rejected one.
   */
  private resolveStrategy(clientId: string, value: unknown, deck: readonly CardId[]): Strategy | null {
    const check = validateStrategy(value, deck);
    if (!check.ok) {
      this.sendError(clientId, `invalid strategy: ${check.reason}`);
      return null;
    }
    return value as Strategy;
  }

  /**
   * The stored program for a client, but only when it is still legal against
   * the deck actually being fielded.
   *
   * The two halves arrive as separate messages and in either order, so a deck
   * that lands after a program can orphan rules that name cards it dropped.
   * Withholding the program then is what makes Session fall back to
   * `defaultStrategy(deck)` — a seat that plays badly beats one that has a
   * program and casts nothing.
   */
  private strategyFor(clientId: string, deck: readonly CardId[]): Strategy | undefined {
    const stored = this.loadouts.get(clientId)?.strategy;
    if (!stored) return undefined;
    return validateStrategy(stored, deck).ok ? stored : undefined;
  }

  /**
   * Records what this client brings to their next match. Deliberately outside
   * `withRoom`: it arrives before a room exists on the queue path, and applying
   * it to an already-joined room is handled here too so the order of the two
   * messages never matters.
   */
  private handleSetLoadout(clientId: string, msg: SetLoadoutMsg): void {
    // Validate every part before committing any: a message that half-applies
    // would leave the player fielding a squad they can see and a deck they
    // cannot, with only an error message to explain the difference.
    const deck = msg.deck ? this.resolveDeck(clientId, msg.deck) : undefined;
    if (msg.deck && !deck) return;

    const squad = msg.squad ? this.resolveSquad(clientId, msg.squad) : undefined;
    if (msg.squad && !squad) return;

    const stored = this.loadouts.get(clientId) ?? {};
    // Checked against the deck this very message settles on, not against
    // whatever was stored before it — otherwise sending both at once would
    // validate the new program against the old cards.
    const against = deck ?? stored.deck ?? defaultDeck();
    const strategy =
      msg.strategy !== undefined ? this.resolveStrategy(clientId, msg.strategy, against) : undefined;
    if (msg.strategy !== undefined && !strategy) return;

    if (deck) stored.deck = deck;
    if (squad) stored.squad = squad;
    if (strategy) stored.strategy = strategy;

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

    if (loadout.deck) sess.setDeck(clientId, loadout.deck);
    if (loadout.squad) sess.setSquad(clientId, loadout.squad);

    const strategy = this.strategyFor(clientId, loadout.deck ?? defaultDeck());
    if (strategy) sess.setStrategy(clientId, strategy);
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
        session.setDeck(entry.clientId, entry.deck);
        if (entry.squad) session.setSquad(entry.clientId, entry.squad);
        if (entry.strategy) session.setStrategy(entry.clientId, entry.strategy);
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
    // Mana and hand are per-receiver: you see your own bar and your own cards,
    // never the opponent's. A spectator has neither.
    const sess = this.sessions.get(roomId);
    for (const id of this.humanIds(roomId)) {
      const team = sess?.teamOf(id) ?? null;
      if (team === null) {
        this.sendJSON(id, toSnapshotMsg(snap, { mana: 0, hand: [] }));
        continue;
      }

      const deck = sess?.deckFor(team) ?? null;
      this.sendJSON(
        id,
        toSnapshotMsg(snap, {
          mana: snap.mana[team] ?? 0,
          hand: deck?.hand() ?? [],
          next: deck?.next() ?? null,
          // Per-recipient like the hand: which of *your* rules just fired is
          // the only in-match feedback an idle player gets, and the opponent
          // must not be able to read your program off the wire.
          firedRule: sess?.firedRuleFor(team) ?? null,
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
        casts: side.casts.map((c) => ({ cardId: c.cardId, casts: c.casts })),
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
