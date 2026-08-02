// Package room implements the pre-game lobby and its state machine (GDD §7,
// project plan §3): joining, team/element selection, bots filling empty
// slots, spectator join during in-progress matches, claim-for-rematch, and
// the transition into an authoritative game.World once a match starts.
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
	minTeamSize    = 1
	maxTeamSize    = 6
	maxSpectators  = 8
	defaultBotDiff = "normal"
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

	// PendingClaimPlayerID is set while a spectator has reserved this bot
	// (or empty) slot for the next rematch; the bot keeps playing until then.
	PendingClaimPlayerID string
}

// Spectator is a human watching an in-progress match.
type Spectator struct {
	PlayerID      string
	Name          string
	ClaimedSlotID string
}

type member struct {
	name string
	team *game.Team // nil until SelectTeam
}

// Room holds one match's lobby state and, once started, its live world.
type Room struct {
	ID       string
	TeamSize int

	// FillBots / BotDifficulty are set at create time; the transport layer
	// calls FillEmptyWithBots once the host has taken a seat.
	FillBots      bool
	BotDifficulty string

	state State

	members    map[string]*member // playerID -> lobby membership (seated humans)
	spectators map[string]*Spectator
	slots      map[game.Team][]*Slot
	nextSeq    int

	world *game.World
}

// NewRoom creates a room with team size between 1 and 6 (capacity =
// 2*teamSize, GDD §7).
func NewRoom(id string, teamSize int) (*Room, error) {
	if teamSize < minTeamSize || teamSize > maxTeamSize {
		return nil, fmt.Errorf("room: teamSize must be between %d and %d, got %d", minTeamSize, maxTeamSize, teamSize)
	}
	return &Room{
		ID:            id,
		TeamSize:      teamSize,
		BotDifficulty: defaultBotDiff,
		state:         StateLobby,
		members:       make(map[string]*member),
		spectators:    make(map[string]*Spectator),
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
	if _, exists := r.spectators[playerID]; exists {
		return fmt.Errorf("room: player %q already spectating", playerID)
	}
	if r.occupiedCount() >= r.capacity() {
		return fmt.Errorf("room: room is full")
	}
	r.members[playerID] = &member{name: name}
	return nil
}

// JoinAsSpectator registers a viewer during an in-progress match. They do
// not occupy a team slot until they claim one and rematch applies the claim.
func (r *Room) JoinAsSpectator(playerID, name string) error {
	if r.state != StateInProgress {
		return fmt.Errorf("room: cannot spectate, room is %s", r.state)
	}
	if _, exists := r.members[playerID]; exists {
		return fmt.Errorf("room: player %q already joined", playerID)
	}
	if _, exists := r.spectators[playerID]; exists {
		return fmt.Errorf("room: player %q already spectating", playerID)
	}
	if len(r.spectators) >= maxSpectators {
		return fmt.Errorf("room: spectator limit reached")
	}
	r.spectators[playerID] = &Spectator{PlayerID: playerID, Name: name}
	return nil
}

// Leave removes a player from the room (member or spectator), freeing their
// slot / pending claim.
func (r *Room) Leave(playerID string) error {
	if spec, ok := r.spectators[playerID]; ok {
		if spec.ClaimedSlotID != "" {
			r.clearClaimOnSlot(spec.ClaimedSlotID)
		}
		delete(r.spectators, playerID)
		return nil
	}
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
	if difficulty == "" {
		difficulty = defaultBotDiff
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
		Name:       fmt.Sprintf("Bot (%s)", difficulty),
	}
	r.slots[team] = append(r.slots[team], slot)
	return slot, nil
}

// FillEmptyWithBots fills every remaining seat on both teams with bots.
func (r *Room) FillEmptyWithBots(difficulty string) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot fill bots, room is %s", r.state)
	}
	if difficulty == "" {
		difficulty = r.BotDifficulty
	}
	if difficulty == "" {
		difficulty = defaultBotDiff
	}
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for r.humanBotCountForTeam(team) < r.TeamSize {
			if _, err := r.AddBot(team, difficulty); err != nil {
				return err
			}
		}
	}
	return nil
}

// RemoveBot removes a previously added bot slot, freeing its team capacity
// and element. Pending claims on that slot are cleared.
func (r *Room) RemoveBot(slotID string) error {
	if r.state != StateLobby {
		return fmt.Errorf("room: cannot remove bot, room is %s", r.state)
	}
	for team, slots := range r.slots {
		for i, s := range slots {
			if s.ID == slotID && s.IsBot {
				if s.PendingClaimPlayerID != "" {
					if spec := r.spectators[s.PendingClaimPlayerID]; spec != nil {
						spec.ClaimedSlotID = ""
					}
				}
				r.slots[team] = append(slots[:i], slots[i+1:]...)
				return nil
			}
		}
	}
	return fmt.Errorf("room: no bot slot %q found", slotID)
}

// ClaimSlot lets a spectator reserve a bot slot for the next rematch.
// The bot keeps playing until ApplyClaims runs at round end.
func (r *Room) ClaimSlot(playerID, slotID string) error {
	if r.state != StateInProgress && r.state != StateLobby {
		return fmt.Errorf("room: cannot claim slot, room is %s", r.state)
	}
	spec, ok := r.spectators[playerID]
	if !ok {
		return fmt.Errorf("room: player %q is not a spectator", playerID)
	}
	slot := r.findSlotByID(slotID)
	if slot == nil {
		return fmt.Errorf("room: slot %q not found", slotID)
	}
	if !slot.IsBot && slot.PlayerID != "" {
		return fmt.Errorf("room: slot %q is occupied by a human", slotID)
	}
	if slot.PendingClaimPlayerID != "" && slot.PendingClaimPlayerID != playerID {
		return fmt.Errorf("room: slot %q already claimed", slotID)
	}
	if spec.ClaimedSlotID != "" && spec.ClaimedSlotID != slotID {
		r.clearClaimOnSlot(spec.ClaimedSlotID)
	}
	slot.PendingClaimPlayerID = playerID
	spec.ClaimedSlotID = slotID
	return nil
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

// RoleOf reports "player", "spectator", or "" if the id is unknown.
func (r *Room) RoleOf(playerID string) string {
	if _, ok := r.members[playerID]; ok {
		return "player"
	}
	if _, ok := r.spectators[playerID]; ok {
		return "spectator"
	}
	return ""
}

// MemberIDs returns every human connected to the room (seated players and
// spectators), so the transport can broadcast room_state / snapshots to all.
func (r *Room) MemberIDs() []string {
	out := make([]string, 0, len(r.members)+len(r.spectators))
	for id := range r.members {
		out = append(out, id)
	}
	for id := range r.spectators {
		out = append(out, id)
	}
	return out
}

// Spectators returns a snapshot of current spectators.
func (r *Room) Spectators() []Spectator {
	out := make([]Spectator, 0, len(r.spectators))
	for _, s := range r.spectators {
		out = append(out, *s)
	}
	return out
}

// Slots returns a value-copy snapshot of every occupied slot across both
// teams.
func (r *Room) Slots() []Slot {
	out := make([]Slot, 0, r.TeamSize*2)
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			out = append(out, *s)
		}
	}
	return out
}

// Summary is a compact view used by list_rooms.
type Summary struct {
	RoomID            string
	TeamSize          int
	State             State
	Filled            int
	Capacity          int
	OpenBotSlots      int
	AcceptsSpectators bool
}

// Summary builds the list_rooms entry for this room.
func (r *Room) Summary() Summary {
	filled := 0
	openBots := 0
	for _, s := range r.Slots() {
		filled++
		if s.IsBot && s.PendingClaimPlayerID == "" {
			openBots++
		}
	}
	return Summary{
		RoomID:            r.ID,
		TeamSize:          r.TeamSize,
		State:             r.state,
		Filled:            filled,
		Capacity:          r.capacity(),
		OpenBotSlots:      openBots,
		AcceptsSpectators: r.state == StateInProgress && len(r.spectators) < maxSpectators,
	}
}

// MarkEnded transitions the room to StateEnded (abandon path). Rematch uses
// ResetToLobby instead.
func (r *Room) MarkEnded() {
	r.state = StateEnded
}

// ApplyClaims converts pending spectator claims into seated human slots,
// then clears the spectator roster entries that were promoted.
func (r *Room) ApplyClaims() {
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			if s.PendingClaimPlayerID == "" {
				continue
			}
			spec, ok := r.spectators[s.PendingClaimPlayerID]
			if !ok {
				s.PendingClaimPlayerID = ""
				continue
			}
			s.IsBot = false
			s.Difficulty = ""
			s.PlayerID = spec.PlayerID
			s.Name = spec.Name
			s.Ready = false
			s.PendingClaimPlayerID = ""
			teamCopy := team
			r.members[spec.PlayerID] = &member{name: spec.Name, team: &teamCopy}
			delete(r.spectators, spec.PlayerID)
		}
	}
}

// ResetToLobby clears the live world and returns the room to lobby for rematch.
// Call ApplyClaims before or after; Session.BeginRematch does ApplyClaims first.
func (r *Room) ResetToLobby() {
	r.world = nil
	r.state = StateLobby
	// Humans keep their seats; bots stay until claimed/removed. Clear ready
	// so everyone confirms for the next round.
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			if !s.IsBot {
				s.Ready = false
			}
		}
	}
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

func (r *Room) findSlotByID(slotID string) *Slot {
	for _, team := range []game.Team{game.TeamA, game.TeamB} {
		for _, s := range r.slots[team] {
			if s.ID == slotID {
				return s
			}
		}
	}
	return nil
}

func (r *Room) clearClaimOnSlot(slotID string) {
	if s := r.findSlotByID(slotID); s != nil {
		s.PendingClaimPlayerID = ""
	}
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
