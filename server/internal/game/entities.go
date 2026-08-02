package game

// Team identifies one of the two sides in a room (GDD §5, §7).
type Team int

const (
	TeamA Team = 0
	TeamB Team = 1
)

// Opponent returns the other team.
func (t Team) Opponent() Team {
	if t == TeamA {
		return TeamB
	}
	return TeamA
}

// MageState mirrors the client's finite state machine (design.md §10),
// simplified for the v1 authoritative simulation (no obstacles/cover yet).
type MageState string

const (
	MageIdle       MageState = "idle"
	MageMoving     MageState = "moving"
	MageCharging   MageState = "charging"
	MageRecovering MageState = "recovering"
	MageStunned    MageState = "stunned"
	MageDead       MageState = "dead"
)

// MageInput is the latest input command received for a mage, applied at the
// start of each simulation tick (GDD §6).
type MageInput struct {
	Move     Vec2 // desired movement direction; magnitude clamped to 1
	Aim      Vec2 // world-space aim point
	Charging bool
	Release  bool
}

// Mage is a controllable unit, human or bot-owned (GDD §5, §7).
type Mage struct {
	ID      string
	Team    Team
	IsBot   bool
	Element ElementID

	Position Vec2
	Facing   Vec2

	Health    float64
	MaxHealth float64
	Alive     bool
	Lives     int

	State MageState

	Charge        float64 // 0..1
	Charging      bool
	ThrowCooldown float64
	RecoveryTimer float64

	StunTimer float64

	SlowFactor float64
	SlowTimer  float64

	ImmunityTimer float64
	RespawnTimer  float64

	Input MageInput
}

// IsOut reports whether the mage is permanently gone for the rest of the
// round (dead with no lives left to respawn).
func (m *Mage) IsOut() bool {
	return !m.Alive && m.Lives <= 0
}

// Projectile is a flying conjuration spawned by a mage's throw (GDD §8).
type Projectile struct {
	ID      string
	OwnerID string
	Team    Team
	Element ElementID

	Position Vec2
	Velocity Vec2

	Height         float64
	HeightVelocity float64
	Gravity        float64

	Damage    float64
	Knockback float64
	Radius    float64

	Age   float64
	Alive bool
}

// Puddle is a ground effect zone spawned by poison (GDD §8.5). It hurts
// everyone who overlaps it, including its caster's team, by design.
type Puddle struct {
	ID      string
	OwnerID string

	Position Vec2
	Radius   float64

	Duration     float64
	Elapsed      float64
	TickInterval float64
	TickDamage   float64
	tickTimer    float64

	Alive bool
}
