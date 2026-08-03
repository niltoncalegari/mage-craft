package game

import "math"

// Vec2 is a simple 2D vector used for positions, velocities and directions.
type Vec2 struct {
	X, Y float64
}

func (v Vec2) Add(o Vec2) Vec2      { return Vec2{v.X + o.X, v.Y + o.Y} }
func (v Vec2) Sub(o Vec2) Vec2      { return Vec2{v.X - o.X, v.Y - o.Y} }
func (v Vec2) Scale(s float64) Vec2 { return Vec2{v.X * s, v.Y * s} }

func (v Vec2) LengthSq() float64 { return v.X*v.X + v.Y*v.Y }
func (v Vec2) Length() float64   { return math.Sqrt(v.LengthSq()) }

func (v Vec2) DistanceTo(o Vec2) float64 { return v.Sub(o).Length() }

// Normalized returns a unit vector in the same direction, or the zero vector
// if v is (near) zero-length.
func (v Vec2) Normalized() Vec2 {
	l := v.Length()
	if l < 1e-9 {
		return Vec2{}
	}
	return Vec2{v.X / l, v.Y / l}
}

// Dot returns the dot product of v and o.
func (v Vec2) Dot(o Vec2) float64 { return v.X*o.X + v.Y*o.Y }

// ClampLength shortens v to at most max, leaving shorter vectors untouched.
func (v Vec2) ClampLength(max float64) Vec2 {
	if l := v.Length(); l > max && l > 1e-9 {
		return Vec2{v.X / l * max, v.Y / l * max}
	}
	return v
}

// MoveTowards steps v toward target by at most maxDelta (mirrors the client's
// utils/math moveTowards, applied per-component the same way MovementSystem
// does when accelerating).
func (v Vec2) MoveTowards(target Vec2, maxDelta float64) Vec2 {
	return Vec2{
		X: moveTowards(v.X, target.X, maxDelta),
		Y: moveTowards(v.Y, target.Y, maxDelta),
	}
}

func moveTowards(current, target, maxDelta float64) float64 {
	delta := target - current
	if math.Abs(delta) <= maxDelta {
		return target
	}
	if delta > 0 {
		return current + maxDelta
	}
	return current - maxDelta
}

// RotateTowards turns the unit vector v toward target by at most maxRadians
// (mirrors the client's utils/math rotateTowards, which the mage uses to turn
// its body/aim smoothly rather than snapping).
func (v Vec2) RotateTowards(target Vec2, maxRadians float64) Vec2 {
	if v.LengthSq() < 1e-9 {
		return target
	}
	if target.LengthSq() < 1e-9 {
		return v
	}

	from := math.Atan2(v.Y, v.X)
	to := math.Atan2(target.Y, target.X)
	delta := math.Mod(to-from+3*math.Pi, 2*math.Pi) - math.Pi
	if math.Abs(delta) <= maxRadians {
		return target.Normalized()
	}
	if delta > 0 {
		from += maxRadians
	} else {
		from -= maxRadians
	}
	return Vec2{X: math.Cos(from), Y: math.Sin(from)}
}
