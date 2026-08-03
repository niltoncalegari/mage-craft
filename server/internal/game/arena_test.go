package game

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// The server embeds its own copy of the map because go:embed cannot reach
// outside the package directory. This test is what keeps that copy honest: if
// someone edits the client's map without copying it across (or vice versa),
// the two simulations would silently disagree about where the walls are.
func TestEmbeddedMapMatchesClientCopy(t *testing.T) {
	clientPath := filepath.Join("..", "..", "..", "public", "maps", DefaultMapName)
	clientCopy, err := os.ReadFile(clientPath)
	if err != nil {
		t.Fatalf("reading the client's map copy at %s: %v", clientPath, err)
	}

	if !bytes.Equal(bytes.TrimSpace(clientCopy), bytes.TrimSpace(defaultMapJSON)) {
		t.Fatalf("embedded server map maps/%s has drifted from %s — copy the client's file across so both simulations agree on the arena", DefaultMapName, clientPath)
	}
}

func TestDefaultArena_LoadsObstaclesAndSpawns(t *testing.T) {
	a := DefaultArena()

	if a.Width <= 0 || a.Height <= 0 {
		t.Fatalf("expected a sized arena, got %.1fx%.1f", a.Width, a.Height)
	}
	if len(a.Obstacles) == 0 {
		t.Fatal("expected the default map to define obstacles")
	}
	if len(a.Spawns) == 0 {
		t.Fatal("expected the default map to define spawn points")
	}

	var teamA, teamB int
	for _, s := range a.Spawns {
		if s.Team == TeamA {
			teamA++
		} else {
			teamB++
		}
	}
	if teamA == 0 || teamB == 0 {
		t.Errorf("expected spawns for both teams, got A=%d B=%d", teamA, teamB)
	}
}

func TestArena_SpawnsAreNotInsideObstacles(t *testing.T) {
	a := DefaultArena()

	for _, s := range a.Spawns {
		if a.BlocksMovementAt(s.Pos, MageRadius) {
			t.Errorf("spawn for team %v at %+v is inside an obstacle", s.Team, s.Pos)
		}
		if !a.Contains(s.Pos, MageRadius) {
			t.Errorf("spawn for team %v at %+v is outside the arena bounds", s.Team, s.Pos)
		}
	}
}

func TestArena_SpawnForFallsBackWhenMapRunsOut(t *testing.T) {
	a := DefaultArena()

	// Rooms go up to 6v6 but the map defines fewer spawns per team; the
	// fallback must still land inside the arena.
	pos := a.SpawnFor(TeamA, 99)
	if !a.Contains(pos, MageRadius) {
		t.Errorf("fallback spawn %+v is outside the arena", pos)
	}
}

func TestArena_BlocksMovementInsideAnObstacle(t *testing.T) {
	a := Arena{
		Width:  24,
		Height: 16,
		Obstacles: []Obstacle{
			{Type: ObstacleRock, Position: Vec2{X: 3, Y: 0}, Radius: 0.6, BlocksMovement: true, BlocksSight: true, BlocksProjectiles: true, TopHeight: 1.0},
		},
	}

	if !a.BlocksMovementAt(Vec2{X: 3, Y: 0}, MageRadius) {
		t.Error("expected the rock's center to block movement")
	}
	if a.BlocksMovementAt(Vec2{X: 8, Y: 0}, MageRadius) {
		t.Error("expected open ground away from the rock to be walkable")
	}
}

func TestArena_ProjectilesFlyOverLowObstacles(t *testing.T) {
	a := Arena{
		Width:  24,
		Height: 16,
		Obstacles: []Obstacle{
			{Type: ObstacleFence, Position: Vec2{X: 2, Y: 0}, IsRect: true, HalfW: 2.5, HalfH: 0.12, BlocksProjectiles: true, BlocksMovement: true, TopHeight: 0.85},
		},
	}

	if !a.BlocksProjectileAt(Vec2{X: 2, Y: 0}, 0.2, 0.5) {
		t.Error("expected a low shot to be stopped by the fence")
	}
	if a.BlocksProjectileAt(Vec2{X: 2, Y: 0}, 0.2, 2.0) {
		t.Error("expected a shot arcing above the fence to pass over it")
	}
}

func TestArena_LineOfSightBlockedBySightBlocker(t *testing.T) {
	a := Arena{
		Width:  24,
		Height: 16,
		Obstacles: []Obstacle{
			{Type: ObstacleFort, Position: Vec2{X: 0, Y: 0}, IsRect: true, HalfW: 2.5, HalfH: 0.6, BlocksSight: true, BlocksMovement: true, BlocksProjectiles: true, TopHeight: 1.3},
		},
	}

	if a.HasLineOfSight(Vec2{X: -5, Y: 0}, Vec2{X: 5, Y: 0}) {
		t.Error("expected the fort to block line of sight straight through it")
	}
	if !a.HasLineOfSight(Vec2{X: -5, Y: 6}, Vec2{X: 5, Y: 6}) {
		t.Error("expected a clear line well above the fort to have line of sight")
	}
}

func TestWorld_MageCannotWalkThroughAnObstacle(t *testing.T) {
	w := NewWorldWithArena(Arena{
		Width:  24,
		Height: 16,
		Obstacles: []Obstacle{
			{Type: ObstacleFort, Position: Vec2{X: 2, Y: 0}, IsRect: true, HalfW: 0.6, HalfH: 3, BlocksMovement: true, BlocksSight: true, BlocksProjectiles: true, TopHeight: 1.3},
		},
	})
	m := w.AddMage("p1", TeamA, ElementFire, false)
	m.Position = Vec2{X: 0, Y: 0}

	w.SetInput("p1", MageInput{Move: Vec2{X: 1}})
	stepN(w, 60, SimDt) // walk straight into the wall for a full second

	if m.Position.X > 2-0.6-MageRadius+0.01 {
		t.Errorf("expected the mage to be stopped by the wall, got X=%.3f", m.Position.X)
	}
}

func TestWorld_MageSlidesAlongAWallInsteadOfSticking(t *testing.T) {
	w := NewWorldWithArena(Arena{
		Width:  24,
		Height: 16,
		Obstacles: []Obstacle{
			{Type: ObstacleFort, Position: Vec2{X: 2, Y: 0}, IsRect: true, HalfW: 0.6, HalfH: 3, BlocksMovement: true, BlocksSight: true, BlocksProjectiles: true, TopHeight: 1.3},
		},
	})
	m := w.AddMage("p1", TeamA, ElementFire, false)
	m.Position = Vec2{X: 0, Y: 0}

	// Pushing diagonally into the wall should still make progress along Y.
	w.SetInput("p1", MageInput{Move: Vec2{X: 1, Y: 1}.Normalized()})
	stepN(w, 30, SimDt)

	if m.Position.Y <= 0.5 {
		t.Errorf("expected the mage to slide along the wall in +Y, got Y=%.3f", m.Position.Y)
	}
}
