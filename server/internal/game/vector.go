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
