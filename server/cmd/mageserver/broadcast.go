package main

import (
	"encoding/json"
	"log"

	"mage-craft/server/internal/game"
	"mage-craft/server/internal/match"
	"mage-craft/server/internal/protocol"
)

// sendRoomState sends a room_state message to a single client (used right
// after create_room, before the creator has actually joined a slot).
func (a *App) sendRoomState(clientID, roomID string, sess *match.Session) {
	msg := buildRoomStateMsg(roomID, sess)
	msg.YouRole = sess.RoleOf(clientID)
	a.sendJSON(clientID, msg)
}

// broadcastRoomState sends the current room_state to every connected human
// in the room. Each recipient gets a personalized YouRole.
func (a *App) broadcastRoomState(roomID string, sess *match.Session) {
	base := buildRoomStateMsg(roomID, sess)
	for _, id := range sess.MemberIDs() {
		msg := base
		msg.YouRole = sess.RoleOf(id)
		a.sendJSON(id, msg)
	}
}

func buildRoomStateMsg(roomID string, sess *match.Session) protocol.RoomStateMsg {
	slots := sess.Slots()
	specs := sess.Spectators()
	out := protocol.RoomStateMsg{
		Type:       protocol.TypeRoomState,
		RoomID:     roomID,
		TeamSize:   sess.Room.TeamSize,
		State:      string(sess.State()),
		FillBots:   sess.Room.FillBots,
		Slots:      make([]protocol.PlayerSlotDTO, 0, len(slots)),
		Spectators: make([]protocol.SpectatorDTO, 0, len(specs)),
	}
	for _, s := range slots {
		out.Slots = append(out.Slots, protocol.PlayerSlotDTO{
			SlotID:               s.ID,
			Team:                 int(s.Team),
			PlayerID:             s.PlayerID,
			Name:                 s.Name,
			IsBot:                s.IsBot,
			Element:              string(s.Element),
			Ready:                s.Ready,
			PendingClaimPlayerID: s.PendingClaimPlayerID,
		})
	}
	for _, sp := range specs {
		out.Spectators = append(out.Spectators, protocol.SpectatorDTO{
			PlayerID:      sp.PlayerID,
			Name:          sp.Name,
			ClaimedSlotID: sp.ClaimedSlotID,
		})
	}
	return out
}

func (a *App) broadcastSnapshot(sess *match.Session, snap match.Snapshot) {
	out := protocol.SnapshotMsg{
		Type:        protocol.TypeSnapshot,
		Tick:        snap.Tick,
		Mages:       make([]protocol.MageSnapshotDTO, 0, len(snap.Mages)),
		Projectiles: make([]protocol.ProjectileSnapshotDTO, 0, len(snap.Projectiles)),
		Puddles:     make([]protocol.PuddleSnapshotDTO, 0, len(snap.Puddles)),
	}
	for _, m := range snap.Mages {
		out.Mages = append(out.Mages, protocol.MageSnapshotDTO{
			ID:       m.ID,
			Team:     m.Team,
			Position: toVec2DTO(m.Position),
			Facing:   toVec2DTO(m.Facing),
			Health:   m.Health,
			Lives:    m.Lives,
			Charging: m.Charging,
			Charge:   m.Charge,
			Element:  string(m.Element),
		})
	}
	for _, p := range snap.Projectiles {
		out.Projectiles = append(out.Projectiles, protocol.ProjectileSnapshotDTO{
			ID:       p.ID,
			Element:  string(p.Element),
			Position: toVec2DTO(p.Position),
			Velocity: toVec2DTO(p.Velocity),
		})
	}
	for _, pu := range snap.Puddles {
		out.Puddles = append(out.Puddles, protocol.PuddleSnapshotDTO{
			ID:        pu.ID,
			Position:  toVec2DTO(pu.Position),
			Radius:    pu.Radius,
			Remaining: pu.Remaining,
		})
	}
	a.broadcastToHumans(sess, out)
}

func (a *App) broadcastRoundEnd(sess *match.Session, winnerTeam int) {
	a.broadcastToHumans(sess, protocol.RoundEndMsg{Type: protocol.TypeRoundEnd, WinnerTeam: winnerTeam})
	// Rematch resets the room to lobby; push the new roster (claims applied).
	a.broadcastRoomState(sess.Room.ID, sess)
}

func toVec2DTO(v game.Vec2) protocol.Vec2DTO { return protocol.Vec2DTO{X: v.X, Y: v.Y} }

// broadcastToHumans sends msg to every connected human in the room.
func (a *App) broadcastToHumans(sess *match.Session, msg any) {
	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("mageserver: failed to encode broadcast payload: %v", err)
		return
	}

	seen := make(map[string]bool)
	ids := make([]string, 0)
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, id := range sess.MemberIDs() {
		add(id)
	}
	for _, s := range sess.Slots() {
		if !s.IsBot {
			add(s.PlayerID)
		}
	}
	a.hub.Broadcast(ids, payload)
}

func (a *App) sendJSON(clientID string, msg any) {
	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("mageserver: failed to encode payload for %s: %v", clientID, err)
		return
	}
	a.hub.SendTo(clientID, payload)
}
