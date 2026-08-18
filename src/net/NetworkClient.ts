import {
  peekType,
  type ClientMsg,
  type EmoteMsg,
  type ErrorMsg,
  type MatchFoundMsg,
  type MatchResultMsg,
  type MatchStartMsg,
  type QueueStatusMsg,
  type RoomListMsg,
  type RoomStateMsg,
  type RoundEndMsg,
  type ServerMsg,
  type SnapshotMsg,
} from './protocol';

export type NetworkHandlers = {
  onRoomState?(msg: RoomStateMsg): void;
  onRoomList?(msg: RoomListMsg): void;
  onMatchStart?(msg: MatchStartMsg): void;
  onSnapshot?(msg: SnapshotMsg): void;
  onRoundEnd?(msg: RoundEndMsg): void;
  onMatchResult?(msg: MatchResultMsg): void;
  onQueueStatus?(msg: QueueStatusMsg): void;
  onMatchFound?(msg: MatchFoundMsg): void;
  onEmote?(msg: EmoteMsg): void;
  onError?(msg: ErrorMsg): void;
  onOpen?(): void;
  onClose?(): void;
};

/**
 * Same-origin `/ws`, mirroring how `/api` is reached (see ./ApiClient).
 *
 * This used to hard-code `:8080`, the port the game server listens on inside
 * its container. That only ever worked when the server happened to be
 * published on the host at that exact port — which the compose deployment does
 * not do: Nginx is the single published entrypoint and proxies `/ws` onward
 * (nginx.conf). Vite proxies it the same way in dev (vite.config.ts), so one
 * rule now covers both. `VITE_WS_URL` still overrides for split-host setups.
 *
 * `location.host` rather than `hostname`: it carries the port, which a VPS
 * served on something other than :80 needs.
 */
function defaultWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Thin WebSocket client for the mageserver protocol (see sim/protocol.ts).
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handlers: NetworkHandlers = {};
  private clientId: string;

  constructor(clientId?: string) {
    this.clientId = clientId ?? `web-${Math.random().toString(36).slice(2, 9)}`;
  }

  get id(): string {
    return this.clientId;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  setHandlers(handlers: NetworkHandlers): void {
    this.handlers = handlers;
  }

  connect(url = defaultWsUrl()): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}id=${encodeURIComponent(this.clientId)}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(full);
      this.ws = ws;
      ws.onopen = () => {
        this.handlers.onOpen?.();
        resolve();
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      ws.onclose = () => {
        this.handlers.onClose?.();
        this.ws = null;
      };
      ws.onmessage = (ev) => {
        let data: unknown;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        this.dispatch(data as ServerMsg);
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('NetworkClient is not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  createRoom(teamSize: number, fillBots = false, botDifficulty = 'normal'): void {
    this.send({ type: 'create_room', teamSize, fillBots, botDifficulty });
  }

  listRooms(): void {
    this.send({ type: 'list_rooms' });
  }

  joinRoom(roomId: string, name: string): void {
    this.send({ type: 'join_room', roomId, name });
  }

  selectTeam(team: number): void {
    this.send({ type: 'select_team', team });
  }

  selectElement(element: string): void {
    this.send({ type: 'select_element', element });
  }

  addBot(team: number, difficulty: string): void {
    this.send({ type: 'add_bot', team, difficulty });
  }

  removeBot(slotId: string): void {
    this.send({ type: 'remove_bot', slotId });
  }

  claimSlot(slotId: string): void {
    this.send({ type: 'claim_slot', slotId });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'set_ready', ready });
  }

  startMatch(): void {
    this.send({ type: 'start_match' });
  }

  /**
   * Spends mana to put a card down.
   *
   * @deprecated The server answers this with `idle_mode` since the idle pivot —
   * a seat is played by its owner's program, not by hand. It stays because
   * `MatchTransport` declares it and an override mode would want it back.
   */
  sendCast(cardId: string, position: { x: number; y: number }): void {
    this.send({ type: 'cast', cardId, position });
  }

  /** Enter matchmaking. Omit the deck to let the server use the default one. */
  joinQueue(name: string, deck?: string[], rating?: number): void {
    this.send({ type: 'join_queue', name, ...(deck ? { deck } : {}), ...(rating !== undefined ? { rating } : {}) });
  }

  /**
   * Registers the squad, deck and strategy program for this connection's next
   * match. Send it right after connecting: it applies to the queue and to a
   * room seat alike, whichever the player reaches for.
   *
   * The server re-validates all three; omitting the strategy leaves the seat
   * with `defaultStrategy(deck)` rather than with nothing, so an older client
   * still plays — just not the program its player wrote.
   */
  setLoadout(squad?: string[], stances?: Record<string, string>): void {
    this.send({
      type: 'set_loadout',
      ...(squad ? { squad } : {}),
      ...(stances ? { stances } : {}),
    });
  }

  leaveQueue(): void {
    this.send({ type: 'leave_queue' });
  }

  /** Quick-react from the hand — see src/app/emotes.ts. Broadcast-only, no ack. */
  sendEmote(emoteId: string): void {
    this.send({ type: 'send_emote', emoteId });
  }

  private dispatch(msg: ServerMsg): void {
    const typ = peekType(msg);
    switch (typ) {
      case 'room_state':
        this.handlers.onRoomState?.(msg as RoomStateMsg);
        break;
      case 'room_list':
        this.handlers.onRoomList?.(msg as RoomListMsg);
        break;
      case 'match_start':
        this.handlers.onMatchStart?.(msg as MatchStartMsg);
        break;
      case 'snapshot':
        this.handlers.onSnapshot?.(msg as SnapshotMsg);
        break;
      case 'round_end':
        this.handlers.onRoundEnd?.(msg as RoundEndMsg);
        break;
      case 'match_result':
        this.handlers.onMatchResult?.(msg as MatchResultMsg);
        break;
      case 'queue_status':
        this.handlers.onQueueStatus?.(msg as QueueStatusMsg);
        break;
      case 'match_found':
        this.handlers.onMatchFound?.(msg as MatchFoundMsg);
        break;
      case 'emote':
        this.handlers.onEmote?.(msg as EmoteMsg);
        break;
      case 'error':
        this.handlers.onError?.(msg as ErrorMsg);
        break;
      default:
        break;
    }
  }
}
