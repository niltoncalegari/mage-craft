import { NetworkClient } from './NetworkClient';
import type {
  ErrorMsg,
  MatchStartMsg,
  RoomListMsg,
  RoomStateMsg,
  RoundEndMsg,
  SnapshotMsg,
} from './protocol';

export type LobbyBridgeHandlers = {
  onRoomState(msg: RoomStateMsg): void;
  onRoomList(msg: RoomListMsg): void;
  onMatchStart(msg: MatchStartMsg): void;
  onSnapshot(msg: SnapshotMsg): void;
  onRoundEnd(msg: RoundEndMsg): void;
  onError(msg: ErrorMsg): void;
  onClose(): void;
};

/**
 * Owns a single NetworkClient and keeps handlers pointed at the latest
 * React callbacks (via setHandlers).
 */
export class LobbyBridge {
  readonly net = new NetworkClient();
  private handlers: LobbyBridgeHandlers | null = null;

  setHandlers(handlers: LobbyBridgeHandlers): void {
    this.handlers = handlers;
    this.net.setHandlers({
      onRoomState: (m) => this.handlers?.onRoomState(m),
      onRoomList: (m) => this.handlers?.onRoomList(m),
      onMatchStart: (m) => this.handlers?.onMatchStart(m),
      onSnapshot: (m) => this.handlers?.onSnapshot(m),
      onRoundEnd: (m) => this.handlers?.onRoundEnd(m),
      onError: (m) => this.handlers?.onError(m),
      onClose: () => this.handlers?.onClose(),
    });
  }

  async connect(): Promise<void> {
    await this.net.connect();
  }

  disconnect(): void {
    this.net.disconnect();
  }

  get connected(): boolean {
    return this.net.connected;
  }

  get id(): string {
    return this.net.id;
  }

  /** Wait for the next room_state (optionally matching a predicate). */
  waitForRoomState(
    pred: (msg: RoomStateMsg) => boolean = () => true,
    timeoutMs = 5000,
  ): Promise<RoomStateMsg> {
    return new Promise((resolve, reject) => {
      const prev = this.handlers;
      if (!prev) {
        reject(new Error('LobbyBridge handlers not set'));
        return;
      }
      const timer = window.setTimeout(() => {
        this.setHandlers(prev);
        reject(new Error('Timed out waiting for room_state'));
      }, timeoutMs);
      this.setHandlers({
        ...prev,
        onRoomState: (msg) => {
          prev.onRoomState(msg);
          if (pred(msg)) {
            window.clearTimeout(timer);
            this.setHandlers(prev);
            resolve(msg);
          }
        },
        onError: (msg) => {
          prev.onError(msg);
          window.clearTimeout(timer);
          this.setHandlers(prev);
          reject(new Error(msg.message));
        },
      });
    });
  }
}
