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

	// The arena is loaded from map JSON (see arena.go / DefaultMapName), not
	// hardcoded — its size and obstacles come from the same file the client
	// renders.

	MageRadius = 0.5
	MaxHealth  = 100.0
	MoveSpeed  = 6.0 // world units/sec
	// Acceleration/TurnSpeed/AimTurnSpeed/Spacing mirror the client's
	// PLAYER.acceleration / PLAYER.turnSpeed / AIM.turnSpeed / PLAYER.spacing
	// so online movement has the same weight and turn feel as practice mode.
	Acceleration = 40.0 // world units/sec^2
	TurnSpeed    = 12.0 // radians/sec, body turning to face movement
	AimTurnSpeed = 15.0 // radians/sec, turning toward the aim point while charging
	AimDeadzone  = 1.2  // aim points closer than this leave facing untouched
	Spacing      = 1.4  // desired separation between mages

	ChargeTime    = 1.5 // seconds to reach full charge
	Windup        = 0.18
	Recovery      = 0.25
	ThrowCooldown = 0.6

	LaunchHeight          = 1.0
	SpawnMargin           = 0.6
	MaxProjectileLifetime = 5.0

	HitStun = 0.35
	// KnockbackDamping/KnockbackStopSpeed mirror the client's DamageSystem.ts:
	// a hit sets an initial knockback velocity that decays exponentially over
	// the hit-stun window, rather than teleporting the mage instantly.
	KnockbackDamping   = 12.0
	KnockbackStopSpeed = 0.02

	RespawnDelay    = 1.0
	RespawnImmunity = 5.0
	DefaultLives    = 3

	// PuddleMaxActivePerTeam caps ground zones so the arena doesn't get
	// cluttered (GDD §8.5).
	PuddleMaxActivePerTeam = 4
)
