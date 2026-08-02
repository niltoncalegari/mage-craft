package ws

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newTestServer(t *testing.T, hub *Hub) (*httptest.Server, string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("id")
		if err := hub.Upgrade(w, r, clientID); err != nil {
			t.Logf("upgrade error: %v", err)
		}
	})
	srv := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	return srv, wsURL
}

func dial(t *testing.T, wsURL, id string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL+"?id="+id, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func waitForCount(t *testing.T, hub *Hub, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hub.Count() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("hub.Count() never reached %d (got %d)", want, hub.Count())
}

func TestHub_OnMessage_ReceivesClientData(t *testing.T) {
	var mu sync.Mutex
	var gotID string
	var gotData []byte
	received := make(chan struct{})

	hub := NewHub(func(clientID string, data []byte) {
		mu.Lock()
		gotID = clientID
		gotData = append([]byte(nil), data...)
		mu.Unlock()
		close(received)
	}, nil)

	srv, wsURL := newTestServer(t, hub)
	defer srv.Close()

	conn := dial(t, wsURL, "client-1")
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatalf("WriteMessage: %v", err)
	}

	select {
	case <-received:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for onMessage callback")
	}

	mu.Lock()
	defer mu.Unlock()
	if gotID != "client-1" {
		t.Errorf("got clientID %q, want %q", gotID, "client-1")
	}
	if string(gotData) != `{"type":"ping"}` {
		t.Errorf("got data %q", gotData)
	}
}

func TestHub_SendTo_DeliversToClient(t *testing.T) {
	hub := NewHub(nil, nil)
	srv, wsURL := newTestServer(t, hub)
	defer srv.Close()

	conn := dial(t, wsURL, "client-1")
	defer conn.Close()

	waitForCount(t, hub, 1)

	if !hub.SendTo("client-1", []byte("hello")) {
		t.Fatal("SendTo returned false for a connected client")
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("got %q, want %q", data, "hello")
	}
}

func TestHub_SendTo_UnknownClientReturnsFalse(t *testing.T) {
	hub := NewHub(nil, nil)
	if hub.SendTo("ghost", []byte("x")) {
		t.Error("expected SendTo to return false for an unknown client")
	}
}

func TestHub_Broadcast_DeliversToAllListedClients(t *testing.T) {
	hub := NewHub(nil, nil)
	srv, wsURL := newTestServer(t, hub)
	defer srv.Close()

	connA := dial(t, wsURL, "a")
	defer connA.Close()
	connB := dial(t, wsURL, "b")
	defer connB.Close()

	waitForCount(t, hub, 2)

	hub.Broadcast([]string{"a", "b"}, []byte("go"))

	for _, conn := range []*websocket.Conn{connA, connB} {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ReadMessage: %v", err)
		}
		if string(data) != "go" {
			t.Errorf("got %q, want %q", data, "go")
		}
	}
}

func TestHub_Disconnect_TriggersOnDisconnectAndClosesConn(t *testing.T) {
	disconnected := make(chan string, 1)
	hub := NewHub(nil, func(clientID string) {
		disconnected <- clientID
	})

	srv, wsURL := newTestServer(t, hub)
	defer srv.Close()

	conn := dial(t, wsURL, "client-1")
	defer conn.Close()

	waitForCount(t, hub, 1)

	hub.Disconnect("client-1")

	select {
	case id := <-disconnected:
		if id != "client-1" {
			t.Errorf("got %q, want %q", id, "client-1")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for onDisconnect callback")
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Error("expected a read error after server-initiated disconnect")
	}

	waitForCount(t, hub, 0)
}

func TestHub_Register_ReplacingConnectionDisconnectsOnlyOnce(t *testing.T) {
	var disconnectCount int
	var mu sync.Mutex
	hub := NewHub(nil, func(clientID string) {
		mu.Lock()
		disconnectCount++
		mu.Unlock()
	})

	srv, wsURL := newTestServer(t, hub)
	defer srv.Close()

	connA := dial(t, wsURL, "dup")
	defer connA.Close()
	waitForCount(t, hub, 1)

	connB := dial(t, wsURL, "dup")
	defer connB.Close()
	waitForCount(t, hub, 1)

	connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := connA.ReadMessage(); err == nil {
		t.Error("expected the replaced connection to be closed")
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if disconnectCount != 0 {
		t.Errorf("onDisconnect should not fire when a connection is replaced, got %d calls", disconnectCount)
	}
}
