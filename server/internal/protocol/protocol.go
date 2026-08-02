// Package protocol defines the JSON message contracts exchanged between
// clients and the Mage Craft authoritative server over WebSocket (see the
// project plan, §4). Every message is a flat JSON object carrying its own
// "type" discriminator, so a caller can inspect the type with PeekType
// before decoding into the matching Go struct.
package protocol

import (
	"encoding/json"
	"fmt"
)

// Client -> server message types.
const (
	TypeCreateRoom    = "create_room"
	TypeJoinRoom      = "join_room"
	TypeListRooms     = "list_rooms"
	TypeSelectTeam    = "select_team"
	TypeSelectElement = "select_element"
	TypeAddBot        = "add_bot"
	TypeRemoveBot     = "remove_bot"
	TypeClaimSlot     = "claim_slot"
	TypeSetReady      = "set_ready"
	TypeStartMatch    = "start_match"
	TypeInput         = "input"
)

// Server -> client message types.
const (
	TypeRoomState  = "room_state"
	TypeRoomList   = "room_list"
	TypeMatchStart = "match_start"
	TypeSnapshot   = "snapshot"
	TypeRoundEnd   = "round_end"
	TypeError      = "error"
)

// Vec2DTO is the wire representation of a 2D vector (position, direction or
// velocity). It intentionally avoids depending on the game package's own
// vector type so protocol stays decoupled from the simulation internals.
type Vec2DTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// typeEnvelope is used only to peek at the "type" discriminator of an
// otherwise-unknown incoming message.
type typeEnvelope struct {
	Type string `json:"type"`
}

// PeekType reports the "type" field of a raw client/server message without
// decoding the rest of it, so the caller can dispatch to the right concrete
// struct. It returns an error if data isn't valid JSON or has no (or an
// empty) "type" field.
func PeekType(data []byte) (string, error) {
	var env typeEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		return "", fmt.Errorf("protocol: invalid message: %w", err)
	}
	if env.Type == "" {
		return "", fmt.Errorf("protocol: message is missing a \"type\" field")
	}
	return env.Type, nil
}

// --- Client -> server messages ---

// CreateRoomMsg requests a new room with the given team size (1-6, i.e. up
// to 6x6, see GDD §7). When FillBots is true the server will fill remaining
// seats with bots after humans take their slots (typically via FillEmptyWithBots).
type CreateRoomMsg struct {
	Type          string `json:"type"`
	TeamSize      int    `json:"teamSize"`
	FillBots      bool   `json:"fillBots,omitempty"`
	BotDifficulty string `json:"botDifficulty,omitempty"` // easy|normal|hard; default normal
}

// JoinRoomMsg requests joining an existing room by its short room code.
// In lobby the player joins as a seat candidate; during in_progress they
// join as a spectator until rematch.
type JoinRoomMsg struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

// ListRoomsMsg asks the server for the current public room catalog.
type ListRoomsMsg struct {
	Type string `json:"type"`
}

// SelectTeamMsg picks team 0 or 1 within the current room.
type SelectTeamMsg struct {
	Type string `json:"type"`
	Team int    `json:"team"`
}

// SelectElementMsg picks one of the 7 catalog elements (GDD §8.1) for the
// sender's mage. The server rejects it if another mage on the same team
// already has that element (GDD §7 uniqueness rule).
type SelectElementMsg struct {
	Type    string `json:"type"`
	Element string `json:"element"`
}

// AddBotMsg asks the host to fill an empty slot on a team with a bot of the
// given difficulty ("easy" | "normal" | "hard"). The bot auto-picks a free
// element on that team.
type AddBotMsg struct {
	Type       string `json:"type"`
	Team       int    `json:"team"`
	Difficulty string `json:"difficulty"`
}

// RemoveBotMsg removes a previously added bot, freeing its slot and element.
type RemoveBotMsg struct {
	Type   string `json:"type"`
	SlotID string `json:"slotId"`
}

// ClaimSlotMsg lets a spectator reserve a bot (or empty) slot for the next
// rematch round. The bot keeps playing until round_end.
type ClaimSlotMsg struct {
	Type   string `json:"type"`
	SlotID string `json:"slotId"`
}

// SetReadyMsg toggles the sender's ready state in the lobby.
type SetReadyMsg struct {
	Type  string `json:"type"`
	Ready bool   `json:"ready"`
}

// StartMatchMsg asks the room to start the match. The server validates that
// every slot is filled and every mage has a valid element before accepting.
type StartMatchMsg struct {
	Type string `json:"type"`
}

// InputMsg carries one input sample for the sender's mage during a match.
type InputMsg struct {
	Type     string  `json:"type"`
	Move     Vec2DTO `json:"move"`
	Aim      Vec2DTO `json:"aim"`
	Charging bool    `json:"charging"`
	Release  bool    `json:"release"`
}

// --- Server -> client messages ---

// PlayerSlotDTO describes one slot (human or bot) inside a room, as shown to
// clients in RoomStateMsg.
type PlayerSlotDTO struct {
	SlotID               string `json:"slotId"`
	Team                 int    `json:"team"`
	PlayerID             string `json:"playerId,omitempty"`
	Name                 string `json:"name,omitempty"`
	IsBot                bool   `json:"isBot"`
	Element              string `json:"element,omitempty"`
	Ready                bool   `json:"ready"`
	PendingClaimPlayerID string `json:"pendingClaimPlayerId,omitempty"`
}

// SpectatorDTO is a human watching an in-progress match (or waiting in
// rematch lobby after claiming a slot that has not yet been applied).
type SpectatorDTO struct {
	PlayerID      string `json:"playerId"`
	Name          string `json:"name"`
	ClaimedSlotID string `json:"claimedSlotId,omitempty"`
}

// RoomStateMsg is broadcast to everyone in a room whenever the lobby state
// changes (join/leave/select_team/select_element/add_bot/remove_bot/ready/claim).
type RoomStateMsg struct {
	Type       string          `json:"type"`
	RoomID     string          `json:"roomId"`
	TeamSize   int             `json:"teamSize"`
	State      string          `json:"state"` // lobby | in_progress | ended
	FillBots   bool            `json:"fillBots,omitempty"`
	Slots      []PlayerSlotDTO `json:"slots"`
	Spectators []SpectatorDTO  `json:"spectators,omitempty"`
	YouRole    string          `json:"youRole,omitempty"` // player | spectator (per-recipient)
}

// RoomSummaryDTO is one entry in a room_list response.
type RoomSummaryDTO struct {
	RoomID            string `json:"roomId"`
	TeamSize          int    `json:"teamSize"`
	State             string `json:"state"`
	Filled            int    `json:"filled"`
	Capacity          int    `json:"capacity"`
	OpenBotSlots      int    `json:"openBotSlots"`
	AcceptsSpectators bool   `json:"acceptsSpectators"`
}

// RoomListMsg is the catalog of joinable rooms (lobby + in_progress).
type RoomListMsg struct {
	Type  string           `json:"type"`
	Rooms []RoomSummaryDTO `json:"rooms"`
}

// MatchStartMsg tells clients the match's 60Hz simulation loop has started.
type MatchStartMsg struct {
	Type string `json:"type"`
}

// MageSnapshotDTO is one mage's state in a simulation snapshot.
type MageSnapshotDTO struct {
	ID       string  `json:"id"`
	Team     int     `json:"team"`
	Position Vec2DTO `json:"position"`
	Facing   Vec2DTO `json:"facing"`
	Health   float64 `json:"health"`
	Lives    int     `json:"lives"`
	Charging bool    `json:"charging"`
	Charge   float64 `json:"charge"`
	Element  string  `json:"element"`
}

// ProjectileSnapshotDTO is one in-flight projectile's state in a snapshot.
type ProjectileSnapshotDTO struct {
	ID       string  `json:"id"`
	Element  string  `json:"element"`
	Position Vec2DTO `json:"position"`
	Velocity Vec2DTO `json:"velocity"`
}

// PuddleSnapshotDTO is one active ground puddle's state in a snapshot
// (GDD §8.5).
type PuddleSnapshotDTO struct {
	ID        string  `json:"id"`
	Position  Vec2DTO `json:"position"`
	Radius    float64 `json:"radius"`
	Remaining float64 `json:"remaining"`
}

// SnapshotMsg is broadcast at the server's snapshot rate (~20-30Hz) while a
// match is in progress.
type SnapshotMsg struct {
	Type        string                  `json:"type"`
	Tick        uint64                  `json:"tick"`
	Mages       []MageSnapshotDTO       `json:"mages"`
	Projectiles []ProjectileSnapshotDTO `json:"projectiles"`
	Puddles     []PuddleSnapshotDTO     `json:"puddles"`
}

// RoundEndMsg announces the winning team once a round ends (opposing team
// reaches zero lives). After this the server resets the room to lobby for rematch.
type RoundEndMsg struct {
	Type       string `json:"type"`
	WinnerTeam int    `json:"winnerTeam"`
}

// ErrorMsg reports a rejected action (e.g. invalid element, room full) back
// to the client that caused it.
type ErrorMsg struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}
