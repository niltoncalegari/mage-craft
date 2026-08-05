/**
 * The WebSocket transport layer: tracking connected clients and moving raw
 * bytes on their behalf.
 *
 * It knows nothing about rooms, lobbies or the simulation — it only reports
 * client lifecycle events, so App can decode protocol messages and decide what
 * to do.
 */

import type { WebSocket } from 'ws';

/** Beyond this many queued frames a client is considered too slow and is dropped. */
const SEND_BUFFER_LIMIT_BYTES = 1 << 20; // 1 MiB

export type MessageHandler = (clientId: string, data: string) => void;
export type DisconnectHandler = (clientId: string) => void;

interface Client {
  id: string;
  socket: WebSocket;
  closed: boolean;
}

export class Hub {
  private readonly clients = new Map<string, Client>();

  constructor(
    private readonly onMessage: MessageHandler,
    private readonly onDisconnect: DisconnectHandler,
  ) {}

  /**
   * Registers a freshly upgraded socket under `clientId`, replacing (and
   * closing) any previous connection registered under the same id.
   */
  register(clientId: string, socket: WebSocket): void {
    const previous = this.clients.get(clientId);
    if (previous) {
      // Detach first so closing the old socket doesn't fire onDisconnect and
      // tear down the room membership the new connection is about to reuse.
      previous.closed = true;
      this.clients.delete(clientId);
      previous.socket.terminate();
    }

    const client: Client = { id: clientId, socket, closed: false };
    this.clients.set(clientId, client);

    socket.on('message', (data) => {
      this.onMessage(clientId, data.toString());
    });

    const teardown = (): void => {
      if (client.closed) return;
      client.closed = true;
      // Only unregister if we're still the current connection for this id.
      if (this.clients.get(clientId) === client) {
        this.clients.delete(clientId);
        this.onDisconnect(clientId);
      }
    };

    socket.on('close', teardown);
    socket.on('error', teardown);
  }

  /**
   * Enqueues data for a single client without blocking. Returns false if the
   * client isn't connected or its outbound buffer has backed up — a stalled
   * peer must never stall the simulation's broadcast path.
   */
  sendTo(clientId: string, data: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.closed) return false;
    if (client.socket.readyState !== client.socket.OPEN) return false;
    if (client.socket.bufferedAmount > SEND_BUFFER_LIMIT_BYTES) return false;

    client.socket.send(data);
    return true;
  }

  /** Enqueues data for every listed client, skipping any that aren't connected. */
  broadcast(clientIds: Iterable<string>, data: string): void {
    for (const id of clientIds) this.sendTo(id, data);
  }

  /** Forcibly closes a client's connection, which triggers the disconnect handler. */
  disconnect(clientId: string): void {
    this.clients.get(clientId)?.socket.close();
  }

  get count(): number {
    return this.clients.size;
  }
}
