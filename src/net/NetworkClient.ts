import {
  peekType,
  type ClientMsg,
  type ErrorMsg,
  type MatchStartMsg,
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
  onError?(msg: ErrorMsg): void;
  onOpen?(): void;
  onClose?(): void;
};

function defaultWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:8080/ws`;
}

/**
 * Thin WebSocket client for the Go mageserver protocol.
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

  sendInput(input: {
    move: { x: number; y: number };
    aim: { x: number; y: number };
    charging: boolean;
    release: boolean;
  }): void {
    this.send({ type: 'input', ...input });
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
      case 'error':
        this.handlers.onError?.(msg as ErrorMsg);
        break;
      default:
        break;
    }
  }
}
