// Package bot implements a simplified, from-scratch Go bot AI for the
// authoritative server. It follows the spirit of the client's
// src/systems/AISystem.ts utility scoring (retreat / attack / advance /
// wander, easy-normal-hard tuning) but is not a transliteration: there is no
// cover/line-of-sight yet (v1 arena has no obstacles), so the priority chain
// is deliberately smaller.
package bot

import (
	"math"
	"math/rand"

	"mage-craft/server/internal/game"
)

// Difficulty mirrors the client's easy/normal/hard AI tuning (design.md §15,
// AISystem.ts AI_TUNING).
type Difficulty string

const (
	Easy   Difficulty = "easy"
	Normal Difficulty = "normal"
	Hard   Difficulty = "hard"
)

// EngageRange is the distance within which a bot will commit to charging an
// attack rather than closing the distance (mirrors AISystem.ts ENGAGE_RANGE).
const EngageRange = 9.0

// RetreatHealthFraction is the health fraction below which a bot disengages
// (mirrors config.ts AI.retreatHealthFraction).
const RetreatHealthFraction = 0.3

// aimErrorBase is the world-unit aim jitter applied at AimErrorScale=1 and
// maximum engagement distance; it shrinks linearly as the target gets closer.
const aimErrorBase = 0.6

type tuning struct {
	AimErrorScale    float64
	ThrowWillingness float64
	// ReleaseChargeMin is the charge fraction [0,1] at which the bot commits
	// to releasing its throw once it has started charging.
	ReleaseChargeMin float64
}

var tunings = map[Difficulty]tuning{
	Easy:   {AimErrorScale: 3.0, ThrowWillingness: 0.6, ReleaseChargeMin: 0.5},
	Normal: {AimErrorScale: 1.0, ThrowWillingness: 1.0, ReleaseChargeMin: 0.8},
	Hard:   {AimErrorScale: 0.4, ThrowWillingness: 1.0, ReleaseChargeMin: 0.95},
}

func tuningFor(d Difficulty) tuning {
	if t, ok := tunings[d]; ok {
		return t
	}
	return tunings[Normal]
}

// Decide computes the next input command for one bot-controlled mage. It is
// a pure function of world state, so it can run every tick (no per-bot
// decision-interval state needed) — see the Step seam below for how a room's
// simulation loop drives a whole team of bots.
func Decide(w *game.World, bot *game.Mage, difficulty Difficulty, rng *rand.Rand) game.MageInput {
	tune := tuningFor(difficulty)
	target := nearestEnemy(w, bot)

	if bot.Charging {
		return continueOrReleaseCharge(bot, target, tune, rng)
	}

	if target == nil {
		return wander(rng)
	}

	distance := bot.Position.DistanceTo(target.Position)
	healthFrac := 1.0
	if bot.MaxHealth > 0 {
		healthFrac = bot.Health / bot.MaxHealth
	}

	if healthFrac <= RetreatHealthFraction {
		return retreat(bot, target)
	}
	if distance <= EngageRange && bot.ThrowCooldown <= 0 && rng.Float64() < tune.ThrowWillingness {
		return game.MageInput{Aim: aimAt(target, distance, tune, rng), Charging: true}
	}
	return advance(bot, target)
}

// Step drives every listed bot mage one tick: it decides and immediately
// writes the result into the world's input for that mage (the seam
// internal/room uses to animate bot-filled slots each simulation tick).
func Step(w *game.World, bots map[string]Difficulty, rng *rand.Rand) {
	for id, difficulty := range bots {
		mage := w.Mage(id)
		if mage == nil || !mage.Alive {
			continue
		}
		w.SetInput(id, Decide(w, mage, difficulty, rng))
	}
}

func continueOrReleaseCharge(bot *game.Mage, target *game.Mage, tune tuning, rng *rand.Rand) game.MageInput {
	if target == nil {
		// Nothing left worth aiming at — let go now instead of holding
		// the charge forever.
		return game.MageInput{Aim: bot.Position.Add(bot.Facing), Release: true}
	}

	aim := aimAt(target, bot.Position.DistanceTo(target.Position), tune, rng)
	if bot.Charge >= tune.ReleaseChargeMin {
		return game.MageInput{Aim: aim, Release: true}
	}
	return game.MageInput{Aim: aim, Charging: true}
}

func aimAt(target *game.Mage, distance float64, tune tuning, rng *rand.Rand) game.Vec2 {
	errorMag := aimErrorBase * tune.AimErrorScale * clamp01(distance/EngageRange)
	offset := game.Vec2{
		X: (rng.Float64()*2 - 1) * errorMag,
		Y: (rng.Float64()*2 - 1) * errorMag,
	}
	return target.Position.Add(offset)
}

func retreat(bot, target *game.Mage) game.MageInput {
	dir := bot.Position.Sub(target.Position).Normalized()
	if dir.LengthSq() == 0 {
		dir = game.Vec2{X: 1}
	}
	return game.MageInput{Move: dir}
}

func advance(bot, target *game.Mage) game.MageInput {
	return game.MageInput{Move: target.Position.Sub(bot.Position).Normalized()}
}

func wander(rng *rand.Rand) game.MageInput {
	angle := rng.Float64() * 2 * math.Pi
	return game.MageInput{Move: game.Vec2{X: math.Cos(angle), Y: math.Sin(angle)}}
}

func nearestEnemy(w *game.World, bot *game.Mage) *game.Mage {
	var nearest *game.Mage
	bestDistSq := math.Inf(1)

	for _, m := range w.Mages {
		if m.Team == bot.Team || !m.Alive {
			continue
		}
		if d := bot.Position.Sub(m.Position).LengthSq(); d < bestDistSq {
			bestDistSq = d
			nearest = m
		}
	}
	return nearest
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
