/**
 * The Mage Craft authoritative game server: an HTTP server exposing a
 * WebSocket endpoint for the room/lobby + match protocol.
 *
 * Wires Hub (transport) to RoomManager + Session (lobby + simulation) via
 * App (wire messages). The simulation itself lives in `sim/`, shared verbatim
 * with the client.
 */

import { createServer } from 'node:http';
import process from 'node:process';
import { WebSocketServer } from 'ws';
import { App } from './App';
import { Hub } from './Hub';

const port = Number(process.env.PORT ?? 8080);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`mageserver: invalid PORT ${JSON.stringify(process.env.PORT)}`);
  process.exit(1);
}

// The handlers close over `app`, which is constructed just below — they can
// only fire once a client connects, which is long after both exist.
const hub = new Hub(
  (clientId, data) => app.handleMessage(clientId, data),
  (clientId) => {
    console.log(`mageserver: client ${clientId} disconnected`);
    app.handleDisconnect(clientId);
  },
);
const app = new App(hub);
// The bot fallback fires on elapsed wait time, so the sweep must run even when
// no message arrives.
app.startMatchmaking();

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/ws' });
let nextClientId = 0;

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const clientId = url.searchParams.get('id') || `anon-${++nextClientId}`;
  console.log(`mageserver: client ${clientId} connected`);
  hub.register(clientId, socket);
});

server.listen(port, () => {
  console.log(
    `mageserver: listening on :${port} (ws endpoint: /ws, health check: /healthz)`,
  );
});

function shutdown(signal: string): void {
  console.log(`mageserver: shutting down (${signal})`);
  app.dispose();
  wss.close();
  server.close(() => process.exit(0));
  // Don't wait forever on lingering keep-alive connections.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
