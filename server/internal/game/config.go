package game

// Central gameplay tuning constants (GDD §8, §14; direction of design, not
// final balance numbers). Mirrors the intent of the client's
// src/game/config.ts so the two simulations stay conceptually aligned even
// though the code isn't shared between TypeScript and Go.
const (
	// SimHz is the fixed simulation rate in Hz.
	SimHz = 60
	// SimDt is the fixed timestep in seconds.
	SimDt = 1.0 / SimHz

	// Arena is a simple open rectangle in v1 (no obstacles/cover yet).
	ArenaWidth  = 24.0
	ArenaHeight = 16.0

	MageRadius = 0.5
	MaxHealth  = 100.0
	MoveSpeed  = 6.0 // world units/sec

	ChargeTime    = 1.5 // seconds to reach full charge
	Windup        = 0.18
	Recovery      = 0.25
	ThrowCooldown = 0.6

	LaunchHeight          = 1.0
	SpawnMargin           = 0.6
	MaxProjectileLifetime = 5.0

	HitStun = 0.35

	RespawnDelay    = 1.0
	RespawnImmunity = 5.0
	DefaultLives    = 3

	// PuddleMaxActivePerTeam caps ground zones so the arena doesn't get
	// cluttered (GDD §8.5).
	PuddleMaxActivePerTeam = 4
)
