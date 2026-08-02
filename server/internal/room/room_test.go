package room

import (
	"testing"

	"mage-craft/server/internal/game"
)

func newTestRoom(t *testing.T, teamSize int) *Room {
	t.Helper()
	m := NewManager()
	r, err := m.CreateRoom(teamSize)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	return r
}

func TestManager_CreateRoom_AssignsUniqueIDs(t *testing.T) {
	m := NewManager()
	r1, err := m.CreateRoom(2)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	r2, err := m.CreateRoom(2)
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if r1.ID == "" || r2.ID == "" || r1.ID == r2.ID {
		t.Fatalf("expected two distinct non-empty room ids, got %q and %q", r1.ID, r2.ID)
	}
	if got, ok := m.Room(r1.ID); !ok || got != r1 {
		t.Errorf("Manager.Room did not return the created room")
	}
}

func TestManager_CreateRoom_RejectsInvalidTeamSize(t *testing.T) {
	m := NewManager()
	for _, size := range []int{0, -1, 7} {
		if _, err := m.CreateRoom(size); err == nil {
			t.Errorf("expected teamSize=%d to be rejected", size)
		}
	}
}

func TestRoom_JoinThenSelectTeam_OccupiesASlot(t *testing.T) {
	r := newTestRoom(t, 2)

	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))

	slot := findSlotByPlayer(r, game.TeamA, "p1")
	if slot == nil {
		t.Fatalf("expected p1 to occupy a slot on team A")
	}
	if slot.Name != "Alice" || slot.IsBot {
		t.Errorf("unexpected slot for p1: %+v", slot)
	}
}

func TestRoom_SelectTeam_FailsWhenTeamFull(t *testing.T) {
	r := newTestRoom(t, 1) // 1x1: team A has exactly one slot
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.Join("p2", "Bob"))

	if err := r.SelectTeam("p2", game.TeamA); err == nil {
		t.Fatalf("expected SelectTeam to fail once team A is full")
	}
}

func TestRoom_SelectElement_RejectsDuplicateWithinTeam(t *testing.T) {
	r := newTestRoom(t, 2)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.Join("p2", "Bob"))
	must(t, r.SelectTeam("p2", game.TeamA))

	must(t, r.SelectElement("p1", game.ElementFire))
	if err := r.SelectElement("p2", game.ElementFire); err == nil {
		t.Fatalf("expected a second mage on the same team to be rejected for reusing fire")
	}
	if err := r.SelectElement("p2", game.ElementIce); err != nil {
		t.Errorf("expected a free element to be accepted, got %v", err)
	}
}

func TestRoom_SelectElement_AllowsSameElementOnOpposingTeam(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.Join("p2", "Bob"))
	must(t, r.SelectTeam("p2", game.TeamB))

	must(t, r.SelectElement("p1", game.ElementFire))
	if err := r.SelectElement("p2", game.ElementFire); err != nil {
		t.Errorf("expected opposing teams to be able to reuse the same element, got %v", err)
	}
}

func TestRoom_SelectElement_RejectsUnknownElement(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))

	if err := r.SelectElement("p1", game.ElementID("shadow")); err == nil {
		t.Fatalf("expected an out-of-catalog element to be rejected")
	}
}

func TestRoom_AddBot_PicksFirstFreeElementInTeam(t *testing.T) {
	r := newTestRoom(t, 2)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))

	slot, err := r.AddBot(game.TeamA, "normal")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if slot.Element == "" || slot.Element == game.ElementFire {
		t.Errorf("expected bot to auto-pick a free element other than fire, got %q", slot.Element)
	}
	if !slot.IsBot {
		t.Errorf("expected slot to be marked as a bot")
	}
}

func TestRoom_AddBot_FailsWhenTeamFull(t *testing.T) {
	r := newTestRoom(t, 1)
	if _, err := r.AddBot(game.TeamA, "easy"); err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if _, err := r.AddBot(game.TeamA, "easy"); err == nil {
		t.Fatalf("expected AddBot to fail once team A (size 1) is full")
	}
}

func TestRoom_RemoveBot_FreesSlotAndElement(t *testing.T) {
	r := newTestRoom(t, 1)
	slot, err := r.AddBot(game.TeamA, "easy")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if err := r.RemoveBot(slot.ID); err != nil {
		t.Fatalf("RemoveBot: %v", err)
	}

	// The slot should be free again, so a human can take it.
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
}

func TestRoom_Leave_FreesSlotAndElement(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))

	must(t, r.Leave("p1"))

	must(t, r.Join("p2", "Bob"))
	must(t, r.SelectTeam("p2", game.TeamA))
	if err := r.SelectElement("p2", game.ElementFire); err != nil {
		t.Errorf("expected fire to be free again after p1 left, got %v", err)
	}
}

func TestRoom_StartMatch_FailsUntilEverySlotHasAnElement(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.Join("p2", "Bob"))
	must(t, r.SelectTeam("p2", game.TeamB))

	if _, err := r.StartMatch(); err == nil {
		t.Fatalf("expected StartMatch to fail before elements are chosen")
	}

	must(t, r.SelectElement("p1", game.ElementFire))
	must(t, r.SelectElement("p2", game.ElementIce))

	world, err := r.StartMatch()
	if err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	if world == nil {
		t.Fatalf("expected StartMatch to return a built world")
	}
	if r.State() != StateInProgress {
		t.Fatalf("expected room to be in_progress after StartMatch, got %s", r.State())
	}
	if got := world.Mage("p1"); got == nil || got.Element != game.ElementFire {
		t.Errorf("expected world to contain p1's mage with the fire element, got %+v", got)
	}
}

func TestRoom_StartMatch_UsesSlotIDAsMageIDForBots(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))
	slot, err := r.AddBot(game.TeamB, "normal")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}

	world, err := r.StartMatch()
	if err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	if got := world.Mage(slot.ID); got == nil || !got.IsBot {
		t.Errorf("expected world to contain the bot's mage under its slot id %q, got %+v", slot.ID, got)
	}
}

func TestRoom_JoinAsSpectator_OnlyDuringInProgress(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))
	if _, err := r.AddBot(game.TeamB, "normal"); err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if err := r.JoinAsSpectator("spec", "Viewer"); err == nil {
		t.Fatalf("expected spectate to fail in lobby")
	}
	if _, err := r.StartMatch(); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	must(t, r.JoinAsSpectator("spec", "Viewer"))
	if r.RoleOf("spec") != "spectator" {
		t.Fatalf("expected spectator role")
	}
}

func TestRoom_ClaimSlotAndApplyClaims(t *testing.T) {
	r := newTestRoom(t, 1)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))
	bot, err := r.AddBot(game.TeamB, "normal")
	if err != nil {
		t.Fatalf("AddBot: %v", err)
	}
	if _, err := r.StartMatch(); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	must(t, r.JoinAsSpectator("spec", "Viewer"))
	must(t, r.ClaimSlot("spec", bot.ID))
	r.ApplyClaims()
	r.ResetToLobby()
	if r.State() != StateLobby {
		t.Fatalf("expected lobby, got %s", r.State())
	}
	if r.RoleOf("spec") != "player" {
		t.Fatalf("expected spec promoted to player")
	}
	slot := findSlotByPlayer(r, game.TeamB, "spec")
	if slot == nil || slot.IsBot {
		t.Fatalf("expected human seat for spec, got %+v", slot)
	}
}

func TestRoom_FillEmptyWithBots(t *testing.T) {
	r := newTestRoom(t, 2)
	must(t, r.Join("p1", "Alice"))
	must(t, r.SelectTeam("p1", game.TeamA))
	must(t, r.SelectElement("p1", game.ElementFire))
	must(t, r.FillEmptyWithBots("normal"))
	if len(r.Slots()) != 4 {
		t.Fatalf("expected full room, got %d slots", len(r.Slots()))
	}
}

func findSlotByPlayer(r *Room, team game.Team, playerID string) *Slot {
	return r.findSlot(team, playerID)
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
