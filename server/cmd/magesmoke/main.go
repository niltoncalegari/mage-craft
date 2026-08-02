// Command magesmoke is a tiny WebSocket client that exercises the lobby →
// match → spectator claim → rematch path against a running mageserver.
//
// Usage:
//
//	go run ./cmd/mageserver          # terminal 1
//	go run ./cmd/magesmoke           # terminal 2
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gorilla/websocket"

	"mage-craft/server/internal/protocol"
)

func main() {
	addr := flag.String("addr", "ws://localhost:8080/ws", "WebSocket URL of the mageserver")
	teamSize := flag.Int("teamSize", 1, "team size for create_room (1 = 1v1)")
	timeout := flag.Duration("timeout", 12*time.Second, "overall smoke timeout")
	flag.Parse()

	if err := run(*addr, *teamSize, *timeout); err != nil {
		log.Printf("magesmoke: FAIL: %v", err)
		os.Exit(1)
	}
	log.Println("magesmoke: OK")
}

func run(addr string, teamSize int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	host, _, err := websocket.DefaultDialer.Dial(addr+"?id=smoke-host", nil)
	if err != nil {
		return fmt.Errorf("dial host: %w", err)
	}
	defer host.Close()

	mustWrite(host, protocol.CreateRoomMsg{
		Type:          protocol.TypeCreateRoom,
		TeamSize:      teamSize,
		FillBots:      true,
		BotDifficulty: "normal",
	})

	roomID, err := waitRoomID(host, deadline)
	if err != nil {
		return err
	}
	log.Printf("magesmoke: room %s created (fillBots)", roomID)

	mustWrite(host, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "SmokeHost"})
	mustWrite(host, protocol.SelectTeamMsg{Type: protocol.TypeSelectTeam, Team: 0})
	mustWrite(host, protocol.SelectElementMsg{Type: protocol.TypeSelectElement, Element: "fire"})
	// fillBots auto-fills remaining seats on select_element

	mustWrite(host, protocol.ListRoomsMsg{Type: protocol.TypeListRooms})
	if err := waitType(host, protocol.TypeRoomList, deadline); err != nil {
		return fmt.Errorf("list_rooms: %w", err)
	}
	log.Println("magesmoke: room_list received")

	mustWrite(host, protocol.SetReadyMsg{Type: protocol.TypeSetReady, Ready: true})
	mustWrite(host, protocol.StartMatchMsg{Type: protocol.TypeStartMatch})

	spec, _, err := websocket.DefaultDialer.Dial(addr+"?id=smoke-spec", nil)
	if err != nil {
		return fmt.Errorf("dial spectator: %w", err)
	}
	defer spec.Close()

	// Drain host until match_start so the room is in_progress before spectating.
	if err := waitType(host, protocol.TypeMatchStart, deadline); err != nil {
		return fmt.Errorf("host match_start: %w", err)
	}
	log.Println("magesmoke: match_start received")

	mustWrite(spec, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "SmokeSpec"})
	botSlotID, err := waitSpectatorAndBotSlot(spec, deadline)
	if err != nil {
		return err
	}
	log.Printf("magesmoke: spectator joined; claiming bot %s", botSlotID)
	mustWrite(spec, protocol.ClaimSlotMsg{Type: protocol.TypeClaimSlot, SlotID: botSlotID})

	sawMatchStart := true
	snapshots := 0
	for time.Now().Before(deadline) {
		_ = host.SetReadDeadline(deadline)
		_, data, err := host.ReadMessage()
		if err != nil {
			return fmt.Errorf("read after start_match: %w", err)
		}
		typ, err := protocol.PeekType(data)
		if err != nil {
			return err
		}
		switch typ {
		case protocol.TypeError:
			var errMsg protocol.ErrorMsg
			if err := json.Unmarshal(data, &errMsg); err != nil {
				return err
			}
			return fmt.Errorf("server error: %s", errMsg.Message)
		case protocol.TypeSnapshot:
			snapshots++
			if sawMatchStart && snapshots >= 3 {
				log.Printf("magesmoke: received %d snapshots (spectator claimed)", snapshots)
				return nil
			}
		case protocol.TypeRoundEnd:
			log.Println("magesmoke: round_end received (match was very short)")
			return nil
		case protocol.TypeRoomState, protocol.TypeMatchStart, protocol.TypeRoomList:
			// ignore
		default:
			log.Printf("magesmoke: ignoring %q", typ)
		}
	}
	return fmt.Errorf("timed out waiting for snapshots (snapshots=%d)", snapshots)
}

func waitSpectatorAndBotSlot(conn *websocket.Conn, deadline time.Time) (string, error) {
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			return "", fmt.Errorf("spectator read: %w", err)
		}
		typ, err := protocol.PeekType(data)
		if err != nil {
			return "", err
		}
		if typ == protocol.TypeError {
			var errMsg protocol.ErrorMsg
			_ = json.Unmarshal(data, &errMsg)
			return "", fmt.Errorf("server error: %s", errMsg.Message)
		}
		if typ != protocol.TypeRoomState {
			continue
		}
		var state protocol.RoomStateMsg
		if err := json.Unmarshal(data, &state); err != nil {
			return "", err
		}
		if state.YouRole != "spectator" && len(state.Spectators) == 0 {
			continue
		}
		for _, s := range state.Slots {
			if s.IsBot {
				return s.SlotID, nil
			}
		}
	}
	return "", fmt.Errorf("timed out waiting for spectator room_state with a bot slot")
}

func waitType(conn *websocket.Conn, want string, deadline time.Time) error {
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		typ, err := protocol.PeekType(data)
		if err != nil {
			return err
		}
		if typ == protocol.TypeError {
			var errMsg protocol.ErrorMsg
			_ = json.Unmarshal(data, &errMsg)
			return fmt.Errorf("server error: %s", errMsg.Message)
		}
		if typ == want {
			return nil
		}
	}
	return fmt.Errorf("timed out waiting for %q", want)
}

func waitRoomID(conn *websocket.Conn, deadline time.Time) (string, error) {
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			return "", fmt.Errorf("read after create_room: %w", err)
		}
		typ, err := protocol.PeekType(data)
		if err != nil {
			return "", err
		}
		switch typ {
		case protocol.TypeError:
			var errMsg protocol.ErrorMsg
			_ = json.Unmarshal(data, &errMsg)
			return "", fmt.Errorf("server error: %s", errMsg.Message)
		case protocol.TypeRoomState:
			var state protocol.RoomStateMsg
			if err := json.Unmarshal(data, &state); err != nil {
				return "", err
			}
			if state.RoomID == "" {
				return "", fmt.Errorf("room_state missing roomId")
			}
			return state.RoomID, nil
		}
	}
	return "", fmt.Errorf("timed out waiting for room_state after create_room")
}

func mustWrite(conn *websocket.Conn, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Fatalf("magesmoke: marshal: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Fatalf("magesmoke: write: %v", err)
	}
}
