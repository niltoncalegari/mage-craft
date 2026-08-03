// Package match ties a lobby room (internal/room) to a live simulation
// (internal/game) and its bots (internal/bot), and is the only place that
// needs all three: internal/room stays lobby-only, internal/bot stays
// simulation-only, and this package is the composition point the transport
// layer (cmd/mageserver) drives.
//
// Session also owns the single mutex that serializes every lobby mutation
// and every simulation tick for one room, so WebSocket read-pump goroutines
// (lobby actions, input) and the room's own 60Hz tick goroutine never race.
package match

import (
	"fmt"
	"math/rand"
	"sync"
	"time"

	"mage-craft/server/internal/bot"
	"mage-craft/server/internal/game"
	"mage-craft/server/internal/room"
)

// SnapshotEveryNTicks sets the broadcast rate relative to the 60Hz sim tick
// (60/3 = 20Hz, within the project plan's ~20-30Hz target).
const SnapshotEveryNTicks = 3

// Callbacks are invoked by Tick as the match progresses, synchronously and
// without the Session's lock held (so a handler may safely call back into
// the Session, e.g. Slots(), to build a broadcast payload).
type Callbacks struct {
	OnSnapshot func(Snapshot)
	OnRoundEnd func(winnerTeam int)
}

// Snapshot is a plain-data view of one simulation tick, independent of the
// wire protocol (internal/protocol converts it to JSON DTOs).
type Snapshot struct {
	Tick        uint64
	Mages       []MageState
	Projectiles []ProjectileState
	Puddles     []PuddleState
}

type MageState struct {
	ID       string
	Team     int
	Position game.Vec2
	Facing   game.Vec2
	Health   float64
	Lives    int
	Charging bool
	Charge   float64
	Element  game.ElementID
	Alive    bool
}

type ProjectileState struct {
	ID       string
	Element  game.ElementID
	Position game.Vec2
	Velocity game.Vec2
}

type PuddleState struct {
	ID        string
	Position  game.Vec2
	Radius    float64
	Remaining float64
}

// Session owns one room's lobby state and, once started, its live match.
type Session struct {
	mu sync.Mutex

	Room *room.Room
	cb   Callbacks

	world *game.World
	bots  map[string]bot.Difficulty
	brain *bot.Brain
	rng   *rand.Rand
	tick  uint64
	ended bool
}

// New wraps a freshly created lobby room in a Session.
func New(r *room.Room, cb Callbacks) *Session {
	return &Session{Room: r, cb: cb, rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

// Join registers a player in lobby, or as a spectator when the match is live.
func (s *Session) Join(playerID, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch s.Room.State() {
	case room.StateInProgress:
		return s.Room.JoinAsSpectator(playerID, name)
	case room.StateLobby:
		return s.Room.Join(playerID, name)
	default:
		return fmt.Errorf("match: cannot join, room is %s", s.Room.State())
	}
}

func (s *Session) Leave(playerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.Leave(playerID)
}

func (s *Session) SelectTeam(playerID string, team game.Team) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.SelectTeam(playerID, team)
}

func (s *Session) SelectElement(playerID string, element game.ElementID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.SelectElement(playerID, element)
}

func (s *Session) AddBot(team game.Team, difficulty string) (room.Slot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	slot, err := s.Room.AddBot(team, difficulty)
	if err != nil {
		return room.Slot{}, err
	}
	return *slot, nil
}

func (s *Session) RemoveBot(slotID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.RemoveBot(slotID)
}

// FillEmptyWithBots fills remaining seats; uses room.BotDifficulty when difficulty is empty.
func (s *Session) FillEmptyWithBots(difficulty string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.FillEmptyWithBots(difficulty)
}

func (s *Session) ClaimSlot(playerID, slotID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.ClaimSlot(playerID, slotID)
}

func (s *Session) SetReady(playerID string, ready bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.SetReady(playerID, ready)
}

// Slots returns a snapshot of every occupied slot, e.g. to build a
// room_state broadcast.
func (s *Session) Slots() []room.Slot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.Slots()
}

// Spectators returns current spectators.
func (s *Session) Spectators() []room.Spectator {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.Spectators()
}

// RoleOf reports player|spectator|"" for the given id.
func (s *Session) RoleOf(playerID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.RoleOf(playerID)
}

// MemberIDs returns every human player's ID on the room's roster
// (seated players and spectators).
func (s *Session) MemberIDs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.MemberIDs()
}

func (s *Session) State() room.State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.State()
}

// Summary returns the list_rooms entry for this session's room.
func (s *Session) Summary() room.Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Room.Summary()
}

// Ended reports whether this session's current match loop has finished
// (rematch lobby may still be open).
func (s *Session) Ended() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ended
}

// StartMatch validates and builds the world (delegating to *room.Room), then
// arms this Session's bot roster from the room's bot slots so Tick can drive
// them without internal/room needing to depend on internal/bot.
func (s *Session) StartMatch() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	world, err := s.Room.StartMatch()
	if err != nil {
		return err
	}

	difficulties := make(map[string]bot.Difficulty)
	for _, slot := range s.Room.Slots() {
		if slot.IsBot {
			difficulties[slot.ID] = bot.Difficulty(slot.Difficulty)
		}
	}

	s.world = world
	s.bots = difficulties
	// Fresh brain per match: the AI keeps per-bot decision/dodge timers that
	// must not carry over from the previous round.
	s.brain = bot.NewBrain(s.rng)
	s.tick = 0
	s.ended = false
	return nil
}

// SubmitInput forwards one input sample to playerID's live mage. It's a
// no-op (not an error) if playerID has no mage in the world, so a stray or
// late-arriving input from a spectator/bot-owner can't break the match.
func (s *Session) SubmitInput(playerID string, input game.MageInput) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.world == nil {
		return fmt.Errorf("match: not started yet")
	}
	s.world.SetInput(playerID, input)
	return nil
}

// Tick advances the simulation by one fixed step, if a match is running and
// hasn't ended yet. Safe to call from a ticker-driven goroutine; callbacks
// fire synchronously, after the lock is released.
func (s *Session) Tick() {
	s.mu.Lock()
	if s.world == nil || s.ended {
		s.mu.Unlock()
		return
	}

	s.brain.Step(s.world, s.bots, game.SimDt)
	s.world.Step(game.SimDt)
	s.tick++

	var snap *Snapshot
	if s.tick%SnapshotEveryNTicks == 0 {
		v := s.buildSnapshotLocked()
		snap = &v
	}

	roundEnded := false
	winner := 0
	if s.world.RoundOver && !s.ended {
		winner = int(*s.world.Winner)
		s.beginRematchLocked()
		roundEnded = true
	}
	s.mu.Unlock()

	if snap != nil && s.cb.OnSnapshot != nil {
		s.cb.OnSnapshot(*snap)
	}
	if roundEnded && s.cb.OnRoundEnd != nil {
		s.cb.OnRoundEnd(winner)
	}
}

// beginRematchLocked applies spectator claims, resets the room to lobby, and
// stops the current RunLoop (ended=true). Caller must hold s.mu.
func (s *Session) beginRematchLocked() {
	s.Room.ApplyClaims()
	s.Room.ResetToLobby()
	s.world = nil
	s.bots = nil
	s.ended = true
}

// RunLoop drives Tick at the fixed simulation rate until the match ends or
// stop is closed. Intended to run in its own goroutine, one per in-progress
// room.
func (s *Session) RunLoop(stop <-chan struct{}) {
	dt := game.SimDt // copy into a variable: converting the constant expression directly overflows Go's exact-constant conversion rules
	ticker := time.NewTicker(time.Duration(dt * float64(time.Second)))
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.Tick()
			if s.Ended() {
				return
			}
		case <-stop:
			return
		}
	}
}

func (s *Session) buildSnapshotLocked() Snapshot {
	mages := make([]MageState, 0, len(s.world.Mages))
	for _, m := range s.world.Mages {
		mages = append(mages, MageState{
			ID: m.ID, Team: int(m.Team), Position: m.Position, Facing: m.Facing,
			Health: m.Health, Lives: m.Lives, Charging: m.Charging, Charge: m.Charge,
			Element: m.Element, Alive: m.Alive,
		})
	}

	projectiles := make([]ProjectileState, 0, len(s.world.Projectiles))
	for _, p := range s.world.Projectiles {
		projectiles = append(projectiles, ProjectileState{
			ID: p.ID, Element: p.Element, Position: p.Position, Velocity: p.Velocity,
		})
	}

	puddles := make([]PuddleState, 0, len(s.world.Puddles))
	for _, pu := range s.world.Puddles {
		puddles = append(puddles, PuddleState{
			ID: pu.ID, Position: pu.Position, Radius: pu.Radius, Remaining: pu.Duration - pu.Elapsed,
		})
	}

	return Snapshot{Tick: s.tick, Mages: mages, Projectiles: projectiles, Puddles: puddles}
}
