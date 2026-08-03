package bot

import (
	"math"
	"math/rand"
	"testing"

	"mage-craft/server/internal/game"
)

func newRng() *rand.Rand { return rand.New(rand.NewSource(1)) }

// newCombatWorld builds a world on a bare rectangle so these AI unit tests,
// which place mages at explicit coordinates, aren't perturbed by the default
// map's obstacles blocking movement or line of sight. Cover-seeking behavior
// is covered separately with an explicit obstacle.
func newCombatWorld() *game.World {
	return game.NewWorldWithArena(game.Arena{Width: 24, Height: 16})
}

// decideOnce runs a single tick of the brain and returns the resulting input.
func decideOnce(w *game.World, botID string, d Difficulty) game.MageInput {
	b := NewBrain(newRng())
	b.Step(w, map[string]Difficulty{botID: d}, game.SimDt)
	return w.Mage(botID).Input
}

func TestDecide_NoEnemies_Wanders(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	b.Position = game.Vec2{X: 1, Y: 0}

	in := decideOnce(w, "bot1", Normal)

	if in.Move.LengthSq() < 0.5 {
		t.Fatalf("expected wander to produce a real move vector, got %+v", in.Move)
	}
	if in.Charging || in.Release {
		t.Errorf("wander should not charge/release, got %+v", in)
	}
}

func TestDecide_RetreatsWhenLowHealth(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	// Retreat only outscores attacking once health is critical (attack scores
	// 0.95; retreat peaks at 1.1) — same crossover as the client.
	b.Health = b.MaxHealth * 0.05

	in := decideOnce(w, "bot1", Normal)

	if in.Move.X >= 0 {
		t.Fatalf("expected bot to retreat away from target (-X), got move %+v", in.Move)
	}
	if in.Charging || in.Release {
		t.Errorf("retreating bot should not also be attacking, got %+v", in)
	}
}

func TestDecide_AttacksInRangeWhenCooldownReady(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: EngageRange - 1, Y: 0}

	in := decideOnce(w, "bot1", Normal)

	if !in.Charging {
		t.Fatalf("expected bot to start charging an attack in range, got %+v", in)
	}
	if dist := in.Aim.DistanceTo(target.Position); dist > EngageRange*0.5 {
		t.Errorf("expected aim near target, got aim %+v target %+v (dist %.2f)", in.Aim, target.Position, dist)
	}
}

func TestDecide_LeadsAMovingTarget(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: EngageRange - 1, Y: 0}
	target.Velocity = game.Vec2{Y: 6} // sprinting in +Y

	in := decideOnce(w, "bot1", Hard)

	if !in.Charging {
		t.Fatalf("expected the bot to charge at an in-range target, got %+v", in)
	}
	if in.Aim.Y <= 0 {
		t.Errorf("expected aim to lead the target's +Y movement, got aim %+v", in.Aim)
	}
}

func TestDecide_AdvancesWhenTargetOutOfRange(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: -10, Y: 0}
	target.Position = game.Vec2{X: 10, Y: 0}

	in := decideOnce(w, "bot1", Normal)

	if in.Charging {
		t.Fatalf("expected bot to advance rather than attack out of range, got %+v", in)
	}
	if in.Move.X <= 0 {
		t.Errorf("expected bot to move toward target (+X), got move %+v", in.Move)
	}
}

func TestDecide_ReleasesWhenChargeReachesThreshold(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	b.Charging = true
	b.Charge = tunings[Normal].ReleaseChargeMin

	in := decideOnce(w, "bot1", Normal)

	if !in.Release {
		t.Fatalf("expected bot to release once charge reaches the difficulty threshold, got %+v", in)
	}
}

func TestDecide_ContinuesChargingBelowThreshold(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	b.Charging = true
	b.Charge = 0.1

	in := decideOnce(w, "bot1", Normal)

	if in.Release {
		t.Fatalf("expected bot to keep holding charge below threshold, got release")
	}
	if !in.Charging {
		t.Errorf("expected charging input to persist, got %+v", in)
	}
}

// A charging bot must still be able to walk — the same rule that applies to
// human players (see TestWorld_MageCanMoveWhileCharging).
func TestDecide_KeepsMovingWhileCharging(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: -10, Y: 0}
	target.Position = game.Vec2{X: 10, Y: 0} // out of range, so it wants to advance
	b.Charging = true
	b.Charge = 0.1

	in := decideOnce(w, "bot1", Normal)

	if in.Move.LengthSq() == 0 {
		t.Errorf("expected a charging bot to keep advancing, got %+v", in)
	}
}

func TestDecide_DodgesIncomingProjectile(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 10, Y: 0}
	w.Projectiles["snow1"] = &game.Projectile{
		ID:       "snow1",
		OwnerID:  target.ID,
		Team:     game.TeamB,
		Position: game.Vec2{X: 2, Y: 0},
		Velocity: game.Vec2{X: -5, Y: 0}, // flying straight at the bot
		Alive:    true,
	}

	in := decideOnce(w, "bot1", Normal)

	if in.Move.LengthSq() < 0.5 {
		t.Fatalf("expected bot to dodge with a real move vector, got %+v", in.Move)
	}
	if math.Abs(in.Move.X) > 0.5 {
		t.Errorf("expected dodge to sidestep perpendicular to the incoming shot, got %+v", in.Move)
	}
}

func TestDecide_IgnoresFarOrRecedingProjectiles(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: -10, Y: 0}
	target.Position = game.Vec2{X: 10, Y: 0}
	w.Projectiles["far"] = &game.Projectile{
		ID: "far", OwnerID: target.ID, Team: game.TeamB, Alive: true,
		Position: game.Vec2{X: 5, Y: 0}, Velocity: game.Vec2{X: -5, Y: 0},
	}
	w.Projectiles["receding"] = &game.Projectile{
		ID: "receding", OwnerID: target.ID, Team: game.TeamB, Alive: true,
		Position: game.Vec2{X: -9, Y: 0}, Velocity: game.Vec2{X: 5, Y: 0}, // flying away
	}

	in := decideOnce(w, "bot1", Normal)

	if in.Move.X <= 0 {
		t.Fatalf("expected bot to fall through to advancing toward target (+X), got %+v", in.Move)
	}
}

// Easy bots deliberately stay exposed: they never retreat or seek cover.
func TestDecide_EasyNeverRetreats(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 3, Y: 0}
	b.Health = b.MaxHealth * 0.05

	for i := 0; i < 20; i++ {
		if in := decideOnce(w, "bot1", Easy); in.Move.X < 0 {
			t.Fatalf("easy bots should never retreat, got move %+v", in.Move)
		}
	}
}

// With a sight-blocker available, a hurt bot should head for cover rather than
// simply running in a straight line away from the threat.
func TestDecide_SeeksCoverBehindAnObstacle(t *testing.T) {
	w := game.NewWorldWithArena(game.Arena{
		Width:  24,
		Height: 16,
		Obstacles: []game.Obstacle{
			{Type: game.ObstacleRock, Position: game.Vec2{X: -3, Y: 3}, Radius: 0.6,
				BlocksMovement: true, BlocksSight: true, BlocksProjectiles: true, TopHeight: 1.0},
		},
	})
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 5, Y: 0}
	b.Health = b.MaxHealth * 0.05

	in := decideOnce(w, "bot1", Normal)

	// The only cover sits up and to the left, so the bot should move that way
	// instead of straight along -X.
	if in.Move.Y <= 0 {
		t.Errorf("expected the bot to head toward the cover spot (+Y), got move %+v", in.Move)
	}
}

func TestBrain_StepWritesInputForEveryBot(t *testing.T) {
	w := newCombatWorld()
	b1 := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	b2 := w.AddMage("bot2", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b1.Position = game.Vec2{X: 0, Y: 0}
	b2.Position = game.Vec2{X: 0, Y: 2}
	target.Position = game.Vec2{X: EngageRange - 1, Y: 0}

	brain := NewBrain(newRng())
	brain.Step(w, map[string]Difficulty{"bot1": Normal, "bot2": Normal}, game.SimDt)

	if !b1.Input.Charging && b1.Input.Move.LengthSq() == 0 {
		t.Errorf("expected bot1 to receive an input, got %+v", b1.Input)
	}
	if !b2.Input.Charging && b2.Input.Move.LengthSq() == 0 {
		t.Errorf("expected bot2 to receive an input, got %+v", b2.Input)
	}
}

// The decision interval is what stops bots from re-deciding every tick; the
// brain must therefore keep per-bot state between Steps.
func TestBrain_HoldsDecisionsBetweenTicks(t *testing.T) {
	w := newCombatWorld()
	b := w.AddMage("bot1", game.TeamA, game.ElementFire, true)
	target := w.AddMage("p1", game.TeamB, game.ElementFire, false)
	b.Position = game.Vec2{X: 0, Y: 0}
	target.Position = game.Vec2{X: 4, Y: 0}

	brain := NewBrain(newRng())
	bots := map[string]Difficulty{"bot1": Normal}
	brain.Step(w, bots, game.SimDt)
	first := brain.states["bot1"].decisionTimer

	brain.Step(w, bots, game.SimDt)
	if second := brain.states["bot1"].decisionTimer; second >= first {
		t.Errorf("expected the decision timer to tick down between steps, %.4f -> %.4f", first, second)
	}
}
