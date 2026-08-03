package match

import (
	"testing"

	"mage-craft/server/internal/game"
	"mage-craft/server/internal/room"
)

func newStartedSession(t *testing.T, cb Callbacks) *Session {
	t.Helper()
	m := room.NewManager()
	r, err := m.CreateRoom(1)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	s := New(r, cb)

	must(t, s.Join("p1", "Alice"))
	must(t, s.SelectTeam("p1", game.TeamA))
	must(t, s.SelectElement("p1", game.ElementFire))
	must(t, s.Join("p2", "Bob"))
	must(t, s.SelectTeam("p2", game.TeamB))
	must(t, s.SelectElement("p2", game.ElementIce))

	if err := s.StartMatch(); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	return s
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSession_StartMatch_ArmsBotDifficultiesAndBuildsWorld(t *testing.T) {
	m := room.NewManager()
	r, err := m.CreateRoom(1)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	s := New(r, Callbacks{})

	must(t, s.Join("p1", "Alice"))
	must(t, s.SelectTeam("p1", game.TeamA))
	must(t, s.SelectElement("p1", game.ElementFire))
	botSlot, err := s.AddBot(game.TeamB, "hard")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}

	if err := s.StartMatch(); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	if s.bots[botSlot.ID] != "hard" {
		t.Fatalf("expected bot difficulty to be armed for slot %q, got %v", botSlot.ID, s.bots)
	}
	if s.world.Mage("p1") == nil {
		t.Fatalf("expected the world to contain p1's mage after start")
	}
}

func TestSession_SubmitInput_FailsBeforeMatchStarts(t *testing.T) {
	m := room.NewManager()
	r, _ := m.CreateRoom(1)
	s := New(r, Callbacks{})

	if err := s.SubmitInput("p1", game.MageInput{}); err == nil {
		t.Fatalf("expected SubmitInput to fail before StartMatch")
	}
}

func TestSession_SubmitInput_FeedsTheWorld(t *testing.T) {
	s := newStartedSession(t, Callbacks{})

	before := s.world.Mage("p1").Position.X
	must(t, s.SubmitInput("p1", game.MageInput{Move: game.Vec2{X: 1}}))
	s.Tick()

	if got := s.world.Mage("p1").Position.X; got <= before {
		t.Errorf("expected p1 to have moved in +X after ticking with a move input, %.3f -> %.3f", before, got)
	}
}

func TestSession_Tick_InvokesSnapshotPeriodically(t *testing.T) {
	var snapshots int
	s := newStartedSession(t, Callbacks{OnSnapshot: func(Snapshot) { snapshots++ }})

	for i := 0; i < SnapshotEveryNTicks; i++ {
		s.Tick()
	}

	if snapshots == 0 {
		t.Fatalf("expected at least one snapshot after %d ticks", SnapshotEveryNTicks)
	}
}

func TestSession_Tick_EndsMatchAndReportsWinnerExactlyOnce(t *testing.T) {
	var endCalls int
	var winner int
	s := newStartedSession(t, Callbacks{OnRoundEnd: func(w int) {
		endCalls++
		winner = w
	}})

	// Force team B's mage out, as if it had just lost its last life.
	for _, mg := range s.world.Mages {
		if mg.Team == game.TeamB {
			mg.Alive = false
			mg.Lives = 0
		}
	}

	s.Tick()
	s.Tick() // a second tick after the round is over must not re-fire the callback

	if endCalls != 1 {
		t.Fatalf("expected OnRoundEnd to fire exactly once, got %d calls", endCalls)
	}
	if winner != int(game.TeamA) {
		t.Fatalf("expected team A to be reported as the winner, got %d", winner)
	}
	if s.Room.State() != room.StateLobby {
		t.Fatalf("expected rematch lobby after round end, got %s", s.Room.State())
	}
	if !s.Ended() {
		t.Fatalf("expected the match loop to be marked ended after rematch reset")
	}
}

func TestSession_SpectatorClaimAppliesOnRematch(t *testing.T) {
	m := room.NewManager()
	r, err := m.CreateRoom(1)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	s := New(r, Callbacks{})

	must(t, s.Join("p1", "Alice"))
	must(t, s.SelectTeam("p1", game.TeamA))
	must(t, s.SelectElement("p1", game.ElementFire))
	botSlot, err := s.AddBot(game.TeamB, "normal")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if err := s.StartMatch(); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}

	must(t, s.Join("p3", "Carol")) // spectator
	if role := s.RoleOf("p3"); role != "spectator" {
		t.Fatalf("expected p3 to be spectator, got %q", role)
	}
	must(t, s.ClaimSlot("p3", botSlot.ID))

	for _, mg := range s.world.Mages {
		if mg.Team == game.TeamB {
			mg.Alive = false
			mg.Lives = 0
		}
	}
	s.Tick()

	if s.Room.State() != room.StateLobby {
		t.Fatalf("expected lobby after rematch, got %s", s.Room.State())
	}
	if role := s.RoleOf("p3"); role != "player" {
		t.Fatalf("expected p3 promoted to player, got %q", role)
	}
	found := false
	for _, slot := range s.Slots() {
		if slot.PlayerID == "p3" {
			found = true
			if slot.IsBot {
				t.Fatalf("claimed slot should no longer be a bot")
			}
			if slot.Element == "" {
				t.Fatalf("claimed slot should keep the bot's element")
			}
		}
	}
	if !found {
		t.Fatalf("expected p3 to own a seat after claim+rematch")
	}

	must(t, s.SetReady("p1", true))
	must(t, s.SetReady("p3", true))
	if err := s.StartMatch(); err != nil {
		t.Fatalf("rematch StartMatch: %v", err)
	}
	if s.world.Mage("p3") == nil {
		t.Fatalf("expected p3's mage in the rematch world")
	}
}

func TestSession_FillEmptyWithBots(t *testing.T) {
	m := room.NewManager()
	r, err := m.CreateRoom(2)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	r.FillBots = true
	s := New(r, Callbacks{})

	must(t, s.Join("p1", "Alice"))
	must(t, s.SelectTeam("p1", game.TeamA))
	must(t, s.SelectElement("p1", game.ElementFire))
	must(t, s.FillEmptyWithBots("easy"))

	slots := s.Slots()
	if len(slots) != 4 {
		t.Fatalf("expected 4 filled slots, got %d", len(slots))
	}
	bots := 0
	for _, slot := range slots {
		if slot.IsBot {
			bots++
		}
	}
	if bots != 3 {
		t.Fatalf("expected 3 bots after fill, got %d", bots)
	}
}
