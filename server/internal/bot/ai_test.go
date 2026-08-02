package bot

import (
	"math/rand"
	"testing"

	"mage-craft/server/internal/game"
)

func newRng() *rand.Rand { return rand.New(rand.NewSource(1)) }

func TestDecide_NoEnemies_Wanders(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)

	in := Decide(w, bot, Normal, newRng())

	if in.Move.LengthSq() < 0.9 {
		t.Fatalf("expected wander to produce a unit-ish move vector, got %+v", in.Move)
	}
	if in.Charging || in.Release {
		t.Errorf("wander should not charge/release, got %+v", in)
	}
}

func TestDecide_RetreatsWhenLowHealth(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	bot.Health = bot.MaxHealth * 0.2

	in := Decide(w, bot, Normal, newRng())

	if in.Move.X >= 0 {
		t.Fatalf("expected bot to retreat away from target (-X), got move %+v", in.Move)
	}
	if in.Charging || in.Release {
		t.Errorf("retreating bot should not also be attacking, got %+v", in)
	}
}

func TestDecide_AttacksInRangeWhenCooldownReady(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: EngageRange - 1, Y: 0}

	in := Decide(w, bot, Normal, newRng())

	if !in.Charging {
		t.Fatalf("expected bot to start charging an attack in range, got %+v", in)
	}
	if dist := in.Aim.DistanceTo(target.Position); dist > EngageRange*0.5 {
		t.Errorf("expected aim near target, got aim %+v target %+v (dist %.2f)", in.Aim, target.Position, dist)
	}
}

func TestDecide_AdvancesWhenTargetOutOfRange(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: EngageRange + 5, Y: 0}

	in := Decide(w, bot, Normal, newRng())

	if in.Charging {
		t.Fatalf("expected bot to advance rather than attack out of range, got %+v", in)
	}
	if in.Move.X <= 0 {
		t.Errorf("expected bot to move toward target (+X), got move %+v", in.Move)
	}
}

func TestDecide_ReleasesWhenChargeReachesThreshold(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	bot.Charging = true
	bot.Charge = tunings[Normal].ReleaseChargeMin

	in := Decide(w, bot, Normal, newRng())

	if !in.Release {
		t.Fatalf("expected bot to release once charge reaches the difficulty threshold, got %+v", in)
	}
}

func TestDecide_ContinuesChargingBelowThreshold(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	bot.Charging = true
	bot.Charge = 0.1

	in := Decide(w, bot, Normal, newRng())

	if in.Release {
		t.Fatalf("expected bot to keep holding charge below threshold, got release")
	}
	if !in.Charging {
		t.Errorf("expected charging input to persist, got %+v", in)
	}
}

func TestStep_AppliesDecisionsAsWorldInput(t *testing.T) {
	w := game.NewWorld()
	bot := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	bot.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: EngageRange - 1, Y: 0}

	Step(w, map[string]Difficulty{"bot1": Normal}, newRng())

	if !bot.Input.Charging {
		t.Fatalf("expected Step to write the bot's decision into the mage's world input, got %+v", bot.Input)
	}
}
