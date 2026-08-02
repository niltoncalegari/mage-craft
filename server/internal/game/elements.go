package game

// ElementID identifies one of the catalog's elemental projectiles (GDD §8).
type ElementID string

const (
	ElementFire      ElementID = "fire"
	ElementIce       ElementID = "ice"
	ElementLightning ElementID = "lightning"
	ElementPoison    ElementID = "poison"
	ElementStone     ElementID = "stone"
	ElementArcane    ElementID = "arcane"
	ElementWind      ElementID = "wind"
)

// ElementDef holds the design-direction numbers for one element (GDD §8; not
// final balance constants). Every projectile uses the same pipeline —
// charge -> windup -> spawn -> flight -> hit/expire — and only the data
// differs between elements.
type ElementDef struct {
	ID   ElementID
	Name string

	// Flight (charge-scaled between MinSpeed and ProjectileSpeed).
	MinSpeed        float64
	ProjectileSpeed float64
	LaunchArc       float64
	Gravity         float64
	Radius          float64

	// On-hit baseline.
	Damage    float64
	Knockback float64

	// Ice: soft crowd control (GDD §8.3).
	SlowFactor   float64
	SlowDuration float64

	// Stone: heavy hit that cancels the target's charge (GDD §8.6).
	InterruptsCharge bool

	// Arcane: small on-impact AoE (GDD §8.7).
	SplashRadius float64

	// Wind: extra knockback, minimal damage (GDD §8.7).
	KnockbackBonus float64

	// Poison: spawns a damaging ground puddle on hit or expiry (GDD §8.5).
	SpawnsPuddle       bool
	PuddleRadius       float64
	PuddleDuration     float64
	PuddleTickInterval float64
	PuddleTickDamage   float64
}

// elementCatalog is the single source of truth for element data, keyed by ID.
var elementCatalog = map[ElementID]ElementDef{
	ElementFire: {
		ID: ElementFire, Name: "Bola de fogo",
		MinSpeed: 8, ProjectileSpeed: 20, LaunchArc: 4.5, Gravity: 18, Radius: 0.22,
		Damage: 20, Knockback: 3.5,
	},
	ElementIce: {
		ID: ElementIce, Name: "Fragmento de gelo",
		MinSpeed: 7, ProjectileSpeed: 17, LaunchArc: 4.2, Gravity: 18, Radius: 0.22,
		Damage: 14, Knockback: 2.5,
		SlowFactor: 0.35, SlowDuration: 1.25,
	},
	ElementLightning: {
		ID: ElementLightning, Name: "Raio",
		MinSpeed: 14, ProjectileSpeed: 30, LaunchArc: 1.5, Gravity: 10, Radius: 0.2,
		Damage: 18, Knockback: 1.5,
	},
	ElementPoison: {
		ID: ElementPoison, Name: "Frasco de veneno",
		MinSpeed: 8, ProjectileSpeed: 18, LaunchArc: 4.0, Gravity: 18, Radius: 0.24,
		Damage: 8, Knockback: 1.0,
		SpawnsPuddle: true, PuddleRadius: 1.5, PuddleDuration: 4.0,
		PuddleTickInterval: 0.3, PuddleTickDamage: 6,
	},
	ElementStone: {
		ID: ElementStone, Name: "Projétil de pedra",
		MinSpeed: 5, ProjectileSpeed: 13, LaunchArc: 5.5, Gravity: 18, Radius: 0.3,
		Damage: 32, Knockback: 6.0,
		InterruptsCharge: true,
	},
	ElementArcane: {
		ID: ElementArcane, Name: "Orbe arcano",
		MinSpeed: 8, ProjectileSpeed: 19, LaunchArc: 4.3, Gravity: 18, Radius: 0.24,
		Damage: 20, Knockback: 3.0,
		SplashRadius: 2.0,
	},
	ElementWind: {
		ID: ElementWind, Name: "Lâmina de vento",
		MinSpeed: 10, ProjectileSpeed: 22, LaunchArc: 3.0, Gravity: 14, Radius: 0.2,
		Damage: 6, Knockback: 4.0,
		KnockbackBonus: 4.5,
	},
}

// elementOrder fixes iteration/display order for the catalog (GDD §8.1).
var elementOrder = []ElementID{
	ElementFire, ElementIce, ElementLightning, ElementPoison, ElementStone, ElementArcane, ElementWind,
}

// AllElements returns the full 7-element catalog, in GDD §8.1 order. Room
// selection (GDD §7 — Sala pré-jogo e times) uses all 7 so a team of up to 6
// mages always has a free element, even though arcane/wind are still
// post-MVP for combat balancing.
func AllElements() []ElementID {
	out := make([]ElementID, len(elementOrder))
	copy(out, elementOrder)
	return out
}

// ElementDefFor looks up the design data for an element id.
func ElementDefFor(id ElementID) (ElementDef, bool) {
	def, ok := elementCatalog[id]
	return def, ok
}
