// Package room implements the pre-game lobby and its state machine (GDD §7,
// project plan §3): joining, team/element selection, bots filling empty
// slots, and the transition into an authoritative game.World once a match
// starts.
//
// The package depends only on internal/game (to build the World at match
// start); it intentionally has no dependency on internal/bot or
// internal/ws, so bot AI and transport can be developed independently and
// wired together later at the composition root (cmd/mageserver).
package room

import (
	"fmt"

	"mage-craft/server/internal/game"
)

// State is the room's lifecycle stage.
type State string

const (
	StateLobby      State = "lobby"
	StateInProgress State = "in_progress"
	StateEnded      State = "ended"
)

const (
	minTeamSize = 1
	maxTeamSize = 6
)

// Slot is one seat on a team: either empty, held by a connected human
// player, or filled by a bot.
type Slot struct {
	ID   string
	Team game.Team

	PlayerID string // "" if this is a bot slot
	Name     string

	IsBot      bool
	Difficulty string // only meaningful when IsBot

	Element game.ElementID // "" until chosen
	Ready   bool
}

type member struct {
	name string
	team *game.Team // nil until SelectTeam
}

// Room holds one match's lobby state and, once started, its live world.
type Room struct {
	ID       string
	TeamSize int

	state State

	members map[string]*member // playerID -> lobby membership, before/while assigning a team
	slots   map[game.Team][]*Slot
	nextSeq int

	world *game.World
}

// NewRoom creates a room with team size between 1 and 6 (capacity =
// 2*teamSize, GDD §7).
func NewRoom(id string, teamSize int) (*Room, error) {
	if teamSize < minTeamSize || teamSize > maxTeamSize {
		return nil, fmt.Errorf("room: teamSize must be between %d and %d, got %d", minTeamSize, maxTeamSize, teamSize)
	}
	return &Room{
		ID:       id,
		TeamSize: teamSize,
		state:    StateLobby,
		members:  make(map[string]*member),
		slots: map[game.Team][]*Slot{
			game.TeamA: {},
			game.TeamB: {},
		},
	}, nil
}

// State reports the room's current lifecycle stage.
func (r *Room) State() State { return r.state }

// Join registers a connected player in the room's lobby without a team yet
// (the client is expected to follow up with SelectTeam).
func (r *Room) Join(playerID, name string) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot join, room is %s", r.state)
	}
	if _, exists := r.members[playerID]; exists {
		return fmt.Errorf("room: player %q already joined", playerID)
	}
	if r.occupiedCount() >= r.capacity() {
		return fmt.Errorf("room: room is full")
	}
	r.members[playerID] = &member{name: name}
	return nil
}

// Leave removes a player from the room, freeing their slot (and element, if
// any) for others.
func (r *Room) Leave(playerID string) error {
	mem, ok := r.members[playerID]
	if !ok {
		return fmt.Errorf("room: player %q is not in this room", playerID)
	}
	if mem.team != nil {
		r.removeSlotFor(*mem.team, playerID)
	}
	delete(r.members, playerID)
	return nil
}

// SelectTeam assigns (or re-assigns) a player to team 0 or 1, allocating
// them a slot. It fails if that team's slots are already full.
func (r *Room) SelectTeam(playerID string, team game.Team) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot select team, room is %s", r.state)
	}
	mem, ok := r.members[playerID]
	if !ok {
		return fmt.Errorf("room: player %q has not joined this room", playerID)
	}
	if mem.team != nil && *mem.team == team {
		return nil
	}
	if r.humanBotCountForTeam(team) >= r.TeamSize {
		return fmt.Errorf("room: team %d is full", team)
	}

	if mem.team != nil {
		r.removeSlotFor(*mem.team, playerID)
	}

	r.nextSeq++
	slot := &Slot{
		ID:       fmt.Sprintf("%s-slot-%d", r.ID, r.nextSeq),
		Team:     team,
		PlayerID: playerID,
		Name:     mem.name,
	}
	r.slots[team] = append(r.slots[team], slot)
	mem.team = &team
	return nil
}

// CanSelectElement reports whether element is still free on the given team
// (GDD §7 uniqueness rule: no two mages on the same team share an element).
func (r *Room) CanSelectElement(team game.Team, element game.ElementID) bool {
	for _, s := range r.slots[team] {
		if s.Element == element {
			return false
		}
	}
	return true
}

// SelectElement sets the caller's element, validating that it exists in the
// catalog and is still free on their team.
func (r *Room) SelectElement(playerID string, element game.ElementID) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot select element, room is %s", r.state)
	}
	mem, ok := r.members[playerID]
	if !ok {
		return fmt.Errorf("room: player %q has not joined this room", playerID)
	}
	if mem.team == nil {
		return fmt.Errorf("room: player %q must select a team before an element", playerID)
	}
	if _, ok := game.ElementDefFor(element); !ok {
		return fmt.Errorf("room: unknown element %q", element)
	}
	if !r.CanSelectElement(*mem.team, element) {
		return fmt.Errorf("room: element %q is already taken on team %d", element, *mem.team)
	}

	slot := r.findSlot(*mem.team, playerID)
	if slot == nil {
		return fmt.Errorf("room: internal error: no slot found for player %q", playerID)
	}
	slot.Element = element
	return nil
}

// AddBot fills an empty seat on team with a bot, auto-selecting the first
// element from the catalog that isn't already used on that team (GDD §7).
func (r *Room) AddBot(team game.Team, difficulty string) (*Slot, error) {
	if r.state != StateLobby {
		return nil, fmt.Errorf("room: cannot add bot, room is %s", r.state)
	}
	if r.humanBotCountForTeam(team) >= r.TeamSize {
		return nil, fmt.Errorf("room: team %d is full", team)
	}

	element, ok := r.firstFreeElement(team)
	if !ok {
		return nil, fmt.Errorf("room: no free element left on team %d", team)
	}

	r.nextSeq++
	slot := &Slot{
		ID:         fmt.Sprintf("%s-slot-%d", r.ID, r.nextSeq),
		Team:       team,
		IsBot:      true,
		Difficulty: difficulty,
		Element:    element,
		Ready:      true,
	}
	r.slots[team] = append(r.slots[team], slot)
	return slot, nil
}

// RemoveBot removes a previously added bot slot, freeing its team capacity
// and element.
func (r *Room) RemoveBot(slotID string) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot remove bot, room is %s", r.state)
	}
	for team, slots := range r.slots {
		for i, s := range slots {
			if s.ID == slotID && s.IsBot {
				r.slots[team] = append(slots[:i], slots[i+1:]...)
				return nil
			}
		}
	}
	return fmt.Errorf("room: no bot slot %q found", slotID)
}

// SetReady toggles a connected player's ready flag.
func (r *Room) SetReady(playerID string, ready bool) error {
	mem, ok := r.members[playerID]
	if !ok {
		return fmt.Errorf("room: player %q has not joined this room", playerID)
	}
	if mem.team == nil {
		return fmt.Errorf("room: player %q must select a team first", playerID)
	}
	slot := r.findSlot(*mem.team, playerID)
	if slot == nil {
		return fmt.Errorf("room: internal error: no slot found for player %q", playerID)
	}
	slot.Ready = ready
	return nil
}

// StartMatch validates that both teams are completely filled with valid
// elements, builds the authoritative game.World for the match, and
// transitions the room into StateInProgress.
func (r *Room) StartMatch() (*game.World, error) {
	if r.state != StateLobby {
		return nil, fmt.Errorf("room: cannot start match, room is %s", r.state)
	}
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		slots := r.slots[team]
		if len(slots) != r.TeamSize {
			return nil, fmt.Errorf("room: team %d has %d/%d slots filled", team, len(slots), r.TeamSize)
		}
		for _, s := range slots {
			if s.Element == "" {
				return nil, fmt.Errorf("room: slot %q on team %d has no element selected", s.ID, team)
			}
		}
	}

	world := game.NewWorld()
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			id := s.PlayerID
			if s.IsBot {
				id = s.ID
			}
			world.AddMage(id, team, s.Element, s.IsBot)
		}
	}

	r.world = world
	r.state = StateInProgress
	return world, nil
}

// World returns the room's live simulation once a match has started, or nil
// before that.
func (r *Room) World() *game.World { return r.world }

// MemberIDs returns every human player's ID currently on the room's lobby
// roster, including players who have joined but not yet picked a team (and
// therefore have no slot yet). This lets the transport layer broadcast
// room_state to a player as soon as they join, before Slots() would
// otherwise mention them.
func (r *Room) MemberIDs() []string {
	out := make([]string, 0, len(r.members))
	for id := range r.members {
		out = append(out, id)
	}
	return out
}

// Slots returns a value-copy snapshot of every occupied slot across both
// teams. It lets a caller (e.g. a match loop) build things like a
// bot-difficulty map or a room_state broadcast without this package having
// to depend on internal/bot or internal/protocol.
func (r *Room) Slots() []Slot {
	out := make([]Slot, 0, r.TeamSize*2)
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			out = append(out, *s)
		}
	}
	return out
}

// MarkEnded transitions the room to StateEnded. It's called by the match
// loop once game.World reports a round winner; Room itself has no opinion
// on simulation outcomes, only on lobby/lifecycle state.
func (r *Room) MarkEnded() {
	r.state = StateEnded
}

func (r *Room) capacity() int { return r.TeamSize * 2 }

func (r *Room) occupiedCount() int {
	return len(r.members) + len(r.slots[game.TeamA]) + len(r.slots[game.TeamB]) - r.humanMembersWithTeam()
}

// humanMembersWithTeam avoids double counting: members that already have a
// team are represented both in r.members and in a team's slot list.
func (r *Room) humanMembersWithTeam() int {
	n := 0
	for _, m := range r.members {
		if m.team != nil {
			n++
		}
	}
	return n
}

func (r *Room) humanBotCountForTeam(team game.Team) int {
	return len(r.slots[team])
}

func (r *Room) firstFreeElement(team game.Team) (game.ElementID, bool) {
	for _, id := range game.AllElements() {
		if r.CanSelectElement(team, id) {
			return id, true
		}
	}
	return "", false
}

func (r *Room) findSlot(team game.Team, playerID string) *Slot {
	for _, s := range r.slots[team] {
		if s.PlayerID == playerID {
			return s
		}
	}
	return nil
}

func (r *Room) removeSlotFor(team game.Team, playerID string) {
	slots := r.slots[team]
	for i, s := range slots {
		if s.PlayerID == playerID {
			r.slots[team] = append(slots[:i], slots[i+1:]...)
			return
		}
	}
}
