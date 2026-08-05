/**
 * The authoritative simulation state for one match (GDD §14).
 *
 * It plays on the same JSON-defined arena the client renders (see Arena.ts) —
 * obstacle collision, projectile blocking and line of sight included.
 */

import { Arena } from './Arena';
import { cardFor, type CardId } from './cards';
import {
  ACCELERATION,
  AIM_DEADZONE,
  AIM_TURN_SPEED,
  CHARGE_TIME,
  CORE_HEALTH,
  CORE_RADIUS,
  CORPSE_LINGER,
  DEFAULT_LIVES,
  DEPLOY_ADVANCE_DEPTH,
  DEPLOY_STRUCTURE_CLEARANCE,
  HIT_STUN,
  KNOCKBACK_DAMPING,
  KNOCKBACK_STOP_SPEED,
  LAUNCH_HEIGHT,
  MAGE_RADIUS,
  MANA_MAX,
  MANA_REGEN_INTERVAL,
  MANA_START,
  MATCH_DURATION,
  MAX_HEALTH,
  MAX_PROJECTILE_LIFETIME,
  MOVE_SPEED,
  RECOVERY,
  RESPAWN_DELAY,
  RESPAWN_IMMUNITY,
  SPACING,
  SPAWN_MARGIN,
  STRUCTURE_TOP_HEIGHT,
  SUDDEN_DEATH_DURATION,
  SUDDEN_DEATH_MANA_MULTIPLIER,
  THROW_COOLDOWN,
  TOWER_ATTACK_INTERVAL,
  TOWER_DAMAGE,
  TOWER_HEALTH,
  TOWER_RADIUS,
  TOWER_RANGE,
  TURN_SPEED,
} from './config';
import { defaultArena } from './defaultMap';
import { elementDefFor, type ElementDef, type ElementId } from './elements';
import {
  emptyInput,
  isOut,
  opponentOf,
  TEAM_A,
  TEAM_B,
  type Mage,
  type MageInput,
  type Projectile,
  type Puddle,
  type Structure,
  type Team,
} from './entities';
import { type Role } from './roles';
import { Vec2 } from './Vec2';

/** Why a `deploy()` call was rejected — surfaced to the client for UI feedback. */
export type DeployRejection =
  | 'unknown_card'
  | 'not_enough_mana'
  | 'outside_deploy_zone'
  | 'blocked_position'
  | 'match_over';

export type DeployResult =
  | { ok: true; mage: Mage }
  | { ok: false; reason: DeployRejection };

export class World {
  readonly mages = new Map<string, Mage>();
  readonly projectiles = new Map<string, Projectile>();
  readonly puddles = new Map<string, Puddle>();
  readonly structures = new Map<string, Structure>();

  roundOver = false;
  winner: Team | null = null;

  /** Seconds of match time elapsed (GDD §4). */
  elapsed = 0;
  /** Set once normal time ends level on structures; doubles mana regen. */
  suddenDeath = false;

  private nextId = 0;
  private readonly teamCounts = new Map<Team, number>();
  private readonly mana = new Map<Team, number>();
  private readonly manaAccum = new Map<Team, number>();

  /** Pass an arena to play on a specific map; omit for the default one. */
  constructor(readonly arena: Arena = defaultArena()) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      this.mana.set(team, MANA_START);
      this.manaAccum.set(team, 0);
    }
    this.buildStructures();
  }

  /* ---- Structures (GDD §5) ------------------------------------------------ */

  private buildStructures(): void {
    for (const p of this.arena.structures) {
      const isCoreKind = p.kind === 'core';
      const id = `${p.kind}-${p.team}-${this.structures.size}`;
      this.structures.set(id, {
        id,
        team: p.team,
        kind: p.kind,
        position: p.pos,
        radius: isCoreKind ? CORE_RADIUS : TOWER_RADIUS,
        health: isCoreKind ? CORE_HEALTH : TOWER_HEALTH,
        maxHealth: isCoreKind ? CORE_HEALTH : TOWER_HEALTH,
        alive: true,
        // Cores do not shoot; they are the thing you have to reach.
        range: isCoreKind ? 0 : TOWER_RANGE,
        damage: isCoreKind ? 0 : TOWER_DAMAGE,
        attackInterval: isCoreKind ? 0 : TOWER_ATTACK_INTERVAL,
        attackCooldown: 0,
        invulnerable: isCoreKind,
      });
    }
  }

  structuresOf(team: Team): Structure[] {
    return [...this.structures.values()].filter((s) => s.team === team);
  }

  /** Live enemy structures a team is trying to bring down, Towers before Core. */
  targetableStructuresFor(team: Team): Structure[] {
    return [...this.structures.values()]
      .filter((s) => s.team !== team && s.alive && !s.invulnerable)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** How many enemy structures `team` has brought down — the win metric (GDD §4). */
  structuresDestroyedBy(team: Team): number {
    let n = 0;
    for (const s of this.structures.values()) {
      if (s.team !== team && !s.alive) n++;
    }
    return n;
  }

  /* ---- Mana (GDD §6) ------------------------------------------------------ */

  manaOf(team: Team): number {
    return this.mana.get(team) ?? 0;
  }

  private spendMana(team: Team, amount: number): void {
    this.mana.set(team, Math.max(0, this.manaOf(team) - amount));
  }

  private updateMana(dt: number): void {
    const rate = this.suddenDeath ? SUDDEN_DEATH_MANA_MULTIPLIER : 1;
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      if (this.manaOf(team) >= MANA_MAX) {
        this.manaAccum.set(team, 0);
        continue;
      }
      let acc = (this.manaAccum.get(team) ?? 0) + dt * rate;
      let mana = this.manaOf(team);
      while (acc >= MANA_REGEN_INTERVAL && mana < MANA_MAX) {
        acc -= MANA_REGEN_INTERVAL;
        mana++;
      }
      this.mana.set(team, mana);
      this.manaAccum.set(team, mana >= MANA_MAX ? 0 : acc);
    }
  }

  /* ---- Deployment (GDD §5, §9) -------------------------------------------- */

  /**
   * The whole of the player's agency in one method: spend mana to put a card's
   * unit on the ground at a chosen point. Everything after this is autonomous.
   */
  deploy(team: Team, cardId: string, position: Vec2): DeployResult {
    if (this.roundOver) return { ok: false, reason: 'match_over' };

    const card = cardFor(cardId as CardId);
    if (!card) return { ok: false, reason: 'unknown_card' };
    if (this.manaOf(team) < card.cost) return { ok: false, reason: 'not_enough_mana' };
    if (!this.canDeployAt(team, position)) return { ok: false, reason: 'outside_deploy_zone' };

    const spot = this.arena.clamp(position, MAGE_RADIUS);
    if (this.isBlockedForSummon(spot)) return { ok: false, reason: 'blocked_position' };

    this.spendMana(team, card.cost);
    const mage = this.summon(team, card.id, spot);
    return { ok: true, mage };
  }

  /**
   * A team deploys in its own half, extended past the midline on a flank whose
   * enemy Tower has fallen — the analogue of Clash Royale's bridge (GDD §5).
   */
  canDeployAt(team: Team, pos: Vec2): boolean {
    if (this.arena.outOfBounds(pos)) return false;

    const flankBroken = this.isFlankBroken(team, pos.y);
    const maxForward = flankBroken ? DEPLOY_ADVANCE_DEPTH : 0;

    // TEAM_A owns negative x, TEAM_B positive x (see facingSignForTeam).
    const forward = team === TEAM_A ? pos.x : -pos.x;
    if (forward > maxForward) return false;

    for (const s of this.structures.values()) {
      if (s.team === team || !s.alive) continue;
      if (s.position.distanceTo(pos) < DEPLOY_STRUCTURE_CLEARANCE + s.radius) return false;
    }
    return true;
  }

  /**
   * True once the enemy Tower guarding this side of the map is down.
   *
   * The side test uses `>= 0` rather than `Math.sign`, because `Math.sign(0)`
   * is 0 and would match no Tower at all — which read as "this flank is broken"
   * and let a team deploy on the midline from the opening seconds.
   */
  private isFlankBroken(team: Team, y: number): boolean {
    const side = y >= 0;
    let guarded = false;
    for (const s of this.structures.values()) {
      if (s.team === team || s.kind !== 'tower') continue;
      if (s.position.y >= 0 !== side) continue;
      guarded = true;
      if (s.alive) return false;
    }
    // No Tower covers this side: nothing was ever broken open here.
    return guarded;
  }

  private isBlockedForSummon(pos: Vec2): boolean {
    if (this.arena.blocksMovementAt(pos, MAGE_RADIUS)) return true;
    for (const s of this.structures.values()) {
      if (s.alive && s.position.distanceTo(pos) < s.radius + MAGE_RADIUS) return true;
    }
    return false;
  }

  /**
   * The single "could I summon here?" predicate — zone rules *and* physical
   * room. `canDeployAt` alone answers only the first half, which is a trap: an
   * AI that picks spots with it will happily choose the inside of its own
   * Tower and have every cast rejected.
   */
  canSummonAt(team: Team, pos: Vec2): boolean {
    return (
      this.canDeployAt(team, pos) && !this.isBlockedForSummon(this.arena.clamp(pos, MAGE_RADIUS))
    );
  }

  /** Creates a card's unit at `position`. Bypasses mana — `deploy()` is the paying door. */
  summon(team: Team, cardId: CardId, position: Vec2): Mage {
    const card = cardFor(cardId);
    if (!card) throw new Error(`sim: unknown card ${JSON.stringify(cardId)}`);
    return this.insertMage({
      id: `mage-${++this.nextId}`,
      team,
      element: card.element,
      role: card.role,
      cardId,
      moveSpeed: card.moveSpeed,
      maxHealth: card.health,
      position,
      isBot: true,
    });
  }

  /**
   * Places a bare mage at its team's next spawn slot with the pre-pivot default
   * stats. Retained for combat unit tests and for the frozen practice-mode
   * shape; the game itself goes through `deploy()`.
   */
  addMage(id: string, team: Team, element: ElementId, isBot: boolean): Mage {
    const idx = this.teamCounts.get(team) ?? 0;
    this.teamCounts.set(team, idx + 1);
    return this.insertMage({
      id,
      team,
      element,
      role: 'damage',
      cardId: null,
      moveSpeed: MOVE_SPEED,
      maxHealth: MAX_HEALTH,
      position: this.arena.spawnFor(team, idx),
      isBot,
    });
  }

  private insertMage(spec: {
    id: string;
    team: Team;
    element: ElementId;
    role: Role;
    cardId: CardId | null;
    moveSpeed: number;
    maxHealth: number;
    position: Vec2;
    isBot: boolean;
  }): Mage {
    const m: Mage = {
      id: spec.id,
      team: spec.team,
      isBot: spec.isBot,
      element: spec.element,
      role: spec.role,
      cardId: spec.cardId,
      moveSpeed: spec.moveSpeed,
      position: spec.position,
      facing: new Vec2(facingSignForTeam(spec.team), 0),
      velocity: Vec2.zero,
      health: spec.maxHealth,
      maxHealth: spec.maxHealth,
      alive: true,
      lives: DEFAULT_LIVES,
      state: 'idle',
      charge: 0,
      charging: false,
      throwCooldown: 0,
      recoveryTimer: 0,
      stunTimer: 0,
      knockbackVelocity: Vec2.zero,
      slowFactor: 0,
      slowTimer: 0,
      immunityTimer: 0,
      respawnTimer: 0,
      chargeRateBonus: 0,
      input: emptyInput(),
    };
    this.mages.set(m.id, m);
    return m;
  }

  mage(id: string): Mage | undefined {
    return this.mages.get(id);
  }

  /** Stores the latest input for a mage; applied at the start of the next step (GDD §6). */
  setInput(id: string, input: MageInput): void {
    const m = this.mages.get(id);
    if (m) m.input = input;
  }

  /** Advances the simulation by `dt` seconds (GDD §14, fixed 60Hz tick). */
  step(dt: number): void {
    if (this.roundOver) return;

    this.elapsed += dt;
    this.updateMana(dt);
    // Auras are resolved before movement so a mage charges at the rate implied
    // by where the support stood at the top of this tick.
    this.updateSupportAuras();
    for (const m of this.mages.values()) this.updateMage(m, dt);
    this.applySupportHealing(dt);
    this.separateMages();
    this.updateStructures(dt);
    this.updateProjectiles(dt);
    this.updatePuddles(dt);
    this.removeSpentMages();
    this.checkMatchEnd();

    // `release` is an edge-triggered "the client let go this tick" signal; drop
    // it once processed so it can never re-fire on a later tick.
    for (const m of this.mages.values()) m.input.release = false;
  }

  private updateMage(m: Mage, dt: number): void {
    if (m.immunityTimer > 0) m.immunityTimer = decay(m.immunityTimer, dt);
    if (m.slowTimer > 0) {
      m.slowTimer = decay(m.slowTimer, dt);
      if (m.slowTimer === 0) m.slowFactor = 0;
    }
    if (m.throwCooldown > 0) m.throwCooldown = decay(m.throwCooldown, dt);

    if (!m.alive) {
      if (m.respawnTimer > 0) {
        m.respawnTimer = decay(m.respawnTimer, dt);
        // With lives left this is a respawn countdown; without, it is the
        // corpse linger before the unit is dropped (see removeSpentMages).
        if (m.respawnTimer === 0 && m.lives > 0) this.respawn(m);
      }
      return;
    }

    if (m.stunTimer > 0) {
      // Knockback is a decaying slide over the stun window (mirroring the
      // client's DamageSystem), not an instant position jump.
      m.position = this.resolveMove(m.position, m.knockbackVelocity.scale(dt));
      m.knockbackVelocity = m.knockbackVelocity.scale(Math.exp(-KNOCKBACK_DAMPING * dt));
      if (m.knockbackVelocity.lengthSq() <= KNOCKBACK_STOP_SPEED * KNOCKBACK_STOP_SPEED) {
        m.knockbackVelocity = Vec2.zero;
      }

      m.stunTimer = decay(m.stunTimer, dt);
      m.state = 'stunned';
      if (m.stunTimer === 0) {
        m.knockbackVelocity = Vec2.zero;
        m.state = 'idle';
      }
      return;
    }

    if (m.recoveryTimer > 0) {
      m.recoveryTimer = decay(m.recoveryTimer, dt);
      m.state = 'recovering';
      if (m.recoveryTimer === 0) m.state = 'idle';
      // Deliberately no early return: recovery gates re-charging (via the
      // longer throwCooldown) but must not freeze the mage in place.
    }

    const def = elementDefFor(m.element);
    const input = m.input;

    if (input.release && m.charging) {
      this.releaseThrow(m, def);
    } else if (input.charging && m.throwCooldown <= 0) {
      m.charging = true;
      m.state = 'charging';
      // A friendly Bard's aura makes this fill faster (GDD §9).
      m.charge = Math.min(1, m.charge + (dt * (1 + m.chargeRateBonus)) / CHARGE_TIME);
      // Turn toward the aim point rather than snapping, and ignore a cursor
      // sitting on top of the mage (mirrors the client's AIM deadzone/turn).
      const aim = input.aim.sub(m.position);
      if (aim.length() > AIM_DEADZONE) {
        m.facing = m.facing.rotateTowards(aim.normalized(), AIM_TURN_SPEED * dt);
      }
    } else if (m.charging) {
      // The client stopped holding without an explicit release message (e.g. a
      // dropped packet) — release at whatever charge accumulated rather than
      // losing the throw silently.
      this.releaseThrow(m, def);
    }

    // Charging and recovering do NOT root a mage — only stun/death do, and
    // those already returned above. This mirrors the client's canAcceptOrders
    // (Hit/Frozen/Defeated only), where you keep walking while holding a charge.
    this.moveMage(m, input, dt);
  }

  private moveMage(m: Mage, input: MageInput, dt: number): void {
    const move = input.move.clampLength(1);

    // Per-unit since the pivot: a Golem is slow and a Dervish is fast (GDD §9).
    let speed = m.moveSpeed;
    if (m.slowFactor > 0) speed *= 1 - m.slowFactor;

    // Accelerate toward the desired velocity instead of snapping to it, so
    // starts and stops carry the same weight as practice mode.
    m.velocity = m.velocity.moveTowards(move.scale(speed), ACCELERATION * dt).clampLength(speed);

    if (m.velocity.lengthSq() <= 1e-6) {
      m.velocity = Vec2.zero;
      if (!m.charging && m.state !== 'recovering') m.state = 'idle';
      return;
    }

    m.position = this.resolveMove(m.position, m.velocity.scale(dt));

    // While charging, facing *is* the aim (and throw) direction, so movement
    // must not steer it.
    if (!m.charging) {
      m.facing = m.facing.rotateTowards(m.velocity.normalized(), TURN_SPEED * dt);
      if (m.state !== 'recovering') m.state = 'moving';
    }
  }

  /**
   * Pushes overlapping mages apart so they don't stack on one tile, mirroring
   * the client's MovementSystem.resolvePlayerSpacing.
   */
  private separateMages(): void {
    // Iterate in sorted-id order so resolution is deterministic across ticks
    // and across servers replaying the same inputs.
    const mages = [...this.mages.values()]
      .filter((m) => m.alive)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const minDist = Math.max(2 * MAGE_RADIUS, SPACING);
    for (let i = 0; i < mages.length; i++) {
      for (let j = i + 1; j < mages.length; j++) {
        const a = mages[i];
        const b = mages[j];
        const delta = a.position.sub(b.position);
        const distSq = delta.lengthSq();
        if (distSq >= minDist * minDist) continue;

        if (distSq <= 1e-12) {
          a.position = new Vec2(a.position.x - minDist / 2, a.position.y);
          b.position = new Vec2(b.position.x + minDist / 2, b.position.y);
          continue;
        }

        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / 2;
        const n = delta.scale(1 / dist);
        a.position = this.arena.clamp(a.position.add(n.scale(push)), MAGE_RADIUS);
        b.position = this.arena.clamp(b.position.sub(n.scale(push)), MAGE_RADIUS);
      }
    }
  }

  /**
   * Applies a movement step against arena bounds and obstacles, sliding along a
   * blocker instead of sticking to it: if the combined step is blocked, each
   * axis is retried on its own, so walking diagonally into a wall slides along it.
   */
  private resolveMove(from: Vec2, step: Vec2): Vec2 {
    const combined = this.arena.clamp(from.add(step), MAGE_RADIUS);
    if (!this.blockedAt(combined)) return combined;

    if (step.x !== 0) {
      const alongX = this.arena.clamp(new Vec2(from.x + step.x, from.y), MAGE_RADIUS);
      if (!this.blockedAt(alongX)) return alongX;
    }
    if (step.y !== 0) {
      const alongY = this.arena.clamp(new Vec2(from.x, from.y + step.y), MAGE_RADIUS);
      if (!this.blockedAt(alongY)) return alongY;
    }
    return from;
  }

  /** Obstacles plus live structures — a Tower is a solid body, not decoration. */
  private blockedAt(p: Vec2): boolean {
    if (this.arena.blocksMovementAt(p, MAGE_RADIUS)) return true;
    for (const s of this.structures.values()) {
      if (s.alive && s.position.distanceTo(p) < s.radius + MAGE_RADIUS) return true;
    }
    return false;
  }

  /* ---- Supports (GDD §9) --------------------------------------------------- */

  /**
   * Aura bonuses take the strongest applicable value rather than summing, so
   * stacking two Bards is deliberately not a strategy.
   */
  private updateSupportAuras(): void {
    for (const m of this.mages.values()) m.chargeRateBonus = 0;

    for (const src of this.mages.values()) {
      if (!src.alive || !src.cardId) continue;
      const card = cardFor(src.cardId);
      if (!card?.auraChargeBonus || !card.auraRadius) continue;

      for (const m of this.mages.values()) {
        if (m === src || !m.alive || m.team !== src.team) continue;
        if (m.position.distanceTo(src.position) <= card.auraRadius) {
          m.chargeRateBonus = Math.max(m.chargeRateBonus, card.auraChargeBonus);
        }
      }
    }
  }

  /** A healer tops up the single most-hurt ally in range, not everyone at once. */
  private applySupportHealing(dt: number): void {
    for (const healerId of sortedMageIds(this)) {
      const src = this.mages.get(healerId);
      if (!src?.alive || !src.cardId) continue;
      const card = cardFor(src.cardId);
      if (!card?.healPerSecond || !card.healRange) continue;

      let best: Mage | null = null;
      let bestMissing = 0;
      for (const targetId of sortedMageIds(this)) {
        const m = this.mages.get(targetId);
        if (!m || m === src || !m.alive || m.team !== src.team) continue;
        const missing = m.maxHealth - m.health;
        if (missing <= bestMissing) continue;
        if (src.position.distanceTo(m.position) > card.healRange) continue;
        bestMissing = missing;
        best = m;
      }

      if (best) best.health = Math.min(best.maxHealth, best.health + card.healPerSecond * dt);
    }
  }

  /* ---- Structure behaviour (GDD §5) ---------------------------------------- */

  private updateStructures(dt: number): void {
    // A Core is only reachable once both its Towers are down — the rule that
    // stops a minute-one rush at the Core.
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const towerUp = this.structuresOf(team).some((s) => s.kind === 'tower' && s.alive);
      for (const s of this.structuresOf(team)) {
        if (s.kind === 'core') s.invulnerable = towerUp;
      }
    }

    for (const id of sortedIds(this.structures.keys())) {
      const s = this.structures.get(id);
      if (!s || !s.alive || s.range <= 0) continue;

      if (s.attackCooldown > 0) {
        s.attackCooldown = decay(s.attackCooldown, dt);
        continue;
      }

      const target = this.towerTarget(s);
      if (!target) continue;
      this.fireTowerShot(s, target);
      s.attackCooldown = s.attackInterval;
    }
  }

  private towerTarget(s: Structure): Mage | null {
    let best: Mage | null = null;
    let bestDist = Infinity;
    for (const id of sortedMageIds(this)) {
      const m = this.mages.get(id);
      if (!m?.alive || m.team === s.team || m.immunityTimer > 0) continue;
      const d = m.position.distanceTo(s.position);
      if (d > s.range || d >= bestDist) continue;
      if (!this.arena.hasLineOfSight(s.position, m.position)) continue;
      best = m;
      bestDist = d;
    }
    return best;
  }

  /**
   * Tower bolts fly flat (no gravity) so their reach is exactly `range` and
   * reads unambiguously on screen — they are the defensive baseline, not an
   * arcing skill shot.
   */
  private fireTowerShot(s: Structure, target: Mage): void {
    const def = elementDefFor('arcane');
    if (!def) return;

    let dir = target.position.sub(s.position);
    if (dir.lengthSq() < 1e-9) return;
    dir = dir.normalized();

    const id = `proj-${++this.nextId}`;
    this.projectiles.set(id, {
      id,
      ownerId: s.id,
      team: s.team,
      element: 'arcane',
      position: s.position.add(dir.scale(s.radius + SPAWN_MARGIN)),
      velocity: dir.scale(def.projectileSpeed),
      height: LAUNCH_HEIGHT,
      heightVelocity: 0,
      gravity: 0,
      damage: s.damage,
      knockback: 1,
      radius: def.radius,
      age: 0,
      alive: true,
    });
  }

  private findStructureHit(p: Projectile): Structure | null {
    for (const id of sortedIds(this.structures.keys())) {
      const s = this.structures.get(id);
      if (!s || !s.alive || s.team === p.team) continue;
      if (p.height > STRUCTURE_TOP_HEIGHT) continue;
      if (s.position.distanceTo(p.position) <= s.radius + p.radius) return s;
    }
    return null;
  }

  /** The single seam for structure damage, mirroring `dealDamage` for mages. */
  damageStructure(s: Structure, amount: number): void {
    if (!s.alive || s.invulnerable) return;
    s.health -= amount;
    if (s.health <= 0) {
      s.health = 0;
      s.alive = false;
    }
  }

  /**
   * Summons are permanent losses (GDD §4) — once the death has been visible for
   * a beat, the unit leaves the world so snapshots and AI scans stay bounded.
   */
  private removeSpentMages(): void {
    for (const [id, m] of [...this.mages]) {
      if (isOut(m) && m.respawnTimer === 0) this.mages.delete(id);
    }
  }

  private releaseThrow(m: Mage, def: ElementDef | undefined): void {
    const charge = m.charge;
    m.charging = false;
    m.charge = 0;
    m.throwCooldown = THROW_COOLDOWN;
    m.recoveryTimer = RECOVERY;
    m.state = 'recovering';

    if (!def) return;

    let dir = m.facing;
    if (dir.lengthSq() < 1e-9) dir = new Vec2(facingSignForTeam(m.team), 0);

    const speed = def.minSpeed + (def.projectileSpeed - def.minSpeed) * charge;
    const id = `proj-${++this.nextId}`;
    this.projectiles.set(id, {
      id,
      ownerId: m.id,
      team: m.team,
      element: def.id,
      position: m.position.add(dir.scale(MAGE_RADIUS + SPAWN_MARGIN)),
      velocity: dir.scale(speed),
      height: LAUNCH_HEIGHT,
      heightVelocity: def.launchArc * (0.6 + 0.4 * charge),
      gravity: def.gravity,
      damage: def.damage,
      knockback: def.knockback,
      radius: def.radius,
      age: 0,
      alive: true,
    });
  }

  private updateProjectiles(dt: number): void {
    for (const [id, p] of [...this.projectiles]) {
      p.age += dt;
      p.heightVelocity -= p.gravity * dt;
      p.height += p.heightVelocity * dt;
      p.position = p.position.add(p.velocity.scale(dt));

      const target = this.findProjectileHit(p);
      if (target) {
        this.applyProjectileHit(p, target);
        this.projectiles.delete(id);
        continue;
      }

      // Units body-block: only a shot that got past every mage reaches the
      // structure behind them, which is precisely what a tank is buying.
      const struct = this.findStructureHit(p);
      if (struct) {
        this.damageStructure(struct, p.damage);
        this.projectiles.delete(id);
        continue;
      }

      if (
        p.age > MAX_PROJECTILE_LIFETIME ||
        p.height <= 0 ||
        this.arena.outOfBounds(p.position) ||
        this.arena.blocksProjectileAt(p.position, p.radius, p.height)
      ) {
        this.onProjectileExpire(p);
        this.projectiles.delete(id);
      }
    }
  }

  private findProjectileHit(p: Projectile): Mage | null {
    for (const m of this.mages.values()) {
      if (!m.alive || m.id === p.ownerId || m.team === p.team || m.immunityTimer > 0) continue;
      if (m.position.distanceTo(p.position) <= MAGE_RADIUS + p.radius) return m;
    }
    return null;
  }

  private applyProjectileHit(p: Projectile, target: Mage): void {
    const def = elementDefFor(p.element);
    if (!def) return;

    let dir = target.position.sub(p.position);
    if (dir.lengthSq() < 1e-9) dir = p.velocity;

    this.dealDamage(target, p.damage, dir, p.knockback + (def.knockbackBonus ?? 0));

    if (def.slowFactor && def.slowFactor > 0) {
      target.slowFactor = def.slowFactor;
      target.slowTimer = def.slowDuration ?? 0;
    }
    if (def.interruptsCharge && target.charging) {
      target.charging = false;
      target.charge = 0;
    }
    if (def.spawnsPuddle) this.spawnPuddle(p.ownerId, target.position, def);
    if (def.splashRadius && def.splashRadius > 0) this.applySplash(p, target, def);
  }

  /**
   * Reduced splash damage to nearby enemies (arcane, GDD §8.7), excluding the
   * mage that already took the direct hit.
   */
  private applySplash(p: Projectile, primary: Mage, def: ElementDef): void {
    const splashRadius = def.splashRadius ?? 0;
    for (const m of this.mages.values()) {
      if (m === primary || !m.alive || m.team === p.team || m.immunityTimer > 0) continue;
      if (m.position.distanceTo(p.position) <= splashRadius) {
        this.dealDamage(m, def.damage * 0.5, m.position.sub(p.position), def.knockback * 0.5);
      }
    }
  }

  private onProjectileExpire(p: Projectile): void {
    const def = elementDefFor(p.element);
    // Negation of space: a poison flask that never hits a mage still
    // contaminates the ground where it lands (GDD §8.5).
    if (def?.spawnsPuddle) this.spawnPuddle(p.ownerId, p.position, def);
  }

  private spawnPuddle(ownerId: string, pos: Vec2, def: ElementDef): void {
    const id = `puddle-${++this.nextId}`;
    this.puddles.set(id, {
      id,
      ownerId,
      position: pos,
      radius: def.puddleRadius ?? 0,
      duration: def.puddleDuration ?? 0,
      elapsed: 0,
      tickInterval: def.puddleTickInterval ?? 0,
      tickDamage: def.puddleTickDamage ?? 0,
      tickTimer: 0,
      alive: true,
    });
  }

  private updatePuddles(dt: number): void {
    for (const [id, pu] of [...this.puddles]) {
      pu.elapsed += dt;
      pu.tickTimer += dt;

      if (pu.tickTimer >= pu.tickInterval) {
        pu.tickTimer -= pu.tickInterval;
        // Ground effects hurt everyone overlapping them, including the caster's
        // own team — an intentional anti-camp rule (GDD §8.5).
        for (const m of this.mages.values()) {
          if (!m.alive || m.immunityTimer > 0) continue;
          if (m.position.distanceTo(pu.position) <= pu.radius + MAGE_RADIUS) {
            this.dealDamage(m, pu.tickDamage, Vec2.zero, 0);
          }
        }
      }

      if (pu.elapsed >= pu.duration) this.puddles.delete(id);
    }
  }

  /**
   * The single seam every damage source (projectiles, puddles) funnels through,
   * so death/respawn/lives stay consistent everywhere.
   */
  dealDamage(m: Mage, amount: number, knockDir: Vec2, knockMag: number): void {
    if (!m.alive || m.immunityTimer > 0) return;

    m.health -= amount;
    if (knockMag > 0) {
      const n = knockDir.normalized();
      if (n.lengthSq() > 0) {
        // Additive initial velocity, decayed over the stun window in
        // updateMage — not an instant teleport (see KNOCKBACK_DAMPING).
        m.knockbackVelocity = m.knockbackVelocity.add(n.scale(knockMag));
      }
    }
    m.stunTimer = HIT_STUN;

    if (m.health <= 0) this.kill(m);
  }

  private kill(m: Mage): void {
    m.health = 0;
    m.alive = false;
    m.charging = false;
    m.charge = 0;
    m.knockbackVelocity = Vec2.zero;
    m.velocity = Vec2.zero;
    m.state = 'dead';
    m.lives--;
    m.respawnTimer = m.lives > 0 ? RESPAWN_DELAY : CORPSE_LINGER;
  }

  private respawn(m: Mage): void {
    m.position = this.arena.spawnFor(m.team, 0);
    m.velocity = Vec2.zero;
    m.health = m.maxHealth;
    m.alive = true;
    m.state = 'idle';
    m.immunityTimer = RESPAWN_IMMUNITY;
    m.charge = 0;
    m.charging = false;
    m.stunTimer = 0;
    m.slowFactor = 0;
    m.slowTimer = 0;
  }

  /**
   * The win condition since the pivot (GDD §4): structures decide matches, not
   * kills. A Core falling ends it on the spot; otherwise normal time is scored
   * on structures destroyed, and a level score goes to sudden death.
   *
   * A finished match with `winner === null` is a draw — callers must read
   * `roundOver` first rather than treating a null winner as "still playing".
   */
  private checkMatchEnd(): void {
    if (this.roundOver) return;

    for (const id of sortedIds(this.structures.keys())) {
      const s = this.structures.get(id);
      if (s && s.kind === 'core' && !s.alive) {
        this.endRound(opponentOf(s.team));
        return;
      }
    }

    const aDown = this.structuresDestroyedBy(TEAM_A);
    const bDown = this.structuresDestroyedBy(TEAM_B);

    if (!this.suddenDeath) {
      if (this.elapsed < MATCH_DURATION) return;
      if (aDown !== bDown) {
        this.endRound(aDown > bDown ? TEAM_A : TEAM_B);
        return;
      }
      this.suddenDeath = true;
      return;
    }

    // Sudden death is entered level on structures, so the next one to fall wins.
    if (aDown !== bDown) {
      this.endRound(aDown > bDown ? TEAM_A : TEAM_B);
      return;
    }

    if (this.elapsed >= MATCH_DURATION + SUDDEN_DEATH_DURATION) {
      const aCore = this.coreHealth(TEAM_A);
      const bCore = this.coreHealth(TEAM_B);
      this.roundOver = true;
      this.winner = aCore === bCore ? null : aCore > bCore ? TEAM_A : TEAM_B;
    }
  }

  private coreHealth(team: Team): number {
    let total = 0;
    for (const s of this.structures.values()) {
      if (s.team === team && s.kind === 'core') total += s.health;
    }
    return total;
  }

  private endRound(winner: Team): void {
    this.roundOver = true;
    this.winner = winner;
  }
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortedMageIds(w: World): string[] {
  return sortedIds(w.mages.keys());
}

function decay(timer: number, dt: number): number {
  return Math.max(0, timer - dt);
}

function facingSignForTeam(t: Team): number {
  return t === TEAM_B ? -1 : 1;
}
