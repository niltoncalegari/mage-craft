// Package bot implements the authoritative server's bot AI. It is a port of
// the client's src/systems/AISystem.ts utility-scored squad AI — the same
// action set (retreat / takeCover / attack / advance / wander plus reactive
// dodging), the same scoring weights, the same easy/normal/hard tuning, and
// the same cover/peek/line-of-sight behavior now that the Go arena loads the
// real map (see game/arena.go). Practice mode and online matches should feel
// like the same opponent.
package bot

import (
	"math"
	"math/rand"
	"sort"

	"mage-craft/server/internal/game"
)

// Difficulty mirrors the client's easy/normal/hard AI tuning (AISystem.ts
// AI_TUNING).
type Difficulty string

const (
	Easy   Difficulty = "easy"
	Normal Difficulty = "normal"
	Hard   Difficulty = "hard"
)

// Tuning constants ported 1:1 from AISystem.ts.
const (
	EngageRange         = 9.0
	MinThrowRange       = 1.5
	AimLeadTime         = 0.18
	AimErrorNear        = 0.1
	AimErrorFar         = 0.46
	AdvanceStopDistance = 6.5
	MoveStep            = 4.0
	StrafeDistance      = 3.0
	RetreatDistance     = 5.0
	DodgeDuration       = 0.22
	DodgeDistance       = 2.4
	DodgeRadius         = 3.5 // config.ts AI.dodgeRadius
	DecisionInterval    = 0.25
	// RetreatHealthFraction mirrors config.ts AI.retreatHealthFraction.
	RetreatHealthFraction = 0.3
	epsilon               = 1e-9
)

type action int

const (
	actionWander action = iota
	actionAdvance
	actionTakeCover
	actionRetreat
	actionAttack
)

type tuning struct {
	AimErrorScale         float64
	DecisionIntervalScale float64
	ThrowWillingness      float64
	DodgeReliability      float64
	// SeeksCover false means the unit never ducks behind obstacles or
	// retreats — it stays exposed (easy difficulty).
	SeeksCover bool
	// ReleaseChargeMin is the charge fraction at which a bot lets go. The
	// client's AI throws through ThrowSystem in one call; the server's mages
	// must hold and release over several ticks, so this is the one piece of
	// tuning with no direct AISystem.ts counterpart.
	ReleaseChargeMin float64
}

var tunings = map[Difficulty]tuning{
	Easy:   {AimErrorScale: 4.5, DecisionIntervalScale: 2.2, ThrowWillingness: 0.55, DodgeReliability: 0.25, SeeksCover: false, ReleaseChargeMin: 0.5},
	Normal: {AimErrorScale: 1.0, DecisionIntervalScale: 1.0, ThrowWillingness: 1.0, DodgeReliability: 1.0, SeeksCover: true, ReleaseChargeMin: 0.8},
	Hard:   {AimErrorScale: 0.55, DecisionIntervalScale: 0.7, ThrowWillingness: 1.08, DodgeReliability: 1.0, SeeksCover: true, ReleaseChargeMin: 0.95},
}

func tuningFor(d Difficulty) tuning {
	if t, ok := tunings[d]; ok {
		return t
	}
	return tunings[Normal]
}

type decision struct {
	action   action
	targetID string
}

type botState struct {
	decisionTimer float64
	dodgeTimer    float64
	last          decision
	// dodgeDir is held for DodgeDuration so a sidestep commits instead of
	// being re-rolled every tick (the client holds a dodge move target the
	// same way).
	dodgeDir game.Vec2
}

// Brain holds the per-bot state the client's AISystem keeps in its
// decisionTimers/decisions/dodgeTimers maps. One Brain drives all bots in a
// match; the room's session owns it.
type Brain struct {
	states map[string]*botState
	rng    *rand.Rand
}

func NewBrain(rng *rand.Rand) *Brain {
	return &Brain{states: make(map[string]*botState), rng: rng}
}

func (b *Brain) state(id string) *botState {
	if s, ok := b.states[id]; ok {
		return s
	}
	s := &botState{}
	b.states[id] = s
	return s
}

// Step drives every listed bot mage one tick: it decides and writes the
// result into the world's input for that mage.
func (b *Brain) Step(w *game.World, bots map[string]Difficulty, dt float64) {
	focus := b.chooseFocusTarget(w, bots)
	for id, difficulty := range bots {
		mage := w.Mage(id)
		if mage == nil || !mage.Alive {
			continue
		}
		w.SetInput(id, b.decide(w, mage, difficulty, dt, focus))
	}
}

// decide computes the next input for one bot, mirroring AISystem.update's
// order: reactive dodge first, then a utility decision refreshed on an
// interval, then execution of that decision.
func (b *Brain) decide(w *game.World, bot *game.Mage, difficulty Difficulty, dt float64, focus map[game.Team]string) game.MageInput {
	tune := tuningFor(difficulty)
	st := b.state(bot.ID)

	// A charge already in flight is finished or released independently of the
	// movement decision below — the two are separate in the client too.
	var input game.MageInput
	charging := bot.Charging
	if charging {
		input = b.continueOrReleaseCharge(w, bot, tune)
	}

	if dodge, ok := b.reactiveDodge(w, bot, tune, dt, st); ok {
		input.Move = dodge
		return input
	}

	p := b.perceive(w, bot, focus)

	st.decisionTimer -= dt
	if st.decisionTimer <= 0 {
		st.last = b.chooseDecision(bot, p, tune)
		st.decisionTimer = DecisionInterval * tune.DecisionIntervalScale
	}

	move, attack := b.execute(w, bot, st.last, p, tune)
	input.Move = move
	if !charging && attack != nil {
		input.Aim = *attack
		input.Charging = true
	}
	return input
}

/* ---- perception --------------------------------------------------------- */

type perception struct {
	target   *game.Mage
	distance float64
	hasLos   bool
	// exposed reports whether any living enemy can see this bot.
	exposed bool
}

func (b *Brain) perceive(w *game.World, bot *game.Mage, focus map[game.Team]string) perception {
	var nearest *game.Mage
	nearestDistSq := math.Inf(1)
	focusID := focus[bot.Team]
	var focusTarget *game.Mage
	focusDistSq := math.Inf(1)
	focusLos := false
	exposed := false

	for _, m := range w.Mages {
		if m.Team == bot.Team || !m.Alive {
			continue
		}
		distSq := bot.Position.Sub(m.Position).LengthSq()
		if distSq < nearestDistSq {
			nearestDistSq = distSq
			nearest = m
		}
		if !exposed && w.Arena.HasLineOfSight(m.Position, bot.Position) {
			exposed = true
		}
		if m.ID == focusID {
			focusTarget = m
			focusDistSq = distSq
			focusLos = w.Arena.HasLineOfSight(bot.Position, m.Position)
		}
	}

	// Prefer the squad's focus target when it is visible and not much further
	// away than the nearest enemy (AISystem.perceive's 1.8x rule).
	if focusTarget != nil && focusLos && (focusDistSq <= EngageRange*EngageRange || focusDistSq <= nearestDistSq*1.8) {
		nearest = focusTarget
		nearestDistSq = focusDistSq
	}

	if nearest == nil {
		return perception{distance: math.Inf(1)}
	}

	hasLos := focusLos
	if nearest != focusTarget {
		hasLos = w.Arena.HasLineOfSight(bot.Position, nearest.Position)
	}
	return perception{target: nearest, distance: math.Sqrt(nearestDistSq), hasLos: hasLos, exposed: exposed}
}

// chooseFocusTarget picks, per team, the enemy the squad should concentrate
// on: hurt, exposed and close (AISystem.chooseFocusTarget).
func (b *Brain) chooseFocusTarget(w *game.World, bots map[string]Difficulty) map[game.Team]string {
	out := make(map[game.Team]string, 2)
	for _, botID := range sortedKeys(bots) {
		self := w.Mage(botID)
		if self == nil || !self.Alive {
			continue
		}
		if _, done := out[self.Team]; done {
			continue
		}

		var best *game.Mage
		bestScore := math.Inf(-1)
		allies := math.Max(1, float64(countLiving(w, self.Team)))

		for _, targetID := range sortedMageIDs(w) {
			target := w.Mage(targetID)
			if target.Team == self.Team || !target.Alive {
				continue
			}
			visible := 0
			proximity := 0.0
			for _, allyID := range sortedMageIDs(w) {
				ally := w.Mage(allyID)
				if ally.Team != self.Team || !ally.Alive {
					continue
				}
				proximity += 1 - clamp(ally.Position.DistanceTo(target.Position)/(EngageRange*1.5), 0, 1)
				if w.Arena.HasLineOfSight(ally.Position, target.Position) {
					visible++
				}
			}
			if visible == 0 {
				continue
			}
			healthScore := 1.0
			if target.MaxHealth > 0 {
				healthScore = 1 - clamp(target.Health/target.MaxHealth, 0, 1)
			}
			score := healthScore*1.4 + (float64(visible)/allies)*0.75 + proximity*0.35
			if score > bestScore {
				bestScore = score
				best = target
			}
		}
		if best != nil {
			out[self.Team] = best.ID
		}
	}
	return out
}

/* ---- decision ----------------------------------------------------------- */

func (b *Brain) chooseDecision(bot *game.Mage, p perception, tune tuning) decision {
	hasTarget := p.target != nil
	inRange := p.distance <= EngageRange
	cooldownReady := bot.ThrowCooldown <= 0

	healthRisk := 0.0
	if bot.MaxHealth > 0 {
		healthRisk = inverseLerp(bot.MaxHealth*RetreatHealthFraction, bot.MaxHealth*0.05, bot.Health)
	}

	retreat := healthRisk * 0.45
	if p.exposed {
		retreat = healthRisk * 1.1
	}

	takeCover := 0.0
	switch {
	case !hasTarget:
		takeCover = 0
	case !p.exposed && cooldownReady && inRange:
		takeCover = 0.6
	case !p.exposed || (cooldownReady && inRange):
		takeCover = 0
	case cooldownReady:
		takeCover = 0.48
	default:
		takeCover = 0.72
	}

	attack := 0.0
	if p.hasLos && inRange && cooldownReady {
		attack = 0.95
	}

	advance := 0.0
	if hasTarget {
		switch {
		case !inRange:
			advance = 0.62
		case p.hasLos:
			advance = 0.18
		default:
			advance = 0.55
		}
	}

	wander := 0.6
	if hasTarget {
		wander = 0.05
	}

	if !tune.SeeksCover {
		takeCover = 0
		retreat = 0
	}

	// Same precedence as AISystem.bestAction: wander < advance < takeCover <
	// retreat < attack on ties.
	best, score := actionWander, wander
	if advance > score {
		best, score = actionAdvance, advance
	}
	if takeCover > score {
		best, score = actionTakeCover, takeCover
	}
	if retreat > score {
		best, score = actionRetreat, retreat
	}
	if attack > score {
		best = actionAttack
	}

	targetID := ""
	if p.target != nil {
		targetID = p.target.ID
	}
	return decision{action: best, targetID: targetID}
}

// execute turns a decision into a movement direction and (optionally) an aim
// point to start charging at.
func (b *Brain) execute(w *game.World, bot *game.Mage, d decision, p perception, tune tuning) (game.Vec2, *game.Vec2) {
	target := p.target
	if d.targetID != "" {
		if t := w.Mage(d.targetID); t != nil && t.Alive && t.Team != bot.Team {
			target = t
		}
	}
	if target == nil {
		return b.wander(w, bot), nil
	}

	switch d.action {
	case actionRetreat:
		return b.retreat(w, bot, target), nil

	case actionTakeCover:
		distance := bot.Position.DistanceTo(target.Position)
		if bot.ThrowCooldown <= 0 && distance <= EngageRange {
			if w.Arena.HasLineOfSight(bot.Position, target.Position) {
				return game.Vec2{}, b.attackAim(w, bot, target, distance, tune)
			}
			if peek, ok := b.findPeekSpot(w, bot, target); ok {
				return dirTo(bot.Position, peek), nil
			}
		}
		if cover, ok := b.findCoverSpot(w, bot, target); ok {
			return dirTo(bot.Position, cover), nil
		}
		return b.strafe(bot, target), nil

	case actionAttack:
		return game.Vec2{}, b.attackAim(w, bot, target, p.distance, tune)

	case actionAdvance:
		return b.advance(w, bot, target), nil

	default:
		return b.wander(w, bot), nil
	}
}

/* ---- actions ------------------------------------------------------------ */

// attackAim returns the point to charge at, or nil when the bot declines to
// throw this tick (ThrowWillingness).
func (b *Brain) attackAim(w *game.World, bot, target *game.Mage, distance float64, tune tuning) *game.Vec2 {
	if tune.ThrowWillingness < 1 && b.rng.Float64() >= tune.ThrowWillingness {
		return nil
	}

	// Aim error grows with distance, exactly as in AISystem.attack.
	charge01 := clamp(inverseLerp(MinThrowRange, EngageRange, distance)*0.9+0.1, 0.18, 1)
	err := lerp(AimErrorNear, AimErrorFar, charge01) * tune.AimErrorScale
	aim := game.Vec2{
		X: target.Position.X + target.Velocity.X*AimLeadTime + b.rng.Float64()*2*err - err,
		Y: target.Position.Y + target.Velocity.Y*AimLeadTime + b.rng.Float64()*2*err - err,
	}
	return &aim
}

func (b *Brain) continueOrReleaseCharge(w *game.World, bot *game.Mage, tune tuning) game.MageInput {
	target := nearestEnemy(w, bot)
	if target == nil {
		// Nothing worth aiming at — let go rather than holding forever.
		return game.MageInput{Aim: bot.Position.Add(bot.Facing), Release: true}
	}

	distance := bot.Position.DistanceTo(target.Position)
	aim := b.attackAim(w, bot, target, distance, tuning{AimErrorScale: tune.AimErrorScale, ThrowWillingness: 1})
	if bot.Charge >= tune.ReleaseChargeMin {
		return game.MageInput{Aim: *aim, Release: true}
	}
	return game.MageInput{Aim: *aim, Charging: true}
}

func (b *Brain) retreat(w *game.World, bot, target *game.Mage) game.Vec2 {
	if cover, ok := b.findCoverSpot(w, bot, target); ok {
		return dirTo(bot.Position, cover)
	}
	away := bot.Position.Sub(target.Position).Normalized()
	if away.LengthSq() == 0 {
		away = game.Vec2{X: 1}
	}
	return b.steerTo(w, bot, bot.Position.Add(away.Scale(RetreatDistance)))
}

func (b *Brain) advance(w *game.World, bot, target *game.Mage) game.Vec2 {
	toTarget := target.Position.Sub(bot.Position).Normalized()
	if toTarget.LengthSq() == 0 {
		return b.wander(w, bot)
	}

	// Close the gap but stop short, so the bot fights at range rather than
	// walking into its target's face.
	step := math.Min(MoveStep, math.Max(0, bot.Position.DistanceTo(target.Position)-AdvanceStopDistance))
	if step <= 0 {
		step = MoveStep * 0.5
	}
	dest := bot.Position.Add(toTarget.Scale(step)).Add(allySeparation(w, bot))
	return b.steerTo(w, bot, dest)
}

func (b *Brain) strafe(bot, target *game.Mage) game.Vec2 {
	away := bot.Position.Sub(target.Position)
	l := away.Length()
	side := game.Vec2{Y: 1}
	if l > epsilon {
		side = game.Vec2{X: -away.Y / l, Y: away.X / l}
	}
	return side.Scale(idSign(bot.ID))
}

func (b *Brain) wander(w *game.World, bot *game.Mage) game.Vec2 {
	// Drift toward the middle of the arena when idle, with a random bias, so
	// bots without a target don't hug a wall.
	if bot.Position.Length() > game.Spacing {
		return b.steerTo(w, bot, game.Vec2{})
	}
	angle := b.rng.Float64() * 2 * math.Pi
	return game.Vec2{X: math.Cos(angle), Y: math.Sin(angle)}
}

// steerTo returns a unit direction toward dest, nudged sideways when the
// straight line is blocked. The server has no path planner (the client's
// MovementSystem does), so this keeps bots from grinding into obstacles.
func (b *Brain) steerTo(w *game.World, bot *game.Mage, dest game.Vec2) game.Vec2 {
	dir := dirTo(bot.Position, dest)
	if dir.LengthSq() == 0 {
		return game.Vec2{}
	}

	probe := bot.Position.Add(dir.Scale(game.MageRadius * 2))
	if !w.Arena.BlocksMovementAt(probe, game.MageRadius) {
		return dir
	}

	for _, angle := range []float64{math.Pi / 4, -math.Pi / 4, math.Pi / 2, -math.Pi / 2} {
		alt := rotate(dir, angle)
		if !w.Arena.BlocksMovementAt(bot.Position.Add(alt.Scale(game.MageRadius*2)), game.MageRadius) {
			return alt
		}
	}
	return dir
}

/* ---- cover -------------------------------------------------------------- */

// findCoverSpot looks for a standing position that breaks the threat's line of
// sight, mirroring src/physics/LineOfSight.ts findCoverSpot: sample points
// behind each sight-blocking obstacle, relative to the threat.
func (b *Brain) findCoverSpot(w *game.World, bot, threat *game.Mage) (game.Vec2, bool) {
	var best game.Vec2
	bestDist := math.Inf(1)
	found := false

	for i := range w.Arena.Obstacles {
		o := &w.Arena.Obstacles[i]
		if !o.BlocksSight {
			continue
		}

		away := o.Position.Sub(threat.Position).Normalized()
		if away.LengthSq() == 0 {
			continue
		}
		offset := math.Max(o.Radius, math.Max(o.HalfW, o.HalfH)) + game.MageRadius + 0.25
		spot := o.Position.Add(away.Scale(offset))

		if !w.Arena.Contains(spot, game.MageRadius) || w.Arena.BlocksMovementAt(spot, game.MageRadius) {
			continue
		}
		if w.Arena.HasLineOfSight(threat.Position, spot) {
			continue
		}
		if d := bot.Position.DistanceTo(spot); d < bestDist {
			bestDist, best, found = d, spot, true
		}
	}
	return best, found
}

// findPeekSpot looks for a step toward the target that opens a shot, so a bot
// in cover leans out instead of sitting behind the rock forever.
func (b *Brain) findPeekSpot(w *game.World, bot, target *game.Mage) (game.Vec2, bool) {
	dir := target.Position.Sub(bot.Position).Normalized()
	if dir.LengthSq() == 0 {
		return game.Vec2{}, false
	}
	for step := 0.75; step <= 2.25; step += 0.75 {
		spot := bot.Position.Add(dir.Scale(step))
		if !w.Arena.Contains(spot, game.MageRadius) || w.Arena.BlocksMovementAt(spot, game.MageRadius) {
			continue
		}
		if w.Arena.HasLineOfSight(spot, target.Position) {
			return spot, true
		}
	}
	return game.Vec2{}, false
}

/* ---- dodging ------------------------------------------------------------ */

// reactiveDodge mirrors AISystem.tryReactiveDodge: a committed sidestep that
// preempts whatever the bot was doing, held for DodgeDuration.
func (b *Brain) reactiveDodge(w *game.World, bot *game.Mage, tune tuning, dt float64, st *botState) (game.Vec2, bool) {
	if threat := findIncomingThreat(w, bot); threat != nil {
		if b.rng.Float64() >= tune.DodgeReliability {
			return game.Vec2{}, false
		}
		speed := threat.Velocity.Length()
		if speed <= epsilon {
			return game.Vec2{}, false
		}
		dir := threat.Velocity.Scale(1 / speed)
		left := game.Vec2{X: -dir.Y, Y: dir.X}
		right := game.Vec2{X: -left.X, Y: -left.Y}

		foe := nearestEnemy(w, bot)
		chosen := left
		if b.scoreDodgeSide(w, bot, foe, right) > b.scoreDodgeSide(w, bot, foe, left) {
			chosen = right
		}
		st.dodgeDir = chosen
		st.dodgeTimer = DodgeDuration
		return chosen, true
	}

	if st.dodgeTimer > 0 {
		st.dodgeTimer -= dt
		return st.dodgeDir, true
	}
	return game.Vec2{}, false
}

func (b *Brain) scoreDodgeSide(w *game.World, bot, threat *game.Mage, side game.Vec2) float64 {
	dest := bot.Position.Add(side.Scale(DodgeDistance))
	score := 10.0
	if !w.Arena.Contains(dest, game.MageRadius) || w.Arena.BlocksMovementAt(dest, game.MageRadius) {
		score = -10.0
	}
	if threat != nil {
		score += dest.DistanceTo(threat.Position)
	}
	return score
}

// findIncomingThreat finds the nearest hostile, approaching, low-flying
// projectile within DodgeRadius (AISystem.findMostUrgentIncomingSnowball).
func findIncomingThreat(w *game.World, bot *game.Mage) *game.Projectile {
	var best *game.Projectile
	bestDistSq := DodgeRadius * DodgeRadius

	for _, id := range sortedProjectileIDs(w) {
		p := w.Projectiles[id]
		if !p.Alive || p.Team == bot.Team || p.OwnerID == bot.ID || p.Height >= 2 {
			continue
		}
		toBot := bot.Position.Sub(p.Position)
		distSq := toBot.LengthSq()
		if distSq > bestDistSq {
			continue
		}
		if p.Velocity.Dot(toBot) <= 0 {
			continue
		}
		bestDistSq = distSq
		best = p
	}
	return best
}

/* ---- helpers ------------------------------------------------------------ */

// allySeparation biases a bot's destination away from nearby teammates so a
// squad spreads out instead of stacking (AISystem.computeAllySeparation).
func allySeparation(w *game.World, bot *game.Mage) game.Vec2 {
	out := game.Vec2{}
	spacing := game.Spacing * 2

	for _, id := range sortedMageIDs(w) {
		ally := w.Mage(id)
		if ally.ID == bot.ID || ally.Team != bot.Team || !ally.Alive {
			continue
		}
		delta := bot.Position.Sub(ally.Position)
		distSq := delta.LengthSq()
		if distSq <= epsilon || distSq >= spacing*spacing {
			continue
		}
		dist := math.Sqrt(distSq)
		strength := (spacing - dist) / spacing
		out = out.Add(delta.Scale(1 / dist).Scale(strength * game.Spacing))
	}
	return out
}

func nearestEnemy(w *game.World, bot *game.Mage) *game.Mage {
	var nearest *game.Mage
	bestDistSq := math.Inf(1)
	for _, id := range sortedMageIDs(w) {
		m := w.Mage(id)
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

func countLiving(w *game.World, team game.Team) int {
	n := 0
	for _, m := range w.Mages {
		if m.Team == team && m.Alive {
			n++
		}
	}
	return n
}

func dirTo(from, to game.Vec2) game.Vec2 { return to.Sub(from).Normalized() }

func rotate(v game.Vec2, radians float64) game.Vec2 {
	s, c := math.Sin(radians), math.Cos(radians)
	return game.Vec2{X: v.X*c - v.Y*s, Y: v.X*s + v.Y*c}
}

// idSign derives a stable ±1 from a mage ID (FNV-1a) so a strafe keeps
// circling the same way instead of flip-flopping every tick.
func idSign(id string) float64 {
	var h uint32 = 2166136261
	for i := 0; i < len(id); i++ {
		h ^= uint32(id[i])
		h *= 16777619
	}
	if h%2 == 0 {
		return 1
	}
	return -1
}

// Go randomizes map iteration order. Every scan that can pick a "best"
// candidate iterates in sorted id order instead, so two servers replaying the
// same inputs make the same choices.

func sortedKeys(m map[string]Difficulty) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedMageIDs(w *game.World) []string {
	out := make([]string, 0, len(w.Mages))
	for k := range w.Mages {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedProjectileIDs(w *game.World) []string {
	out := make([]string, 0, len(w.Projectiles))
	for k := range w.Projectiles {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func lerp(a, b, t float64) float64 { return a + (b-a)*t }

func inverseLerp(a, b, v float64) float64 {
	if math.Abs(b-a) < epsilon {
		return 0
	}
	return clamp((v-a)/(b-a), 0, 1)
}
