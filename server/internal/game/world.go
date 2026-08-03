package game

import (
	"fmt"
	"math"
	"sort"
)

// World is the authoritative simulation state for one match (GDD §14). It
// plays on the same JSON-defined arena the client renders (see arena.go),
// including obstacle collision, projectile blocking and line-of-sight.
type World struct {
	Arena       Arena
	Mages       map[string]*Mage
	Projectiles map[string]*Projectile
	Puddles     map[string]*Puddle

	RoundOver bool
	Winner    *Team

	nextID     uint64
	teamCounts map[Team]int
}

func NewWorld() *World {
	return NewWorldWithArena(DefaultArena())
}

// NewWorldWithArena builds a world on a specific arena (used by tests that
// need a bare rectangle instead of the default decorated map).
func NewWorldWithArena(arena Arena) *World {
	return &World{
		Arena:       arena,
		Mages:       make(map[string]*Mage),
		Projectiles: make(map[string]*Projectile),
		Puddles:     make(map[string]*Puddle),
		teamCounts:  make(map[Team]int),
	}
}

// AddMage places a new mage (human or bot) into the world at its team's next
// spawn slot, per GDD §7's room/team model.
func (w *World) AddMage(id string, team Team, element ElementID, isBot bool) *Mage {
	idx := w.teamCounts[team]
	w.teamCounts[team]++

	m := &Mage{
		ID:        id,
		Team:      team,
		IsBot:     isBot,
		Element:   element,
		Position:  w.Arena.SpawnFor(team, idx),
		Facing:    Vec2{X: facingSignForTeam(team)},
		Health:    MaxHealth,
		MaxHealth: MaxHealth,
		Alive:     true,
		Lives:     DefaultLives,
		State:     MageIdle,
	}
	w.Mages[id] = m
	return m
}

func (w *World) Mage(id string) *Mage { return w.Mages[id] }

// SetInput stores the latest input command for a mage; it is applied at the
// start of the next Step (GDD §6).
func (w *World) SetInput(id string, input MageInput) {
	if m, ok := w.Mages[id]; ok {
		m.Input = input
	}
}

// Step advances the simulation by dt seconds (GDD §14, fixed 60 Hz tick).
func (w *World) Step(dt float64) {
	if w.RoundOver {
		return
	}

	for _, m := range w.Mages {
		w.updateMage(m, dt)
	}
	w.separateMages()
	w.updateProjectiles(dt)
	w.updatePuddles(dt)
	w.checkRoundEnd()

	// Release is an edge-triggered "the client asked to let go this tick"
	// signal; drop it once processed so it never re-fires on a later tick.
	for _, m := range w.Mages {
		m.Input.Release = false
	}
}

func (w *World) updateMage(m *Mage, dt float64) {
	if m.ImmunityTimer > 0 {
		m.ImmunityTimer = decay(m.ImmunityTimer, dt)
	}
	if m.SlowTimer > 0 {
		m.SlowTimer = decay(m.SlowTimer, dt)
		if m.SlowTimer == 0 {
			m.SlowFactor = 0
		}
	}
	if m.ThrowCooldown > 0 {
		m.ThrowCooldown = decay(m.ThrowCooldown, dt)
	}

	if !m.Alive {
		if m.Lives > 0 && m.RespawnTimer > 0 {
			m.RespawnTimer = decay(m.RespawnTimer, dt)
			if m.RespawnTimer == 0 {
				w.respawn(m)
			}
		}
		return
	}

	if m.StunTimer > 0 {
		// Knockback is a decaying slide over the stun window (mirrors the
		// client's DamageSystem.ts), not an instant position jump.
		m.Position = w.resolveMove(m.Position, m.KnockbackVelocity.Scale(dt))
		m.KnockbackVelocity = m.KnockbackVelocity.Scale(math.Exp(-KnockbackDamping * dt))
		if m.KnockbackVelocity.LengthSq() <= KnockbackStopSpeed*KnockbackStopSpeed {
			m.KnockbackVelocity = Vec2{}
		}

		m.StunTimer = decay(m.StunTimer, dt)
		m.State = MageStunned
		if m.StunTimer == 0 {
			m.KnockbackVelocity = Vec2{}
			m.State = MageIdle
		}
		return
	}

	if m.RecoveryTimer > 0 {
		m.RecoveryTimer = decay(m.RecoveryTimer, dt)
		m.State = MageRecovering
		if m.RecoveryTimer == 0 {
			m.State = MageIdle
		}
		// No early return: recovery gates re-charging (via ThrowCooldown, which
		// is longer) but must not freeze the mage in place.
	}

	def, _ := ElementDefFor(m.Element)
	input := m.Input

	switch {
	case input.Release && m.Charging:
		w.releaseThrow(m, def)
	case input.Charging && m.ThrowCooldown <= 0:
		m.Charging = true
		m.State = MageCharging
		m.Charge += dt / ChargeTime
		if m.Charge > 1 {
			m.Charge = 1
		}
		// Turn toward the aim point rather than snapping, and ignore a cursor
		// sitting on top of the mage (mirrors the client's AIM deadzone/turn).
		if aim := input.Aim.Sub(m.Position); aim.Length() > AimDeadzone {
			m.Facing = m.Facing.RotateTowards(aim.Normalized(), AimTurnSpeed*dt)
		}
	default:
		if m.Charging {
			// The client stopped holding without an explicit release
			// message (e.g. dropped packet) — release at whatever charge
			// was accumulated rather than losing the throw silently.
			w.releaseThrow(m, def)
		}
	}

	// Charging and recovering do NOT root a mage — only stun/freeze/death do,
	// and those already returned above. This mirrors the client's
	// canAcceptOrders (Hit/Frozen/Defeated only), where you keep walking while
	// holding a charge.
	w.moveMage(m, input, dt)
}

func (w *World) moveMage(m *Mage, input MageInput, dt float64) {
	move := input.Move.ClampLength(1)

	speed := MoveSpeed
	if m.SlowFactor > 0 {
		speed *= 1 - m.SlowFactor
	}

	// Accelerate toward the desired velocity instead of snapping to it, so
	// starts and stops have the same weight as practice mode.
	m.Velocity = m.Velocity.MoveTowards(move.Scale(speed), Acceleration*dt).ClampLength(speed)

	if m.Velocity.LengthSq() <= 1e-6 {
		m.Velocity = Vec2{}
		if !m.Charging && m.State != MageRecovering {
			m.State = MageIdle
		}
		return
	}

	m.Position = w.resolveMove(m.Position, m.Velocity.Scale(dt))

	// While charging, Facing is the aim direction (and the throw direction),
	// so movement must not steer it.
	if !m.Charging {
		m.Facing = m.Facing.RotateTowards(m.Velocity.Normalized(), TurnSpeed*dt)
		if m.State != MageRecovering {
			m.State = MageMoving
		}
	}
}

// separateMages pushes overlapping mages apart so they don't stack on one
// tile, mirroring MovementSystem.resolvePlayerSpacing.
func (w *World) separateMages() {
	mages := make([]*Mage, 0, len(w.Mages))
	for _, m := range w.Mages {
		if m.Alive {
			mages = append(mages, m)
		}
	}
	// Map iteration order is random; sort so the resolution is deterministic
	// across ticks and across servers replaying the same inputs.
	sort.Slice(mages, func(i, j int) bool { return mages[i].ID < mages[j].ID })

	minDist := math.Max(2*MageRadius, Spacing)
	for i := 0; i < len(mages); i++ {
		for j := i + 1; j < len(mages); j++ {
			a, b := mages[i], mages[j]
			delta := a.Position.Sub(b.Position)
			distSq := delta.LengthSq()
			if distSq >= minDist*minDist {
				continue
			}
			if distSq <= 1e-12 {
				a.Position.X -= minDist / 2
				b.Position.X += minDist / 2
				continue
			}
			dist := math.Sqrt(distSq)
			push := (minDist - dist) / 2
			n := delta.Scale(1 / dist)
			a.Position = w.Arena.Clamp(a.Position.Add(n.Scale(push)), MageRadius)
			b.Position = w.Arena.Clamp(b.Position.Sub(n.Scale(push)), MageRadius)
		}
	}
}

// resolveMove applies a movement step against arena bounds and obstacles,
// sliding along a blocker instead of sticking to it: if the combined step is
// blocked, each axis is retried on its own so walking into a wall diagonally
// still slides along it.
func (w *World) resolveMove(from, step Vec2) Vec2 {
	if next := w.Arena.Clamp(from.Add(step), MageRadius); !w.Arena.BlocksMovementAt(next, MageRadius) {
		return next
	}
	if step.X != 0 {
		if next := w.Arena.Clamp(Vec2{X: from.X + step.X, Y: from.Y}, MageRadius); !w.Arena.BlocksMovementAt(next, MageRadius) {
			return next
		}
	}
	if step.Y != 0 {
		if next := w.Arena.Clamp(Vec2{X: from.X, Y: from.Y + step.Y}, MageRadius); !w.Arena.BlocksMovementAt(next, MageRadius) {
			return next
		}
	}
	return from
}

func (w *World) releaseThrow(m *Mage, def ElementDef) {
	charge := m.Charge
	m.Charging = false
	m.Charge = 0
	m.ThrowCooldown = ThrowCooldown
	m.RecoveryTimer = Recovery
	m.State = MageRecovering

	dir := m.Facing
	if dir.LengthSq() < 1e-9 {
		dir = Vec2{X: facingSignForTeam(m.Team)}
	}

	speed := def.MinSpeed + (def.ProjectileSpeed-def.MinSpeed)*charge
	w.nextID++
	id := fmt.Sprintf("proj-%d", w.nextID)
	w.Projectiles[id] = &Projectile{
		ID:             id,
		OwnerID:        m.ID,
		Team:           m.Team,
		Element:        def.ID,
		Position:       m.Position.Add(dir.Scale(MageRadius + SpawnMargin)),
		Velocity:       dir.Scale(speed),
		Height:         LaunchHeight,
		HeightVelocity: def.LaunchArc * (0.6 + 0.4*charge),
		Gravity:        def.Gravity,
		Damage:         def.Damage,
		Knockback:      def.Knockback,
		Radius:         def.Radius,
		Alive:          true,
	}
}

func (w *World) updateProjectiles(dt float64) {
	for id, p := range w.Projectiles {
		p.Age += dt
		p.HeightVelocity -= p.Gravity * dt
		p.Height += p.HeightVelocity * dt
		p.Position = p.Position.Add(p.Velocity.Scale(dt))

		if target := w.findProjectileHit(p); target != nil {
			w.applyProjectileHit(p, target)
			delete(w.Projectiles, id)
			continue
		}

		if p.Age > MaxProjectileLifetime || p.Height <= 0 || w.Arena.OutOfBounds(p.Position) ||
			w.Arena.BlocksProjectileAt(p.Position, p.Radius, p.Height) {
			w.onProjectileExpire(p)
			delete(w.Projectiles, id)
		}
	}
}

func (w *World) findProjectileHit(p *Projectile) *Mage {
	for _, m := range w.Mages {
		if !m.Alive || m.ID == p.OwnerID || m.Team == p.Team || m.ImmunityTimer > 0 {
			continue
		}
		if m.Position.DistanceTo(p.Position) <= MageRadius+p.Radius {
			return m
		}
	}
	return nil
}

func (w *World) applyProjectileHit(p *Projectile, target *Mage) {
	def, _ := ElementDefFor(p.Element)

	dir := target.Position.Sub(p.Position)
	if dir.LengthSq() < 1e-9 {
		dir = p.Velocity
	}

	knock := p.Knockback + def.KnockbackBonus
	w.dealDamage(target, p.Damage, dir, knock)

	if def.SlowFactor > 0 {
		target.SlowFactor = def.SlowFactor
		target.SlowTimer = def.SlowDuration
	}
	if def.InterruptsCharge && target.Charging {
		target.Charging = false
		target.Charge = 0
	}
	if def.SpawnsPuddle {
		w.spawnPuddle(p.OwnerID, target.Position, def)
	}
	if def.SplashRadius > 0 {
		w.applySplash(p, target, def)
	}
}

// applySplash deals reduced splash damage to nearby enemies (arcane, GDD
// §8.7), excluding the mage that already took the direct hit.
func (w *World) applySplash(p *Projectile, primary *Mage, def ElementDef) {
	for _, m := range w.Mages {
		if m == primary || !m.Alive || m.Team == p.Team || m.ImmunityTimer > 0 {
			continue
		}
		if m.Position.DistanceTo(p.Position) <= def.SplashRadius {
			dir := m.Position.Sub(p.Position)
			w.dealDamage(m, def.Damage*0.5, dir, def.Knockback*0.5)
		}
	}
}

func (w *World) onProjectileExpire(p *Projectile) {
	def, _ := ElementDefFor(p.Element)
	if def.SpawnsPuddle {
		// Negation-of-space: a poison flask that never hits a mage still
		// contaminates the ground where it lands (GDD §8.5).
		w.spawnPuddle(p.OwnerID, p.Position, def)
	}
}

func (w *World) spawnPuddle(ownerID string, pos Vec2, def ElementDef) {
	w.nextID++
	id := fmt.Sprintf("puddle-%d", w.nextID)
	w.Puddles[id] = &Puddle{
		ID:           id,
		OwnerID:      ownerID,
		Position:     pos,
		Radius:       def.PuddleRadius,
		Duration:     def.PuddleDuration,
		TickInterval: def.PuddleTickInterval,
		TickDamage:   def.PuddleTickDamage,
		Alive:        true,
	}
}

func (w *World) updatePuddles(dt float64) {
	for id, pu := range w.Puddles {
		pu.Elapsed += dt
		pu.tickTimer += dt

		if pu.tickTimer >= pu.TickInterval {
			pu.tickTimer -= pu.TickInterval
			// Ground effects hurt everyone overlapping them, including the
			// caster's own team — an intentional anti-camp rule (GDD §8.5).
			for _, m := range w.Mages {
				if !m.Alive || m.ImmunityTimer > 0 {
					continue
				}
				if m.Position.DistanceTo(pu.Position) <= pu.Radius+MageRadius {
					w.dealDamage(m, pu.TickDamage, Vec2{}, 0)
				}
			}
		}

		if pu.Elapsed >= pu.Duration {
			delete(w.Puddles, id)
		}
	}
}

// dealDamage is the single seam all damage sources (projectiles, puddles)
// funnel through, so death/respawn/lives stay consistent everywhere.
func (w *World) dealDamage(m *Mage, amount float64, knockDir Vec2, knockMag float64) {
	if !m.Alive || m.ImmunityTimer > 0 {
		return
	}

	m.Health -= amount
	if knockMag > 0 {
		if n := knockDir.Normalized(); n.LengthSq() > 0 {
			// Additive initial velocity, decayed over the stun window in
			// updateMage — not an instant teleport (see KnockbackDamping).
			m.KnockbackVelocity = m.KnockbackVelocity.Add(n.Scale(knockMag))
		}
	}
	m.StunTimer = HitStun

	if m.Health <= 0 {
		w.kill(m)
	}
}

func (w *World) kill(m *Mage) {
	m.Health = 0
	m.Alive = false
	m.Charging = false
	m.Charge = 0
	m.KnockbackVelocity = Vec2{}
	m.Velocity = Vec2{}
	m.State = MageDead
	m.Lives--

	if m.Lives > 0 {
		m.RespawnTimer = RespawnDelay
	} else {
		m.RespawnTimer = 0
	}
}

func (w *World) respawn(m *Mage) {
	m.Position = w.Arena.SpawnFor(m.Team, 0)
	m.Velocity = Vec2{}
	m.Health = m.MaxHealth
	m.Alive = true
	m.State = MageIdle
	m.ImmunityTimer = RespawnImmunity
	m.Charge = 0
	m.Charging = false
	m.StunTimer = 0
	m.SlowFactor = 0
	m.SlowTimer = 0
}

// checkRoundEnd implements the win condition from GDD §2/§15: a team loses
// once every one of its mages is permanently out (dead with no lives left).
func (w *World) checkRoundEnd() {
	if w.RoundOver || len(w.Mages) == 0 {
		return
	}
	// Only evaluate the win condition once both teams have actually been
	// populated — otherwise a team that was never added (e.g. a one-sided
	// test world, or a room still filling its second team) would look
	// "eliminated" from tick one.
	if w.teamCounts[TeamA] == 0 || w.teamCounts[TeamB] == 0 {
		return
	}

	aLeft, bLeft := 0, 0
	for _, m := range w.Mages {
		if m.IsOut() {
			continue
		}
		if m.Team == TeamA {
			aLeft++
		} else {
			bLeft++
		}
	}

	switch {
	case aLeft == 0 && bLeft == 0:
		return
	case aLeft == 0:
		w.endRound(TeamB)
	case bLeft == 0:
		w.endRound(TeamA)
	}
}

func (w *World) endRound(winner Team) {
	w.RoundOver = true
	w.Winner = &winner
}

func decay(timer, dt float64) float64 {
	timer -= dt
	if timer < 0 {
		return 0
	}
	return timer
}

func facingSignForTeam(t Team) float64 {
	if t == TeamB {
		return -1
	}
	return 1
}

