// Package ws provides the WebSocket transport layer for the Mage Craft
// server: upgrading HTTP connections, tracking connected clients and
// reading/writing frames on their behalf (see the project plan, §2/§4).
// It knows nothing about rooms, lobbies or the game simulation — it only
// moves raw bytes and reports client lifecycle events, so the room layer
// above it can decode/encode protocol messages and decide what to do.
package ws

import (
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

const sendBufferSize = 32

// MessageHandler is invoked once per inbound message from a client, on that
// client's own read-pump goroutine. Handlers should not block for long.
type MessageHandler func(clientID string, data []byte)

// DisconnectHandler is invoked once a client's connection has been fully
// torn down (either it disconnected, errored, or the server called
// Hub.Disconnect). It is not called when a connection is replaced by a new
// one registered under the same client ID.
type DisconnectHandler func(clientID string)

// Client is a single connected WebSocket peer, identified by an
// application-assigned ID (e.g. a player or session ID).
type Client struct {
	id   string
	conn *websocket.Conn

	mu     sync.Mutex
	send   chan []byte
	closed bool
}

// ID returns the application-assigned identifier this client was
// registered under.
func (c *Client) ID() string { return c.id }

// trySend enqueues data for delivery without blocking: if the client's
// outbound buffer is full or the client already closed, it drops the
// message and reports failure rather than stalling the caller (typically
// the simulation's broadcast hot path).
func (c *Client) trySend(data []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false
	}
	select {
	case c.send <- data:
		return true
	default:
		return false
	}
}

func (c *Client) close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	close(c.send)
	c.mu.Unlock()
	c.conn.Close()
}

// Hub tracks connected clients and dispatches inbound messages / lifecycle
// events to whatever owns it (typically internal/room).
type Hub struct {
	upgrader websocket.Upgrader

	mu           sync.RWMutex
	clients      map[string]*Client
	onMessage    MessageHandler
	onDisconnect DisconnectHandler
}

// NewHub creates a Hub. Either callback may be nil if the caller doesn't
// need it.
func NewHub(onMessage MessageHandler, onDisconnect DisconnectHandler) *Hub {
	return &Hub{
		clients:      make(map[string]*Client),
		onMessage:    onMessage,
		onDisconnect: onDisconnect,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			// Origin checking is left to the reverse proxy / a future auth
			// layer; the game protocol has no cookies/credentials to steal.
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Upgrade upgrades an HTTP request to a WebSocket connection and registers
// the resulting client under clientID, replacing (and closing) any previous
// connection registered under the same ID. It blocks, running the client's
// read pump, until the connection closes for any reason, so callers
// typically invoke it directly from an http.Handler goroutine.
func (h *Hub) Upgrade(w http.ResponseWriter, r *http.Request, clientID string) error {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}

	c := &Client{id: clientID, conn: conn, send: make(chan []byte, sendBufferSize)}

	if old := h.register(c); old != nil {
		old.close()
	}

	go h.writePump(c)
	h.readPump(c)

	c.close()
	h.unregister(c)
	return nil
}

func (h *Hub) register(c *Client) (old *Client) {
	h.mu.Lock()
	old = h.clients[c.id]
	h.clients[c.id] = c
	h.mu.Unlock()
	return old
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	replaced := h.clients[c.id] != c
	if !replaced {
		delete(h.clients, c.id)
	}
	h.mu.Unlock()

	if !replaced && h.onDisconnect != nil {
		h.onDisconnect(c.id)
	}
}

func (h *Hub) readPump(c *Client) {
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if h.onMessage != nil {
			h.onMessage(c.id, data)
		}
	}
}

func (h *Hub) writePump(c *Client) {
	for data := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
			return
		}
	}
}

// SendTo enqueues data for delivery to a single client. It returns false if
// the client isn't connected or its outbound buffer is full.
func (h *Hub) SendTo(clientID string, data []byte) bool {
	h.mu.RLock()
	c, ok := h.clients[clientID]
	h.mu.RUnlock()
	if !ok {
		return false
	}
	return c.trySend(data)
}

// Broadcast enqueues data for delivery to every client ID listed, skipping
// (without error) any that aren't currently connected.
func (h *Hub) Broadcast(clientIDs []string, data []byte) {
	for _, id := range clientIDs {
		h.SendTo(id, data)
	}
}

// Disconnect forcibly closes a client's connection, if any. This
// eventually triggers the registered DisconnectHandler, same as an
// unexpected client-side disconnect.
func (h *Hub) Disconnect(clientID string) {
	h.mu.RLock()
	c, ok := h.clients[clientID]
	h.mu.RUnlock()
	if !ok {
		return
	}
	c.close()
}

// Count returns the number of currently connected clients.
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
