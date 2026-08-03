package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

// DefaultMapName is the map both simulations play on. The client fetches
// public/maps/<DefaultMapName> over HTTP; the server embeds its own copy under
// maps/ (Go can only embed files at or below the package directory). The two
// files must stay byte-identical — TestEmbeddedMapMatchesClientCopy in
// arena_test.go fails the build if they drift.
const DefaultMapName = "arena1.json"

//go:embed maps/arena1.json
var defaultMapJSON []byte

// ObstacleType mirrors the client's ObstacleType (src/game/types.ts).
type ObstacleType string

const (
	ObstacleTree  ObstacleType = "tree"
	ObstacleRock  ObstacleType = "rock"
	ObstacleFort  ObstacleType = "fort"
	ObstacleFence ObstacleType = "fence"
	ObstacleProp  ObstacleType = "prop"
)

// obstacleTemplate mirrors src/game/Obstacle.ts's TEMPLATES: the default
// gameplay footprint and blocking flags per obstacle type. Heights mirror
// src/game/config.ts's OBSTACLE_HEIGHT — a projectile arcing above an
// obstacle's height flies over it instead of being stopped.
type obstacleTemplate struct {
	IsRect            bool
	Radius            float64
	Width             float64
	Height            float64
	BlocksSight       bool
	BlocksProjectiles bool
	BlocksMovement    bool
	TopHeight         float64
}

var obstacleTemplates = map[ObstacleType]obstacleTemplate{
	ObstacleTree:  {Radius: 0.35, BlocksSight: true, BlocksProjectiles: true, BlocksMovement: true, TopHeight: 2.4},
	ObstacleRock:  {Radius: 0.6, BlocksSight: true, BlocksProjectiles: true, BlocksMovement: true, TopHeight: 1.0},
	ObstacleFort:  {IsRect: true, Width: 2.4, Height: 1.2, BlocksSight: true, BlocksProjectiles: true, BlocksMovement: true, TopHeight: 1.3},
	ObstacleFence: {IsRect: true, Width: 2, Height: 0.24, BlocksProjectiles: true, BlocksMovement: true, TopHeight: 0.85},
	ObstacleProp:  {Radius: 0.3, TopHeight: 0.9},
}

// Obstacle is a simulation-ready arena object. Circles use Radius; rectangles
// (axis-aligned, centered on Position) use HalfW/HalfH.
type Obstacle struct {
	Type     ObstacleType
	Position Vec2

	IsRect bool
	Radius float64
	HalfW  float64
	HalfH  float64

	BlocksSight       bool
	BlocksProjectiles bool
	BlocksMovement    bool
	TopHeight         float64
}

// SpawnPoint is a per-team starting position loaded from the map.
type SpawnPoint struct {
	Team Team
	Pos  Vec2
}

// Arena is the loaded, simulation-ready play space (mirrors the client's
// Arena in src/game/types.ts).
type Arena struct {
	Width     float64
	Height    float64
	Obstacles []Obstacle
	Spawns    []SpawnPoint
}

/* ---- JSON map schema (mirrors src/game/types.ts MapData) ----------------- */

type mapObjectData struct {
	Type   ObstacleType `json:"type"`
	X      float64      `json:"x"`
	Y      float64      `json:"y"`
	Radius *float64     `json:"radius"`
	Width  *float64     `json:"width"`
	Height *float64     `json:"height"`
}

type mapSpawnData struct {
	Team string  `json:"team"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type mapData struct {
	Name    string          `json:"name"`
	Width   float64         `json:"width"`
	Height  float64         `json:"height"`
	Objects []mapObjectData `json:"objects"`
	Spawns  []mapSpawnData  `json:"spawns"`
}

// DefaultArena returns the arena every online match is played on.
func DefaultArena() Arena {
	a, err := ParseArena(defaultMapJSON)
	if err != nil {
		// The map is embedded at build time, so a parse failure here is a
		// programming error, not a runtime condition.
		panic(fmt.Sprintf("game: embedded map %s is invalid: %v", DefaultMapName, err))
	}
	return a
}

// ParseArena builds an Arena from map JSON in the client's schema.
func ParseArena(raw []byte) (Arena, error) {
	var data mapData
	if err := json.Unmarshal(raw, &data); err != nil {
		return Arena{}, err
	}
	if data.Width <= 0 || data.Height <= 0 {
		return Arena{}, fmt.Errorf("map has non-positive size %.1fx%.1f", data.Width, data.Height)
	}

	arena := Arena{Width: data.Width, Height: data.Height}
	for _, obj := range data.Objects {
		tpl, ok := obstacleTemplates[obj.Type]
		if !ok {
			return Arena{}, fmt.Errorf("unknown obstacle type %q", obj.Type)
		}
		o := Obstacle{
			Type:              obj.Type,
			Position:          Vec2{X: obj.X, Y: obj.Y},
			IsRect:            tpl.IsRect,
			BlocksSight:       tpl.BlocksSight,
			BlocksProjectiles: tpl.BlocksProjectiles,
			BlocksMovement:    tpl.BlocksMovement,
			TopHeight:         tpl.TopHeight,
		}
		if tpl.IsRect {
			w, h := tpl.Width, tpl.Height
			if obj.Width != nil {
				w = *obj.Width
			}
			if obj.Height != nil {
				h = *obj.Height
			}
			o.HalfW, o.HalfH = w/2, h/2
		} else {
			r := tpl.Radius
			if obj.Radius != nil {
				r = *obj.Radius
			}
			o.Radius = r
		}
		arena.Obstacles = append(arena.Obstacles, o)
	}

	for _, s := range data.Spawns {
		team := TeamA
		if s.Team == "enemy" {
			team = TeamB
		}
		arena.Spawns = append(arena.Spawns, SpawnPoint{Team: team, Pos: Vec2{X: s.X, Y: s.Y}})
	}
	return arena, nil
}

// SpawnFor returns the idx-th spawn point for a team, falling back to a
// generated position along that team's back line when the map defines fewer
// spawns than the room has seats.
func (a Arena) SpawnFor(team Team, idx int) Vec2 {
	var nth int
	for _, s := range a.Spawns {
		if s.Team != team {
			continue
		}
		if nth == idx {
			return s.Pos
		}
		nth++
	}

	// More seats than the map defines spawns for: spread the rest along the
	// team's back line, wrapping so any idx stays inside the arena, and skip
	// lanes that would drop a mage inside an obstacle.
	x := -a.Width/2 + 4
	if team == TeamB {
		x = a.Width/2 - 4
	}

	const lanes = 6
	for attempt := 0; attempt < lanes; attempt++ {
		lane := (idx + attempt) % lanes
		y := (float64(lane) - (lanes-1)/2.0) * (a.Height / (lanes + 2))
		pos := a.Clamp(Vec2{X: x, Y: y}, MageRadius)
		if !a.BlocksMovementAt(pos, MageRadius) {
			return pos
		}
	}
	return a.Clamp(Vec2{X: x}, MageRadius)
}

// Contains reports whether a circle of the given radius fits inside the arena
// bounds.
func (a Arena) Contains(p Vec2, radius float64) bool {
	halfW := a.Width/2 - radius
	halfH := a.Height/2 - radius
	return p.X >= -halfW && p.X <= halfW && p.Y >= -halfH && p.Y <= halfH
}

// Clamp keeps a circle of the given radius inside the arena bounds.
func (a Arena) Clamp(p Vec2, radius float64) Vec2 {
	halfW := a.Width/2 - radius
	halfH := a.Height/2 - radius
	if p.X > halfW {
		p.X = halfW
	} else if p.X < -halfW {
		p.X = -halfW
	}
	if p.Y > halfH {
		p.Y = halfH
	} else if p.Y < -halfH {
		p.Y = -halfH
	}
	return p
}

// OutOfBounds reports whether a point has left the arena rectangle entirely.
func (a Arena) OutOfBounds(p Vec2) bool {
	return p.X < -a.Width/2 || p.X > a.Width/2 || p.Y < -a.Height/2 || p.Y > a.Height/2
}

// BlocksMovementAt reports whether a circle at p would overlap a
// movement-blocking obstacle.
func (a Arena) BlocksMovementAt(p Vec2, radius float64) bool {
	for i := range a.Obstacles {
		o := &a.Obstacles[i]
		if o.BlocksMovement && o.overlapsCircle(p, radius) {
			return true
		}
	}
	return false
}

// BlocksProjectileAt reports whether a projectile of the given radius flying
// at the given height would hit a projectile-blocking obstacle. Shots arcing
// above an obstacle's TopHeight pass over it (mirrors CollisionSystem.ts).
func (a Arena) BlocksProjectileAt(p Vec2, radius, height float64) bool {
	for i := range a.Obstacles {
		o := &a.Obstacles[i]
		if !o.BlocksProjectiles || height > o.TopHeight {
			continue
		}
		if o.overlapsCircle(p, radius) {
			return true
		}
	}
	return false
}

// HasLineOfSight reports whether the segment from → to is unobstructed by any
// sight-blocking obstacle (mirrors src/physics/LineOfSight.ts). Sampled rather
// than solved analytically: obstacles are small relative to the step, and this
// only feeds bot targeting decisions.
func (a Arena) HasLineOfSight(from, to Vec2) bool {
	delta := to.Sub(from)
	dist := delta.Length()
	if dist < 1e-9 {
		return true
	}

	const step = 0.25
	steps := int(dist/step) + 1
	for i := 1; i < steps; i++ {
		t := float64(i) / float64(steps)
		point := Vec2{X: from.X + delta.X*t, Y: from.Y + delta.Y*t}
		for j := range a.Obstacles {
			o := &a.Obstacles[j]
			if o.BlocksSight && o.overlapsCircle(point, 0) {
				return false
			}
		}
	}
	return true
}

// overlapsCircle reports whether a circle at p with the given radius overlaps
// this obstacle's footprint.
func (o *Obstacle) overlapsCircle(p Vec2, radius float64) bool {
	if !o.IsRect {
		r := o.Radius + radius
		return p.Sub(o.Position).LengthSq() <= r*r
	}

	// Closest point on the rectangle to the circle center.
	dx := math.Abs(p.X-o.Position.X) - o.HalfW
	dy := math.Abs(p.Y-o.Position.Y) - o.HalfH
	if dx < 0 {
		dx = 0
	}
	if dy < 0 {
		dy = 0
	}
	return dx*dx+dy*dy <= radius*radius
}
