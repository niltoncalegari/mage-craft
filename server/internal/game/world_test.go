package game

import (
	"math"
	"testing"
)

func stepN(w *World, n int, dt float64) {
	for i := 0; i < n; i++ {
		w.Step(dt)
	}
}

func TestWorld_MageMovesTowardInput(t *testing.T) {
	w := NewWorld()
	m := w.AddMage("p1", TeamA, ElementFire, false)
	start := m.Position

	w.SetInput("p1", MageInput{Move: Vec2{X: 1, Y: 0}})
	stepN(w, 30, SimDt) // 0.5s held

	delta := m.Position.Sub(start)
	if delta.X <= 0 {
		t.Fatalf("expected mage to move in +X, got delta %+v", delta)
	}
	wantDist := MoveSpeed * 0.5
	if math.Abs(delta.Length()-wantDist) > 0.5 {
		t.Errorf("expected to travel ~%.2f units, got %.2f", wantDist, delta.Length())
	}
}

func TestWorld_ChargeAndReleaseSpawnsProjectile(t *testing.T) {
	w := NewWorld()
	m := w.AddMage("p1", TeamA, ElementFire, false)
	aim := m.Position.Add(Vec2{X: 10})

	w.SetInput("p1", MageInput{Aim: aim, Charging: true})
	stepN(w, int(ChargeTime/SimDt)+5, SimDt)

	if m.Charge < 1 {
		t.Fatalf("expected full charge after %.2fs, got %.2f", ChargeTime, m.Charge)
	}

	w.SetInput("p1", MageInput{Aim: aim, Release: true})
	w.Step(SimDt)

	if len(w.Projectiles) != 1 {
		t.Fatalf("expected 1 projectile after release, got %d", len(w.Projectiles))
	}
	for _, p := range w.Projectiles {
		if p.OwnerID != "p1" || p.Team != TeamA || p.Element != ElementFire {
			t.Errorf("unexpected projectile %+v", p)
		}
	}
	if m.Charge != 0 || m.Charging {
		t.Errorf("expected charge reset after release, got charge=%.2f charging=%v", m.Charge, m.Charging)
	}
	if m.ThrowCooldown <= 0 {
		t.Errorf("expected throw cooldown to be set after releasing")
	}
}

// fullyCharge drives a mage's charge to 1.0 and releases a throw aimed at target.
func fullyChargeAndRelease(w *World, id string, target Vec2) {
	w.SetInput(id, MageInput{Aim: target, Charging: true})
	stepN(w, int(ChargeTime/SimDt)+5, SimDt)
	w.SetInput(id, MageInput{Aim: target, Release: true})
	w.Step(SimDt)
}

func TestWorld_ProjectileHitsEnemyAppliesDamageAndKnockback(t *testing.T) {
	w := NewWorld()
	attacker := w.AddMage("atk", TeamA, ElementFire, false)
	target := w.AddMage("def", TeamB, ElementFire, false)
	attacker.Position = Vec2{X: -2, Y: 0}
	target.Position = Vec2{X: 2, Y: 0}
	targetStart := target.Position

	fullyChargeAndRelease(w, "atk", target.Position)

	hit := false
	for i := 0; i < 120 && !hit; i++ {
		w.Step(SimDt)
		if target.Health < target.MaxHealth {
			hit = true
		}
	}

	if !hit {
		t.Fatalf("expected the fire projectile to hit the target within 2s")
	}
	if target.Health >= target.MaxHealth {
		t.Errorf("expected damage to be applied, health=%.1f", target.Health)
	}
	if target.Position.DistanceTo(targetStart) <= 0 {
		t.Errorf("expected knockback to move the target, stayed at %+v", target.Position)
	}
	if attacker.ThrowCooldown <= 0 {
		t.Errorf("expected attacker's throw to be on cooldown after firing")
	}
}

func TestWorld_IceAppliesSlow(t *testing.T) {
	w := NewWorld()
	attacker := w.AddMage("atk", TeamA, ElementIce, false)
	target := w.AddMage("def", TeamB, ElementFire, false)
	attacker.Position = Vec2{X: -2, Y: 0}
	target.Position = Vec2{X: 2, Y: 0}

	fullyChargeAndRelease(w, "atk", target.Position)
	for i := 0; i < 120; i++ {
		w.Step(SimDt)
		if target.SlowTimer > 0 {
			break
		}
	}

	if target.SlowTimer <= 0 || target.SlowFactor <= 0 {
		t.Fatalf("expected ice hit to apply a slow, got timer=%.2f factor=%.2f", target.SlowTimer, target.SlowFactor)
	}
}

func TestWorld_PoisonSpawnsPuddleAndTicksDamage(t *testing.T) {
	w := NewWorld()
	attacker := w.AddMage("atk", TeamA, ElementPoison, false)
	target := w.AddMage("def", TeamB, ElementFire, false)
	attacker.Position = Vec2{X: -2, Y: 0}
	target.Position = Vec2{X: 2, Y: 0}

	fullyChargeAndRelease(w, "atk", target.Position)
	for i := 0; i < 120 && len(w.Puddles) == 0; i++ {
		w.Step(SimDt)
	}

	if len(w.Puddles) != 1 {
		t.Fatalf("expected poison impact to spawn exactly 1 puddle, got %d", len(w.Puddles))
	}

	healthAfterImpact := target.Health
	// Target stays put inside the puddle; step past a full tick interval.
	def, _ := ElementDefFor(ElementPoison)
	stepN(w, int(def.PuddleTickInterval/SimDt)+5, SimDt)

	if !(target.Health < healthAfterImpact) {
		t.Errorf("expected puddle to tick further damage on target standing in it: before=%.1f after=%.1f", healthAfterImpact, target.Health)
	}
}

func TestWorld_StoneInterruptsCharge(t *testing.T) {
	w := NewWorld()
	attacker := w.AddMage("atk", TeamA, ElementStone, false)
	target := w.AddMage("def", TeamB, ElementFire, false)
	attacker.Position = Vec2{X: -2, Y: 0}
	target.Position = Vec2{X: 2, Y: 0}

	// Target starts charging its own throw.
	w.SetInput("def", MageInput{Aim: attacker.Position, Charging: true})
	stepN(w, 20, SimDt)
	if target.Charge <= 0 {
		t.Fatalf("expected target to have accumulated some charge before being hit")
	}

	fullyChargeAndRelease(w, "atk", target.Position)
	for i := 0; i < 120; i++ {
		w.Step(SimDt)
		if target.Health < target.MaxHealth {
			break
		}
	}

	if target.Charge != 0 || target.Charging {
		t.Errorf("expected stone hit to interrupt target's charge, got charge=%.2f charging=%v", target.Charge, target.Charging)
	}
}

func TestWorld_DeathRespawnAndLives(t *testing.T) {
	w := NewWorld()
	m := w.AddMage("p1", TeamA, ElementFire, false)
	m.Health = 1
	startLives := m.Lives

	w.dealDamage(m, 999, Vec2{X: 1, Y: 0}, 0)

	if m.Alive {
		t.Fatalf("expected mage to die from lethal damage")
	}
	if m.Lives != startLives-1 {
		t.Fatalf("expected lives to decrement by 1, got %d -> %d", startLives, m.Lives)
	}
	if m.RespawnTimer <= 0 {
		t.Fatalf("expected a respawn timer to be armed after death")
	}

	stepN(w, int(RespawnDelay/SimDt)+5, SimDt)

	if !m.Alive {
		t.Fatalf("expected mage to respawn after %.2fs", RespawnDelay)
	}
	if m.Health != m.MaxHealth {
		t.Errorf("expected full health on respawn, got %.1f", m.Health)
	}
	if m.ImmunityTimer <= 0 {
		t.Errorf("expected respawn immunity to be granted")
	}
}

func TestWorld_RoundEndsWhenTeamEliminated(t *testing.T) {
	w := NewWorld()
	w.AddMage("a1", TeamA, ElementFire, false)
	loser := w.AddMage("b1", TeamB, ElementFire, false)

	loser.Alive = false
	loser.Lives = 0

	w.Step(SimDt)

	if !w.RoundOver {
		t.Fatalf("expected round to be over once team B has no mages left")
	}
	if w.Winner == nil || *w.Winner != TeamA {
		t.Fatalf("expected team A to win, got %+v", w.Winner)
	}
}
