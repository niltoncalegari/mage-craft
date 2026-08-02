package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"mage-craft/server/internal/game"
	"mage-craft/server/internal/match"
	"mage-craft/server/internal/protocol"
	"mage-craft/server/internal/room"
	"mage-craft/server/internal/ws"
)

// App is the composition root's message dispatcher: it decodes protocol
// messages, drives room.Manager + match.Session, and broadcasts results
// back out through the ws.Hub. It is the only piece of the server that
// knows about all four internal packages (game, match, protocol, ws), by
// design (see the project plan §2 dependency diagram).
type App struct {
	hub   *ws.Hub
	rooms *room.Manager

	mu         sync.Mutex
	sessions   map[string]*match.Session // roomID -> session
	clientRoom map[string]string         // clientID -> roomID
}

func NewApp(hub *ws.Hub) *App {
	return &App{
		hub:        hub,
		rooms:      room.NewManager(),
		sessions:   make(map[string]*match.Session),
		clientRoom: make(map[string]string),
	}
}

// HandleMessage is the ws.Hub MessageHandler: it runs on the sending
// client's own read-pump goroutine.
func (a *App) HandleMessage(clientID string, data []byte) {
	msgType, err := protocol.PeekType(data)
	if err != nil {
		a.sendError(clientID, "malformed message: "+err.Error())
		return
	}

	switch msgType {
	case protocol.TypeCreateRoom:
		a.handleCreateRoom(clientID, data)
	case protocol.TypeJoinRoom:
		a.handleJoinRoom(clientID, data)
	case protocol.TypeSelectTeam:
		a.handleSelectTeam(clientID, data)
	case protocol.TypeSelectElement:
		a.handleSelectElement(clientID, data)
	case protocol.TypeAddBot:
		a.handleAddBot(clientID, data)
	case protocol.TypeRemoveBot:
		a.handleRemoveBot(clientID, data)
	case protocol.TypeSetReady:
		a.handleSetReady(clientID, data)
	case protocol.TypeStartMatch:
		a.handleStartMatch(clientID)
	case protocol.TypeInput:
		a.handleInput(clientID, data)
	default:
		a.sendError(clientID, fmt.Sprintf("unknown message type %q", msgType))
	}
}

// HandleDisconnect is the ws.Hub DisconnectHandler.
func (a *App) HandleDisconnect(clientID string) {
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)

	a.mu.Lock()
	delete(a.clientRoom, clientID)
	a.mu.Unlock()

	if !ok {
		return
	}
	// Leave is a no-op error (not a bug) once the match has started — the
	// room only allows leaving during the lobby (GDD §7). Mid-match
	// disconnects currently just freeze that mage's input; a bot-takeover
	// or forfeit rule is left as a follow-up (see server/README.md).
	if err := sess.Leave(clientID); err == nil {
		a.broadcastRoomState(roomID, sess)
	}
}

func (a *App) handleCreateRoom(clientID string, data []byte) {
	var msg protocol.CreateRoomMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid create_room payload")
		return
	}

	r, err := a.rooms.CreateRoom(msg.TeamSize)
	if err != nil {
		a.sendError(clientID, err.Error())
		return
	}

	roomID := r.ID
	var sess *match.Session
	sess = match.New(r, match.Callbacks{
		OnSnapshot: func(snap match.Snapshot) { a.broadcastSnapshot(sess, snap) },
		OnRoundEnd: func(winner int) { a.broadcastRoundEnd(sess, winner) },
	})

	a.mu.Lock()
	a.sessions[roomID] = sess
	a.mu.Unlock()

	// The creator hasn't joined yet (create_room carries no player name);
	// they still get to see the fresh, empty room so the client can show
	// the room code and immediately follow up with join_room.
	a.sendRoomState(clientID, roomID, sess)
}

func (a *App) handleJoinRoom(clientID string, data []byte) {
	var msg protocol.JoinRoomMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid join_room payload")
		return
	}

	sess, ok := a.sessionFor(msg.RoomID)
	if !ok {
		a.sendError(clientID, fmt.Sprintf("room %q not found", msg.RoomID))
		return
	}
	if err := sess.Join(clientID, msg.Name); err != nil {
		a.sendError(clientID, err.Error())
		return
	}

	a.mu.Lock()
	a.clientRoom[clientID] = msg.RoomID
	a.mu.Unlock()

	a.broadcastRoomState(msg.RoomID, sess)
}

func (a *App) handleSelectTeam(clientID string, data []byte) {
	var msg protocol.SelectTeamMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid select_team payload")
		return
	}
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if err := sess.SelectTeam(clientID, game.Team(msg.Team)); err != nil {
		a.sendError(clientID, err.Error())
		return
	}
	a.broadcastRoomState(roomID, sess)
}

func (a *App) handleSelectElement(clientID string, data []byte) {
	var msg protocol.SelectElementMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid select_element payload")
		return
	}
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if err := sess.SelectElement(clientID, game.ElementID(msg.Element)); err != nil {
		a.sendError(clientID, err.Error())
		return
	}
	a.broadcastRoomState(roomID, sess)
}

func (a *App) handleAddBot(clientID string, data []byte) {
	var msg protocol.AddBotMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid add_bot payload")
		return
	}
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if _, err := sess.AddBot(game.Team(msg.Team), msg.Difficulty); err != nil {
		a.sendError(clientID, err.Error())
		return
	}
	a.broadcastRoomState(roomID, sess)
}

func (a *App) handleRemoveBot(clientID string, data []byte) {
	var msg protocol.RemoveBotMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid remove_bot payload")
		return
	}
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if err := sess.RemoveBot(msg.SlotID); err != nil {
		a.sendError(clientID, err.Error())
		return
	}
	a.broadcastRoomState(roomID, sess)
}

func (a *App) handleSetReady(clientID string, data []byte) {
	var msg protocol.SetReadyMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		a.sendError(clientID, "invalid set_ready payload")
		return
	}
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if err := sess.SetReady(clientID, msg.Ready); err != nil {
		a.sendError(clientID, err.Error())
		return
	}
	a.broadcastRoomState(roomID, sess)
}

func (a *App) handleStartMatch(clientID string) {
	sess, roomID, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		a.sendError(clientID, "you have not joined a room")
		return
	}
	if err := sess.StartMatch(); err != nil {
		a.sendError(clientID, err.Error())
		return
	}

	a.broadcastRoomState(roomID, sess)
	a.broadcastToHumans(sess, protocol.MatchStartMsg{Type: protocol.TypeMatchStart})

	// One goroutine per in-progress room, ticking at the fixed 60Hz rate
	// (GDD §14) until game.World reports a winner.
	go sess.RunLoop(nil)
}

func (a *App) handleInput(clientID string, data []byte) {
	var msg protocol.InputMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		// Input arrives every tick from every client; a single malformed
		// frame isn't worth an error round-trip, just drop it.
		return
	}
	sess, _, ok := a.sessionAndRoomForClient(clientID)
	if !ok {
		return
	}
	_ = sess.SubmitInput(clientID, game.MageInput{
		Move:     game.Vec2{X: msg.Move.X, Y: msg.Move.Y},
		Aim:      game.Vec2{X: msg.Aim.X, Y: msg.Aim.Y},
		Charging: msg.Charging,
		Release:  msg.Release,
	})
}

func (a *App) sessionFor(roomID string) (*match.Session, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[roomID]
	return s, ok
}

func (a *App) sessionAndRoomForClient(clientID string) (*match.Session, string, bool) {
	a.mu.Lock()
	roomID, ok := a.clientRoom[clientID]
	var sess *match.Session
	if ok {
		sess = a.sessions[roomID]
	}
	a.mu.Unlock()

	if !ok || sess == nil {
		return nil, "", false
	}
	return sess, roomID, true
}

func (a *App) sendError(clientID, message string) {
	payload, err := json.Marshal(protocol.ErrorMsg{Type: protocol.TypeError, Message: message})
	if err != nil {
		log.Printf("mageserver: failed to encode error message: %v", err)
		return
	}
	a.hub.SendTo(clientID, payload)
}
