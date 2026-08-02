// Command magesmoke is a tiny WebSocket client that exercises the lobby →
// match path against a running mageserver. It lives outside cmd/mageserver
// on purpose so it can be developed on a parallel branch without touching
// the composition root (see AGENTS.md).
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
	timeout := flag.Duration("timeout", 8*time.Second, "overall smoke timeout")
	flag.Parse()

	if err := run(*addr, *teamSize, *timeout); err != nil {
		log.Printf("magesmoke: FAIL: %v", err)
		os.Exit(1)
	}
	log.Println("magesmoke: OK")
}

func run(addr string, teamSize int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	conn, _, err := websocket.DefaultDialer.Dial(addr+"?id=smoke-host", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	mustWrite(conn, protocol.CreateRoomMsg{Type: protocol.TypeCreateRoom, TeamSize: teamSize})

	roomID, err := waitRoomID(conn, deadline)
	if err != nil {
		return err
	}
	log.Printf("magesmoke: room %s created", roomID)

	mustWrite(conn, protocol.JoinRoomMsg{Type: protocol.TypeJoinRoom, RoomID: roomID, Name: "SmokeHost"})
	mustWrite(conn, protocol.SelectTeamMsg{Type: protocol.TypeSelectTeam, Team: 0})
	mustWrite(conn, protocol.SelectElementMsg{Type: protocol.TypeSelectElement, Element: "fire"})
	mustWrite(conn, protocol.AddBotMsg{Type: protocol.TypeAddBot, Team: 1, Difficulty: "normal"})
	mustWrite(conn, protocol.SetReadyMsg{Type: protocol.TypeSetReady, Ready: true})
	mustWrite(conn, protocol.StartMatchMsg{Type: protocol.TypeStartMatch})

	sawMatchStart := false
	snapshots := 0
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
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
		case protocol.TypeMatchStart:
			sawMatchStart = true
			log.Println("magesmoke: match_start received")
		case protocol.TypeSnapshot:
			snapshots++
			if sawMatchStart && snapshots >= 3 {
				log.Printf("magesmoke: received %d snapshots", snapshots)
				return nil
			}
		case protocol.TypeRoundEnd:
			log.Println("magesmoke: round_end received (match was very short)")
			return nil
		case protocol.TypeRoomState:
			// lobby updates after add_bot / ready — ignore
		default:
			log.Printf("magesmoke: ignoring %q", typ)
		}
	}
	return fmt.Errorf("timed out waiting for match_start + snapshots (matchStart=%v snapshots=%d)", sawMatchStart, snapshots)
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
