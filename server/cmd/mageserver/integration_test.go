package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"mage-craft/server/internal/protocol"
	"mage-craft/server/internal/ws"
)

// newTestServer wires the same HTTP+WebSocket composition as main(), so this
// smoke test exercises the real dispatch path end to end: ws.Hub ->
// App.HandleMessage -> room/match -> App broadcasts -> ws.Hub.
func newTestServer(t *testing.T) (wsURL string, close func()) {
	t.Helper()

	var hub *ws.Hub
	var app *App
	hub = ws.NewHub(
		func(clientID string, data []byte) { app.HandleMessage(clientID, data) },
		func(clientID string) { app.HandleDisconnect(clientID) },
	)
	app = NewApp(hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("id")
		_ = hub.Upgrade(w, r, clientID)
	})

	srv := httptest.NewServer(mux)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	return url, srv.Close
}

func dialTestClient(t *testing.T, wsURL, id string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL+"?id="+id, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", id, err)
	}
	return conn
}

func sendJSON(t *testing.T, conn *websocket.Conn, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// readUntilType reads messages off conn (ignoring ones that don't match)
// until it finds one whose "type" field equals wantType, or times out. This
// keeps the test robust to exactly how many intermediate room_state
// broadcasts a given action produces.
func readUntilType(t *testing.T, conn *websocket.Conn, wantType string, timeout time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			t.Fatalf("timed out waiting for a %q message", wantType)
		}
		conn.SetReadDeadline(time.Now().Add(remaining))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ReadMessage while waiting for %q: %v", wantType, err)
		}
		got, err := protocol.PeekType(data)
		if err != nil {
			t.Fatalf("PeekType: %v", err)
		}
		if got == wantType {
			return data
		}
	}
}

// TestEndToEnd_LobbyThroughRunningMatch drives two real WebSocket clients
// through the full protocol: create a room, join, pick teams and elements,
// start the match, send input, and observe at least one simulation
// snapshot — the smoke test called for by the project plan §5.
func TestEndToEnd_LobbyThroughRunningMatch(t *testing.T) {
	wsURL, closeServer := newTestServer(t)
	defer closeServer()

	alice := dialTestClient(t, wsURL, "alice")
	defer alice.Close()
	bob := dialTestClient(t, wsURL, "bob")
	defer bob.Close()

	sendJSON(t, alice, protocol.CreateRoomMsg{Type: protocol.TypeCreateRoom, TeamSize: 1})
	created := readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)

	var roomState protocol.RoomStateMsg
	if err := json.Unmarshal(created, &roomState); err != nil {
		t.Fatalf("unmarshal room_state: %v", err)
	}
	if roomState.RoomID == "" {
		t.Fatalf("expected create_room to return a non-empty room id, got %+v", roomState)
	}
	roomID := roomState.RoomID

	sendJSON(t, alice, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "Alice"})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, bob, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "Bob"})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)
	readUntilType(t, bob, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, alice, protocol.SelectTeamMsg{Type: protocol.TypeSelectTeam, Team: 0})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)
	readUntilType(t, bob, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, bob, protocol.SelectTeamMsg{Type: protocol.TypeSelectTeam, Team: 1})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)
	readUntilType(t, bob, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, alice, protocol.SelectElementMsg{Type: protocol.TypeSelectElement, Element: "fire"})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)
	readUntilType(t, bob, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, bob, protocol.SelectElementMsg{Type: protocol.TypeSelectElement, Element: "ice"})
	readUntilType(t, alice, protocol.TypeRoomState, 2*time.Second)
	readUntilType(t, bob, protocol.TypeRoomState, 2*time.Second)

	sendJSON(t, alice, protocol.StartMatchMsg{Type: protocol.TypeStartMatch})
	readUntilType(t, alice, protocol.TypeMatchStart, 2*time.Second)
	readUntilType(t, bob, protocol.TypeMatchStart, 2*time.Second)

	// Keep feeding input so the mages actually move/charge while we wait
	// for the authoritative 60Hz loop to broadcast a snapshot.
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				sendJSON(t, alice, protocol.InputMsg{Type: protocol.TypeInput, Move: protocol.Vec2DTO{X: 1}})
				sendJSON(t, bob, protocol.InputMsg{Type: protocol.TypeInput, Move: protocol.Vec2DTO{X: -1}})
			}
		}
	}()

	snap := readUntilType(t, alice, protocol.TypeSnapshot, 3*time.Second)

	var snapshot protocol.SnapshotMsg
	if err := json.Unmarshal(snap, &snapshot); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if len(snapshot.Mages) != 2 {
		t.Fatalf("expected a snapshot with both mages, got %+v", snapshot)
	}
}

func TestEndToEnd_FillBotsSpectatorClaim(t *testing.T) {
	wsURL, closeServer := newTestServer(t)
	defer closeServer()

	host := dialTestClient(t, wsURL, "host")
	defer host.Close()
	spec := dialTestClient(t, wsURL, "spec")
	defer spec.Close()

	sendJSON(t, host, protocol.CreateRoomMsg{
		Type: protocol.TypeCreateRoom, TeamSize: 1, FillBots: true, BotDifficulty: "easy",
	})
	created := readUntilType(t, host, protocol.TypeRoomState, 2*time.Second)
	var roomState protocol.RoomStateMsg
	if err := json.Unmarshal(created, &roomState); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	roomID := roomState.RoomID

	sendJSON(t, host, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "Host"})
	readUntilType(t, host, protocol.TypeRoomState, 2*time.Second)
	sendJSON(t, host, protocol.SelectTeamMsg{Type: protocol.TypeSelectTeam, Team: 0})
	readUntilType(t, host, protocol.TypeRoomState, 2*time.Second)
	sendJSON(t, host, protocol.SelectElementMsg{Type: protocol.TypeSelectElement, Element: "fire"})
	filled := readUntilType(t, host, protocol.TypeRoomState, 2*time.Second)
	if err := json.Unmarshal(filled, &roomState); err != nil {
		t.Fatalf("unmarshal filled: %v", err)
	}
	if len(roomState.Slots) != 2 {
		t.Fatalf("expected fillBots to seat host+bot, got %d slots", len(roomState.Slots))
	}

	sendJSON(t, host, protocol.ListRoomsMsg{Type: protocol.TypeListRooms})
	listData := readUntilType(t, host, protocol.TypeRoomList, 2*time.Second)
	var list protocol.RoomListMsg
	if err := json.Unmarshal(listData, &list); err != nil {
		t.Fatalf("unmarshal room_list: %v", err)
	}
	if len(list.Rooms) == 0 {
		t.Fatalf("expected at least one room in list")
	}

	sendJSON(t, host, protocol.StartMatchMsg{Type: protocol.TypeStartMatch})
	readUntilType(t, host, protocol.TypeMatchStart, 2*time.Second)

	sendJSON(t, spec, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "Spec"})
	specStateData := readUntilType(t, spec, protocol.TypeRoomState, 2*time.Second)
	var specState protocol.RoomStateMsg
	if err := json.Unmarshal(specStateData, &specState); err != nil {
		t.Fatalf("unmarshal spec state: %v", err)
	}
	if specState.YouRole != "spectator" {
		t.Fatalf("expected youRole=spectator, got %q", specState.YouRole)
	}
	var botSlot string
	for _, s := range specState.Slots {
		if s.IsBot {
			botSlot = s.SlotID
			break
		}
	}
	if botSlot == "" {
		t.Fatalf("expected a bot slot to claim")
	}
	sendJSON(t, spec, protocol.ClaimSlotMsg{Type: protocol.TypeClaimSlot, SlotID: botSlot})
	claimed := readUntilType(t, spec, protocol.TypeRoomState, 2*time.Second)
	if err := json.Unmarshal(claimed, &specState); err != nil {
		t.Fatalf("unmarshal claim: %v", err)
	}
	foundClaim := false
	for _, s := range specState.Slots {
		if s.SlotID == botSlot && s.PendingClaimPlayerID == "spec" {
			foundClaim = true
		}
	}
	if !foundClaim {
		t.Fatalf("expected pending claim on bot slot, got %+v", specState.Slots)
	}

	readUntilType(t, spec, protocol.TypeSnapshot, 3*time.Second)
}
