/**
 * The authoritative simulation state for one match (GDD §14).
 *
 * It plays on the same JSON-defined arena the client renders (see Arena.ts) —
 * obstacle collision, projectile blocking and line of sight included.
 */

import { Arena, pushOutOfCircle } from './Arena';
import type { OnHitRule } from './balance';
import { rosterFor, type RosterId } from './cards';
import {
  ACCELERATION,
  AIM_DEADZONE,
  AIM_TURN_SPEED,
  CHARGE_TIME,
  CORE_HEALTH,
  CORE_RADIUS,
  EXECUTE_THRESHOLD,
  HEAL_INTERRUPT_DURATION,
  HEAL_INTERRUPT_KNOCKBACK,
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
  SIEGE_RAMP_END,
  SIEGE_RAMP_START,
  SIEGE_RAMP_SUDDEN_DEATH,
  SIM_DT,
  SPACING,
  SPAWN_MARGIN,
  SPELL_CAST_FX_DURATION,
  SPELL_GLOBAL_COOLDOWN,
  STRUCTURE_DAMAGE_MULTIPLIER,
  STRUCTURE_TOP_HEIGHT,
  SUDDEN_DEATH_DURATION,
  SUDDEN_DEATH_MANA_MULTIPLIER,
  SUDDEN_DEATH_STRUCTURE_DECAY,
  THROW_COOLDOWN,
  TOWER_ATTACK_INTERVAL,
  TOWER_DAMAGE,
  TOWER_HEALTH,
  TOWER_RADIUS,
  TOWER_RANGE,
  TURN_SPEED,
} from './config';
import { defaultArena } from './defaultMap';
import {
  absorbWithShield,
  applyEffect,
  canAct,
  chargeRateMultiplier,
  clearEffects,
  damageDealtMultiplier,
  damageImmune,
  damageTakenMultiplier,
  hasEffect,
  isEffectKind,
  magnitudeOf,
  moveSpeedMultiplier,
  removeEffect,
  tickEffects,
} from './effects';
import { elementDefFor, type ElementDef, type ElementId } from './elements';
import {
  emptyInput,
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
import { PathGrid } from './PathGrid';
import { type Role } from './roles';
import { spellFor, type SpellApplication, type SpellCard, type SpellId } from './spells';
import { spellRiderFor } from './spellRiders';
import { Vec2 } from './Vec2';

/** Why a `castSpell()` call was rejected — surfaced to the client for UI feedback. */
export type CastRejection =
  | 'unknown_card'
  | 'not_enough_mana'
  | 'out_of_bounds'
  | 'match_over'
  | 'on_cooldown'
  /** Every mage this team has standing is stone; see {@link World.squadPetrified}. */
  | 'squad_petrified';

export type CastResult = { ok: true } | { ok: false; reason: CastRejection };

/** Relaxation passes used to free a mage overlapping solid geometry. */
const DEPENETRATION_PASSES = 4;
/**
 * Margin the path planner keeps beyond the body radius, so a planned route has
 * room to actually be walked (see `pathGrid`). Roughly half a cell.
 */
const PATH_CLEARANCE = 0.2;
/** Spacing of `isBlockedSegment`'s samples, and the ceiling on how many it takes. */
const SEGMENT_SAMPLE_STEP = MAGE_RADIUS;
const SEGMENT_SAMPLE_LIMIT = 96;

/**
 * Everything a damage source may say about itself beyond the number. All
 * optional: a bare `dealDamage(m, 10)` is a hit from nowhere that knocks
 * nobody back and credits nobody, which is exactly what a test wants.
 */
export interface DamageOptions {
  /** Direction of the shove; ignored without `knockMag`. */
  knockDir?: Vec2;
  knockMag?: number;
  /** Praga's tick ignores Escudo Arcano by design (GDD §9). */
  bypassShield?: boolean;
  /** Whatever caused the damage; `kill` decides if it can score. */
  attackerId?: string | null;
  /** For damage over time, which must not re-apply the flinch every tick. */
  noHitStun?: boolean;
}

/**
 * A cast that just happened, kept around only long enough for clients to see
 * it (GDD §17). Three of the four spells apply instantly to the mages in
 * range — without this the wire would carry no trace at all that a Bênção or
 * a Maldição ever landed, and only Praga (which leaves a puddle behind) would
 * ever be visible.
 */
export interface SpellCastFx {
  readonly id: string;
  readonly spellId: SpellId;
  readonly team: Team;
  readonly position: Vec2;
  readonly radius: number;
  elapsed: number;
}

/**
 * One entry of a card's `apply` list that has not happened yet — see
 * `SpellApplyRule.delay`. The position is kept and the *targets* are not: who
 * it catches is decided when it fires.
 */
interface PendingApplication {
  readonly team: Team;
  readonly spell: SpellCard;
  readonly app: SpellApplication;
  readonly position: Vec2;
  remaining: number;
}

export class World {
  readonly mages = new Map<string, Mage>();
  readonly projectiles = new Map<string, Projectile>();
  readonly puddles = new Map<string, Puddle>();
  readonly structures = new Map<string, Structure>();
  /** Purely cosmetic; see {@link SpellCastFx}. Never read by combat. */
  readonly spellCasts = new Map<string, SpellCastFx>();

  roundOver = false;
  winner: Team | null = null;

  /**
   * Successful casts per team, per spell — the only record of what a player
   * actually *did*, since a spell leaves no trace once its duration expires.
   * Counted here rather than at the caller because both the server session and
   * a locally simulated match cast through `castSpell`, and a tally that lived
   * in one of them would silently miss the other.
   */
  readonly castsBySpell = new Map<Team, Map<SpellId, number>>();

  /** Seconds of match time elapsed (GDD §4). */
  elapsed = 0;
  /** Set once normal time ends level on structures; doubles mana regen. */
  suddenDeath = false;

  private nextId = 0;
  /**
   * Kept apart from `nextId` on purpose: a cosmetic marker must never shift the
   * id a puddle or a projectile would have got, or adding VFX would change what
   * a replay of the same inputs produces.
   */
  private nextCastFxId = 0;
  private readonly teamCounts = new Map<Team, number>();
  private readonly mana = new Map<Team, number>();
  private readonly manaAccum = new Map<Team, number>();
  /** Seconds until each team may cast again; see {@link SPELL_GLOBAL_COOLDOWN}. */
  private readonly castCooldown = new Map<Team, number>();
  /**
   * Card applications waiting out their `delay`. Not cosmetic and not a marker:
   * this is damage that has been paid for and has not landed yet, so it is
   * simulation state like any other and it is why {@link updatePendingApplications}
   * runs inside `step` rather than off a timer.
   */
  private readonly pendingApplications: PendingApplication[] = [];
  /** A team's raised mana regeneration, while it lasts; see {@link attuneMana}. */
  private readonly manaFlow = new Map<Team, { multiplier: number; remaining: number }>();
  /** Re-entrancy guard for the pain bond; see {@link spreadBondedPain}. */
  private bondEcho = false;

  private cachedPathGrid: PathGrid | null = null;
  private cachedPathBlockers = -1;

  /** Pass an arena to play on a specific map; omit for the default one. */
  constructor(readonly arena: Arena = defaultArena()) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      this.mana.set(team, MANA_START);
      this.manaAccum.set(team, 0);
      this.castCooldown.set(team, 0);
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

  /**
   * Mana from something other than the clock (GDD §7) — Tributo Obscuro, so
   * far, which buys it with its own squad's health.
   *
   * Clamped at {@link MANA_MAX}, and the clamp is the point. Nothing in
   * `updateMana` ever brings an over-full bar back down: it stops *adding* at
   * the ceiling and otherwise leaves the number alone. A grant that overshot
   * would therefore park a team above the ceiling for the rest of the match,
   * which is not a stronger card, it is a broken economy.
   */
  grantMana(team: Team, amount: number): void {
    if (amount <= 0) return;
    this.mana.set(team, Math.min(MANA_MAX, this.manaOf(team) + amount));
  }

  /** Seconds a team must still wait before its next cast; 0 when it may cast now. */
  castCooldownOf(team: Team): number {
    return this.castCooldown.get(team) ?? 0;
  }

  private updateCastCooldown(dt: number): void {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const left = this.castCooldownOf(team);
      if (left > 0) this.castCooldown.set(team, decay(left, dt));
    }
  }

  /**
   * Raises a team's mana regeneration for a while (GDD §7) — Fluxo de Mana.
   *
   * A team-level timer rather than an effect on the mages, because the thing
   * being changed belongs to the team and not to any body: mana is not carried
   * by anybody, and a squad wiped mid-flow would otherwise lose an investment
   * it had already paid for, for a reason no readout on the field explains.
   *
   * The stronger flow wins and the longer one lasts, independently — the same
   * `refresh_strongest` bargain the effect catalog makes, kept the same here so
   * two casts of an economy card behave the way two casts of a slow do.
   */
  attuneMana(team: Team, multiplier: number, duration: number): void {
    if (multiplier <= 1 || duration <= 0) return;
    const running = this.manaFlow.get(team);
    this.manaFlow.set(team, {
      multiplier: Math.max(multiplier, running?.multiplier ?? 0),
      remaining: Math.max(duration, running?.remaining ?? 0),
    });
  }

  private manaRateOf(team: Team): number {
    const flow = this.manaFlow.get(team);
    return flow && flow.remaining > 0 ? flow.multiplier : 1;
  }

  private updateMana(dt: number): void {
    // Sudden death and a card multiply rather than replace each other: one is
    // the clock the whole match runs on and the other is something a player
    // paid for, and picking a winner would quietly refund whichever lost.
    const global = this.suddenDeath ? SUDDEN_DEATH_MANA_MULTIPLIER : 1;
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const rate = global * this.manaRateOf(team);
      const flow = this.manaFlow.get(team);
      if (flow && flow.remaining > 0) flow.remaining = decay(flow.remaining, dt);

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

  /* ---- Squad (GDD §4, §7) -------------------------------------------------- */

  /**
   * Creates a team's permanent squad at match start, one mage per roster
   * entry, on the map's spawn points. Never gated by mana — picking a squad
   * costs a slot, not mana (GDD §7).
   */
  initSquad(team: Team, roster: readonly RosterId[]): void {
    roster.forEach((id, idx) => {
      const entry = rosterFor(id);
      if (!entry) throw new Error(`sim: unknown roster entry ${JSON.stringify(id)}`);
      this.insertMage({
        id: `mage-${++this.nextId}`,
        team,
        element: entry.element,
        role: entry.role,
        rosterId: entry.id,
        moveSpeed: entry.moveSpeed,
        maxHealth: entry.health,
        position: this.findClearSpawn(team, idx),
        isBot: true,
      });
    });
  }

  /**
   * Test/dev helper: places one roster mage at an explicit position, bypassing
   * the squad's spawn points. Not reachable by a player — squads are built by
   * `initSquad`, never by spending mana (GDD §7 killed unit-summoning cards).
   */
  summon(team: Team, rosterId: RosterId, position: Vec2): Mage {
    const entry = rosterFor(rosterId);
    if (!entry) throw new Error(`sim: unknown roster entry ${JSON.stringify(rosterId)}`);
    return this.insertMage({
      id: `mage-${++this.nextId}`,
      team,
      element: entry.element,
      role: entry.role,
      rosterId: entry.id,
      moveSpeed: entry.moveSpeed,
      maxHealth: entry.health,
      position,
      isBot: true,
    });
  }

  /**
   * Places a bare mage at its team's next spawn slot with the pre-pivot default
   * stats. Retained for combat unit tests and for the frozen practice-mode
   * shape; the game itself only ever populates its mages through `initSquad`.
   */
  addMage(id: string, team: Team, element: ElementId, isBot: boolean): Mage {
    const idx = this.teamCounts.get(team) ?? 0;
    this.teamCounts.set(team, idx + 1);
    return this.insertMage({
      id,
      team,
      element,
      role: 'damage',
      rosterId: null,
      moveSpeed: MOVE_SPEED,
      maxHealth: MAX_HEALTH,
      position: this.findClearSpawn(team, idx),
      isBot,
    });
  }

  private insertMage(spec: {
    id: string;
    team: Team;
    element: ElementId;
    role: Role;
    rosterId: RosterId | null;
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
      rosterId: spec.rosterId,
      moveSpeed: spec.moveSpeed,
      position: spec.position,
      facing: new Vec2(facingSignForTeam(spec.team), 0),
      velocity: Vec2.zero,
      health: spec.maxHealth,
      maxHealth: spec.maxHealth,
      alive: true,
      kills: 0,
      deaths: 0,
      state: 'idle',
      charge: 0,
      charging: false,
      throwCooldown: 0,
      recoveryTimer: 0,
      stunTimer: 0,
      knockbackVelocity: Vec2.zero,
      healInterruptTimer: 0,
      immunityTimer: 0,
      respawnTimer: 0,
      chargeRateBonus: 0,
      effects: [],
      streakElement: null,
      streakCount: 0,
      streakTimer: 0,
      input: emptyInput(),
    };
    this.mages.set(m.id, m);
    return m;
  }

  /* ---- Spells (GDD §5, §9) -------------------------------------------------- */

  /**
   * The whole of the player's agency in one method (GDD §13): spend mana to
   * buff an area of your own squad or curse an area of the enemy's. There is
   * no deploy zone any more (GDD §5) — a spell lands wherever it is aimed, as
   * long as it is inside the arena.
   */
  castSpell(team: Team, spellId: string, position: Vec2): CastResult {
    if (this.roundOver) return { ok: false, reason: 'match_over' };

    const spell = spellFor(spellId);
    if (!spell) return { ok: false, reason: 'unknown_card' };
    // Ahead of the mana check, unlike everything else: a team whose whole squad
    // is stone has no one to channel through, and answering "not enough mana"
    // would send the player looking at the wrong readout entirely. It is also
    // the one rejection that is *about the opponent* — it names something they
    // did to you rather than something you got wrong.
    if (this.squadPetrified(team)) return { ok: false, reason: 'squad_petrified' };
    if (this.manaOf(team) < spell.cost) return { ok: false, reason: 'not_enough_mana' };
    if (this.arena.outOfBounds(position)) return { ok: false, reason: 'out_of_bounds' };
    // Checked last on purpose: every rejection above says something is wrong
    // with the *request*, which the caster can act on. This one is only about
    // timing and resolves on its own, so it is the least useful thing to hear.
    if (this.castCooldownOf(team) > 0) return { ok: false, reason: 'on_cooldown' };

    this.castCooldown.set(team, SPELL_GLOBAL_COOLDOWN);
    this.spendMana(team, spell.cost);
    this.applySpellEffect(team, spell, position);
    this.recordCastFx(team, spell, position);
    this.recordCast(team, spell.id);
    return { ok: true };
  }

  /**
   * Whether every mage this team still has standing is stone (GDD §9).
   *
   * The only hard lock on casting in the game. Petrificar is an area card, so
   * this is reachable exactly when the enemy has bunched up inside one cast —
   * which is the situation the card asks a program to wait for, and the reason
   * it is worth four mana against two and a half seconds of protecting what it
   * caught.
   *
   * Guarded on *living* mages, and false for a team with none. A squad wiped to
   * the last man is not petrified, it is dead: blocking its casts would turn a
   * lost fight into an unrecoverable one for a reason nothing on screen
   * explains. The empty case matters beyond taste, too — every test that casts
   * before summoning anybody would otherwise be vacuously locked out.
   */
  squadPetrified(team: Team): boolean {
    let living = 0;
    for (const m of this.mages.values()) {
      if (m.team !== team || !m.alive) continue;
      living++;
      if (!hasEffect(m, 'petrify')) return false;
    }
    return living > 0;
  }

  private recordCast(team: Team, spellId: SpellId): void {
    let byTeam = this.castsBySpell.get(team);
    if (!byTeam) {
      byTeam = new Map();
      this.castsBySpell.set(team, byTeam);
    }
    byTeam.set(spellId, (byTeam.get(spellId) ?? 0) + 1);
  }

  /** Leaves a short-lived, gameplay-free trace of the cast for clients (GDD §17). */
  private recordCastFx(team: Team, spell: SpellCard, position: Vec2): void {
    const id = `cast-${++this.nextCastFxId}`;
    this.spellCasts.set(id, {
      id,
      spellId: spell.id,
      team,
      position,
      radius: spell.radius,
      elapsed: 0,
    });
  }

  private updateCastFx(dt: number): void {
    for (const [id, fx] of this.spellCasts) {
      fx.elapsed += dt;
      if (fx.elapsed >= SPELL_CAST_FX_DURATION) this.spellCasts.delete(id);
    }
  }

  /**
   * Runs a card's `apply` list over whatever its `target` caught (GDD §9).
   *
   * There is deliberately no per-card branch here. A card is data: each
   * application either names a status kind, which goes straight to
   * `applyEffect`, or a rider in `spellRiders.ts` for the behaviours that
   * touch the world rather than a mage. Adding a card is a `balance.json`
   * edit, and only a new *kind* of behaviour reaches code.
   */
  private applySpellEffect(team: Team, spell: SpellCard, position: Vec2): void {
    for (const app of spell.apply) {
      const delay = app.delay ?? 0;
      if (delay > 0) {
        this.pendingApplications.push({ team, spell, app, position, remaining: delay });
        continue;
      }
      this.applyOneApplication(team, spell, app, position);
    }
  }

  /**
   * Runs the applications whose warning has run out (GDD §9).
   *
   * Targets are resolved here rather than being remembered from the cast, which
   * is the whole reason a delayed card is a different card and not a slow one:
   * the eruption catches whoever is standing on it when it goes off. A queue
   * that held onto its victims would be an instant card wearing a wind-up, and
   * the warning drawn on the ground would be telling the player something he
   * cannot act on.
   *
   * Iterated back to front so an entry can be spliced out on the tick it fires.
   * Order between two entries due on the same tick is cast order, which is what
   * keeps two eruptions landing together deterministic.
   */
  private updatePendingApplications(dt: number): void {
    for (let i = this.pendingApplications.length - 1; i >= 0; i--) {
      const pending = this.pendingApplications[i];
      pending.remaining -= dt;
      if (pending.remaining > 0) continue;

      this.pendingApplications.splice(i, 1);
      this.applyOneApplication(pending.team, pending.spell, pending.app, pending.position);
    }
  }

  /** One entry of a card's `apply` list, against whoever it catches right now. */
  private applyOneApplication(team: Team, spell: SpellCard, app: SpellApplication, position: Vec2): void {
    const targets = this.spellTargets(team, spell, position);

    if (isEffectKind(app.effect)) {
      for (const m of targets) {
        applyEffect(m, {
          kind: app.effect,
          magnitude: app.magnitude ?? 0,
          duration: app.duration ?? spell.duration,
          tickInterval: app.tickInterval,
          tickDamage: app.tickDamage,
          tickHeal: app.tickHeal,
        });

        // A cast stun has to root the body, not merely decorate it.
        // `updateMage` reads `stunTimer`, so an effect on its own would show
        // the motes over the head and let the mage walk away — the element
        // path already mirrors it for exactly this reason (see `applyOnHit`).
        if (app.effect === 'stun') {
          const duration = app.duration ?? spell.duration;
          m.stunTimer = Math.max(m.stunTimer, duration);
        }
      }
      return;
    }
    spellRiderFor(app.effect)?.(this, { team, spell, app, position, targets });
  }

  /**
   * Cuts short a mage's time off the field (GDD §4) — Chamado à Batalha.
   *
   * The floor is load-bearing and is not defensive rounding. `updateMage` only
   * decays a respawn timer it finds **above zero**, and the branch that puts
   * the body back is inside that decay. A timer cut to exactly zero is
   * therefore never touched again: the card meant to shorten a death would make
   * it permanent, and only for the mages it helped most. One tick is the
   * smallest value that still passes through the machinery that revives.
   */
  hastenRespawn(m: Mage, seconds: number): void {
    if (m.alive || seconds <= 0 || m.respawnTimer <= 0) return;
    m.respawnTimer = Math.max(SIM_DT, m.respawnTimer - seconds);
  }

  /**
   * Shoves a mage, without hurting it (GDD §9).
   *
   * The same additive velocity `dealDamage` applies, and for the same reason it
   * lives in `World` rather than in the rider that calls it: knockback is a
   * decaying slide over the stun window, and the heal interrupt hangs off how
   * hard the shove was rather than off what caused it. A rider writing to
   * `knockbackVelocity` directly would have been the second place in the
   * codebase that knows either of those things.
   *
   * Hit stun comes with it. A body flying backwards that is still calmly
   * charging a throw is the tell that this was applied to the wrong field —
   * and without the stun, `updateMage` never runs the slide at all, so the
   * velocity would be set and silently ignored.
   */
  shove(m: Mage, direction: Vec2, magnitude: number): void {
    if (magnitude <= 0 || !m.alive) return;
    const n = direction.normalized();
    if (n.lengthSq() <= 0) return;

    m.knockbackVelocity = m.knockbackVelocity.add(n.scale(magnitude));
    m.stunTimer = Math.max(m.stunTimer, HIT_STUN);
    if (magnitude >= HEAL_INTERRUPT_KNOCKBACK) {
      m.healInterruptTimer = Math.max(m.healInterruptTimer, HEAL_INTERRUPT_DURATION);
    }
  }

  /**
   * The living mages a card catches. Empty for a `ground` card, which affects
   * a place rather than people — the hazard it leaves behind is what does the
   * catching, later.
   */
  private spellTargets(team: Team, spell: SpellCard, position: Vec2): Mage[] {
    if (spell.target === 'ground') return [];

    const out: Mage[] = [];
    for (const m of this.mages.values()) {
      if (!m.alive) continue;
      if (spell.target === 'allies' && m.team !== team) continue;
      if (spell.target === 'enemies' && m.team === team) continue;
      if (m.position.distanceTo(position) > spell.radius) continue;
      out.push(m);
    }
    return out;
  }

  /** A ground hazard left by a spell (GDD §9) — Praga and everything after it. */
  spawnSpellPuddle(
    position: Vec2,
    opts: {
      /** The card responsible, for the client's benefit only; see {@link Puddle}. */
      spellId: string;
      radius: number;
      duration: number;
      tickInterval: number;
      tickDamage: number;
      bypassShield: boolean;
    },
  ): void {
    const id = `puddle-${++this.nextId}`;
    this.puddles.set(id, {
      id,
      // Not a mage id, so `kill` credits nobody — a zone cannot take a kill.
      ownerId: 'spell',
      spellId: opts.spellId,
      position,
      radius: opts.radius,
      duration: opts.duration,
      elapsed: 0,
      tickInterval: opts.tickInterval,
      tickDamage: opts.tickDamage,
      tickTimer: 0,
      alive: true,
      bypassShield: opts.bypassShield,
    });
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
    this.updateCastCooldown(dt);
    // Before movement, so a card that was warning about this tick catches the
    // squad where the player last saw them standing rather than a step on.
    this.updatePendingApplications(dt);
    // Auras are resolved before movement so a mage charges at the rate implied
    // by where the support stood at the top of this tick.
    this.updateSupportAuras();
    for (const m of this.mages.values()) this.updateMage(m, dt);
    this.applySupportHealing(dt);
    this.separateMages();
    // Local pushout first; then the planner fallback for bodies still wedged
    // between blockers where a short push cannot find an exit.
    this.freeTrappedMages();
    this.resolvePenetrations();
    this.updateStructures(dt);
    this.updateProjectiles(dt);
    this.updatePuddles(dt);
    this.updateCastFx(dt);
    this.checkMatchEnd();

    // `release` is an edge-triggered "the client let go this tick" signal; drop
    // it once processed so it can never re-fire on a later tick.
    for (const m of this.mages.values()) m.input.release = false;
  }

  private updateMage(m: Mage, dt: number): void {
    if (m.immunityTimer > 0) m.immunityTimer = decay(m.immunityTimer, dt);
    if (m.throwCooldown > 0) m.throwCooldown = decay(m.throwCooldown, dt);
    if (m.healInterruptTimer > 0) m.healInterruptTimer = decay(m.healInterruptTimer, dt);
    if (m.streakTimer > 0) {
      m.streakTimer = decay(m.streakTimer, dt);
      if (m.streakTimer === 0) {
        m.streakElement = null;
        m.streakCount = 0;
      }
    }

    const due = tickEffects(m, dt);
    if (due) {
      for (const t of due) {
        // A DoT never re-applies hit-stun: it lands several times a second, and
        // stacking HIT_STUN on every tick would silently root anyone standing
        // in it. The flinch belongs to the hit that applied the effect.
        if (t.damage > 0) this.dealDamage(m, t.damage, { attackerId: t.sourceId, noHitStun: true });
        // Overflow is discarded rather than banked: a regen cast on a healthy
        // mage is a wasted card, which is what makes timing it a decision.
        if (t.heal > 0) m.health = Math.min(m.maxHealth, m.health + t.heal);
      }
    }

    if (!m.alive) {
      if (m.respawnTimer > 0) {
        m.respawnTimer = decay(m.respawnTimer, dt);
        if (m.respawnTimer === 0) this.respawn(m);
      }
      return;
    }

    // Checked before the stun block, and without the knockback slide: a stunned
    // mage is a body being shoved, a petrified one is scenery. Nothing moves it
    // and nothing it was doing survives — the charge is dropped rather than
    // paused, so stone never resumes mid-throw when it cracks.
    if (!canAct(m) && hasEffect(m, 'petrify')) {
      m.knockbackVelocity = Vec2.zero;
      m.charge = 0;
      m.state = 'petrified';
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
      // A friendly Bard's aura makes this fill faster, a rival Bard's
      // dissonance makes it fill slower (GDD §9).
      m.charge = Math.min(1, m.charge + (dt * chargeRateMultiplier(m, m.chargeRateBonus)) / CHARGE_TIME);
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

    // Per-unit since the pivot: a Golem is slow and a Dervish is fast (GDD §9),
    // scaled by whatever slows and hastes are currently on the mage.
    const speed = m.moveSpeed * moveSpeedMultiplier(m);

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
        // Routed through resolveMove rather than a bare clamp: shoving two
        // mages apart must not shove either of them into a rock, which is one
        // of the ways they used to end up wedged inside the scenery.
        a.position = this.resolveMove(a.position, n.scale(push));
        b.position = this.resolveMove(b.position, n.scale(-push));
      }
    }
  }

  /**
   * Nudges any mage that ended up overlapping solid geometry back out of it.
   *
   * Movement itself never walks into a blocker, but knockback stacking, mage
   * separation and a spawn under a Tower all can — and once a mage is inside an
   * obstacle it is stuck for good, because `resolveMove` rejects every step out
   * of there too. This is the escape hatch, applied after the pushes that can
   * cause the overlap in the first place.
   */
  private freeTrappedMages(): void {
    for (const id of sortedMageIds(this)) {
      const m = this.mages.get(id);
      if (!m?.alive) continue;

      let p = m.position;
      // A few relaxation passes: leaving one obstacle can enter the next one,
      // which is exactly what happens in the corner between two blockers.
      for (let pass = 0; pass < DEPENETRATION_PASSES; pass++) {
        const push = this.arena
          .pushOutOfObstacles(p, MAGE_RADIUS)
          .add(this.pushOutOfStructures(p, MAGE_RADIUS));
        if (push.lengthSq() <= 1e-12) break;
        p = this.arena.clamp(p.add(push), MAGE_RADIUS);
      }

      if (p !== m.position) m.position = p;
    }
  }

  /**
   * Escape hatch for bodies still inside a blocker after local pushout — a
   * corner between a Tower and a fence can leave no short exit, and without
   * the planner fallback the mage freezes there for the rest of the match.
   */
  private resolvePenetrations(): void {
    for (const id of sortedMageIds(this)) {
      const m = this.mages.get(id);
      if (!m?.alive) continue;
      if (!this.blockedAt(m.position)) continue;
      m.position = this.freePositionNear(m.position);
    }
  }

  /** `p` itself when it is clear, otherwise the closest point that is. */
  private freePositionNear(p: Vec2): Vec2 {
    let out = p;
    for (let pass = 0; pass < DEPENETRATION_PASSES; pass++) {
      const push = this.arena
        .pushOutOfObstacles(out, MAGE_RADIUS)
        .add(this.pushOutOfStructures(out, MAGE_RADIUS));
      if (push.lengthSq() <= 1e-12) break;
      out = this.arena.clamp(out.add(push), MAGE_RADIUS);
    }

    if (!this.blockedAt(out)) return out;
    // Wedged with no local way out; fall back to the planner's nearest walkable cell.
    const free = this.pathGrid().nearestFree(out);
    return free ? this.arena.clamp(free, MAGE_RADIUS) : out;
  }

  /** {@link Arena.pushOutOfObstacles} for the live structures on the field. */
  pushOutOfStructures(p: Vec2, radius: number): Vec2 {
    let push = Vec2.zero;
    for (const s of this.structures.values()) {
      if (!s.alive) continue;
      push = push.add(pushOutOfCircle(s.position, s.radius, p, radius));
    }
    return push;
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

  /**
   * Obstacles plus live structures — a Tower is a solid body, not decoration.
   * Public because bot steering has to avoid exactly what movement rejects; a
   * planner that only knew about obstacles would walk squads into Towers.
   */
  blockedAt(p: Vec2, radius: number = MAGE_RADIUS): boolean {
    if (this.arena.blocksMovementAt(p, radius)) return true;
    for (const s of this.structures.values()) {
      if (s.alive && s.position.distanceTo(p) < s.radius + radius) return true;
    }
    return false;
  }

  /**
   * Alias of {@link blockedAt}. PathGrid docs and older call sites say
   * `isBlocked`; Brain on main already uses `blockedAt` — both names resolve
   * to the same predicate.
   */
  isBlocked(p: Vec2, radius: number = MAGE_RADIUS): boolean {
    return this.blockedAt(p, radius);
  }

  /**
   * Whether a body walking the straight line from `from` to `to` would hit
   * anything. Sampled rather than solved analytically, like
   * `Arena.hasLineOfSight`: the predicate is already inflated by a body radius,
   * so the narrowest blocking band on any map is far wider than the step below.
   */
  isBlockedSegment(from: Vec2, to: Vec2): boolean {
    const delta = to.sub(from);
    const dist = delta.length();
    if (dist < 1e-9) return this.blockedAt(from);

    const steps = Math.min(SEGMENT_SAMPLE_LIMIT, Math.ceil(dist / SEGMENT_SAMPLE_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.blockedAt(new Vec2(from.x + delta.x * t, from.y + delta.y * t))) return true;
    }
    return false;
  }

  /**
   * The shared A* grid, built lazily off `blockedAt` and rebuilt when the set of
   * solid structures changes — a fallen Tower opens a route that was closed a
   * tick earlier. Keyed on the live count rather than a dirty flag so that
   * killing a structure by hand (tests, admin tooling) invalidates it too.
   */
  pathGrid(): PathGrid {
    let blockers = 0;
    for (const s of this.structures.values()) if (s.alive) blockers++;

    if (!this.cachedPathGrid || blockers !== this.cachedPathBlockers) {
      // Planned with a margin over the body radius. A cell whose *centre* is
      // just barely clear can still have a sliver of blocker across the line to
      // the next centre, and a mage told to walk that line pushes into the
      // sliver forever. The margin buys back the error the grid introduces.
      this.cachedPathGrid = new PathGrid(this.arena, (p) =>
        this.blockedAt(p, MAGE_RADIUS + PATH_CLEARANCE),
      );
      this.cachedPathBlockers = blockers;
    }
    return this.cachedPathGrid;
  }

  /**
   * The team's `idx`-th spawn, moved off any structure standing on it. The map
   * only knows about obstacles, so a spawn point can be perfectly legal on disk
   * and still sit inside a Core.
   */
  findClearSpawn(team: Team, idx: number): Vec2 {
    return this.freePositionNear(this.arena.spawnFor(team, idx));
  }

  /* ---- Supports (GDD §9) --------------------------------------------------- */

  /**
   * Aura bonuses take the strongest applicable value rather than summing, so
   * stacking two Bards is deliberately not a strategy.
   */
  private updateSupportAuras(): void {
    // Only the proximity half lives here now: `chargeRateMultiplier` merges it
    // with the Bênção de Ímpeto buff by Math.max, so a cast spell and a Bard's
    // aura still do not stack (GDD §9's "não soma" rule, same as two Bards).
    for (const m of this.mages.values()) m.chargeRateBonus = 0;

    for (const src of this.mages.values()) {
      if (!src.alive || !src.rosterId) continue;
      const entry = rosterFor(src.rosterId);
      if (!entry?.auraChargeBonus || !entry.auraRadius) continue;

      for (const m of this.mages.values()) {
        if (m === src || !m.alive || m.team !== src.team) continue;
        if (m.position.distanceTo(src.position) <= entry.auraRadius) {
          m.chargeRateBonus = Math.max(m.chargeRateBonus, entry.auraChargeBonus);
        }
      }
    }
  }

  /** A healer tops up the single most-hurt ally in range, not everyone at once. */
  private applySupportHealing(dt: number): void {
    for (const healerId of sortedMageIds(this)) {
      const src = this.mages.get(healerId);
      if (!src?.alive || !src.rosterId) continue;
      // Shoved out of it (GDD §9): the heal resumes on its own once the timer
      // runs out — a heavy hit costs the Cleric a window, not the ability.
      if (src.healInterruptTimer > 0) continue;
      const entry = rosterFor(src.rosterId);
      if (!entry?.healPerSecond || !entry.healRange) continue;

      let best: Mage | null = null;
      let bestMissing = 0;
      for (const targetId of sortedMageIds(this)) {
        const m = this.mages.get(targetId);
        if (!m || m === src || !m.alive || m.team !== src.team) continue;
        const missing = m.maxHealth - m.health;
        if (missing <= bestMissing) continue;
        if (src.position.distanceTo(m.position) > entry.healRange) continue;
        bestMissing = missing;
        best = m;
      }

      if (best) best.health = Math.min(best.maxHealth, best.health + entry.healPerSecond * dt);
    }
  }

  /* ---- Structure behaviour (GDD §5) ---------------------------------------- */

  private updateStructures(dt: number): void {
    // Core is immune only while both Towers still stand — one flank break is
    // enough to open the Core (GDD §14: the stricter "both down" rule never
    // let a push convert in measurement).
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const bothTowersUp = this.structuresOf(team)
        .filter((s) => s.kind === 'tower')
        .every((s) => s.alive);
      for (const s of this.structuresOf(team)) {
        if (s.kind === 'core') s.invulnerable = bothTowersUp;
      }
    }

    if (this.suddenDeath) this.decayStructures(dt);

    // Sudden death stops towers shooting so the remaining seconds convert.
    if (this.suddenDeath) return;

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

  /**
   * How hard siege damage lands right now (GDD §14).
   *
   * Scaled and ramped so a committed push converts: flat mage-vs-mage damage
   * alone never adds up to a Tower break inside normal time.
   */
  siegeMultiplier(): number {
    if (this.suddenDeath) return STRUCTURE_DAMAGE_MULTIPLIER * SIEGE_RAMP_SUDDEN_DEATH;

    const progress = Math.min(1, this.elapsed / MATCH_DURATION);
    const ramp = SIEGE_RAMP_START + (SIEGE_RAMP_END - SIEGE_RAMP_START) * progress;
    return STRUCTURE_DAMAGE_MULTIPLIER * ramp;
  }

  /** The single seam for structure damage, mirroring `dealDamage` for mages. */
  damageStructure(s: Structure, amount: number): void {
    if (!s.alive || s.invulnerable) return;
    s.health -= amount * this.siegeMultiplier();
    if (s.health <= 0) {
      s.health = 0;
      s.alive = false;
    }
  }

  /**
   * Sudden-death decay. Not routed through `damageStructure` — this damage
   * belongs to nobody and must not inflate structure-damage stats/tiebreaks.
   */
  private decayStructures(dt: number): void {
    for (const id of sortedIds(this.structures.keys())) {
      const s = this.structures.get(id);
      if (!s || !s.alive || s.invulnerable) continue;

      s.health -= SUDDEN_DEATH_STRUCTURE_DECAY * dt;
      if (s.health <= 0) {
        s.health = 0;
        s.alive = false;
      }
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

    this.dealDamage(target, p.damage, {
      knockDir: dir,
      knockMag: p.knockback + (def.knockbackBonus ?? 0),
      attackerId: p.ownerId,
    });

    const streak = this.advanceStreak(target, p.element);
    for (const rule of def.onHit) {
      if (rule.trigger && !this.streakArmed(target, rule, streak)) continue;
      this.applyOnHit(rule, p, target);
    }
    if (def.splashRadius && def.splashRadius > 0) this.applySplash(p, target, def);
  }

  /**
   * Counts consecutive hits of one element on one victim (GDD §8). A hit of a
   * different element restarts the count rather than extending it, so the
   * streak means "this mage kept working the same target", not "this mage was
   * hit a lot".
   */
  private advanceStreak(target: Mage, element: ElementId): number {
    if (target.streakElement === element && target.streakTimer > 0) target.streakCount++;
    else {
      target.streakElement = element;
      target.streakCount = 1;
    }
    return target.streakCount;
  }

  /** Whether a triggered rider fires on this hit, and what that costs the streak. */
  private streakArmed(target: Mage, rule: OnHitRule, streak: number): boolean {
    const trigger = rule.trigger;
    if (!trigger) return true;
    target.streakTimer = Math.max(target.streakTimer, trigger.window);
    if (streak < trigger.hits) return false;
    if (trigger.reset) {
      // Has to be re-earned from scratch (lightning's stun), rather than held
      // at the threshold so every later hit re-applies it (fire's burn).
      target.streakCount = 0;
      target.streakElement = null;
    }
    return true;
  }

  /**
   * One rider from an element's `onHit` list (GDD §8). Riders are data, so
   * adding an element behaviour is a `balance.json` edit; only genuinely new
   * *kinds* of behaviour land here.
   */
  private applyOnHit(rule: OnHitRule, p: Projectile, target: Mage): void {
    switch (rule.effect) {
      case 'interrupt':
        if (target.charging) {
          target.charging = false;
          target.charge = 0;
        }
        break;
      case 'puddle':
        this.spawnPuddle(p.ownerId, target.position, rule);
        break;
      case 'shield_break':
        // Light does not out-damage Escudo Arcano, it undoes it (GDD §8.7) —
        // the Cleric's answer to a squad that turtles behind one.
        removeEffect(target, 'shield');
        break;
      default: {
        if (!isEffectKind(rule.effect)) break;
        applyEffect(target, {
          kind: rule.effect,
          magnitude: rule.magnitude ?? 0,
          duration: rule.duration ?? 0,
          tickInterval: rule.tickInterval,
          tickDamage: rule.tickDamage,
          sourceId: p.ownerId,
        });
        // Stun is the one effect that also drives physics: `updateMage` roots
        // off `stunTimer`, so the effect has to hand it the longer window.
        if (rule.effect === 'stun') target.stunTimer = Math.max(target.stunTimer, rule.duration ?? 0);
        break;
      }
    }
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
        this.dealDamage(m, def.damage * 0.5, {
          knockDir: m.position.sub(p.position),
          knockMag: def.knockback * 0.5,
          attackerId: p.ownerId,
        });
      }
    }
  }

  private onProjectileExpire(p: Projectile): void {
    const def = elementDefFor(p.element);
    if (!def) return;
    // Negation of space: a poison flask that never hits a mage still
    // contaminates the ground where it lands (GDD §8.5).
    const rule = def.onHit.find((r) => r.effect === 'puddle' && r.onExpire);
    if (rule) this.spawnPuddle(p.ownerId, p.position, rule);
  }

  private spawnPuddle(ownerId: string, pos: Vec2, rule: OnHitRule): void {
    const id = `puddle-${++this.nextId}`;
    this.puddles.set(id, {
      id,
      ownerId,
      // An element, not a card: the client's green default is right for it.
      spellId: null,
      position: pos,
      radius: rule.radius ?? 0,
      duration: rule.duration ?? 0,
      elapsed: 0,
      tickInterval: rule.tickInterval ?? 0,
      tickDamage: rule.tickDamage ?? 0,
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
            // `ownerId` is a mage for a poison flask and the literal 'spell' for
            // a Praga zone; `kill` sorts out which of those can score.
            this.dealDamage(m, pu.tickDamage, {
              bypassShield: pu.bypassShield === true,
              attackerId: pu.ownerId,
              // Ground DoT, same rule as burn: it ticks several times a second,
              // so re-stunning on each one would root anyone who walks in.
              noHitStun: true,
            });
          }
        }
      }

      if (pu.elapsed >= pu.duration) this.puddles.delete(id);
    }
  }

  /**
   * The single seam every damage source (projectiles, puddles) funnels
   * through, so death/respawn stay consistent everywhere. `bypassShield` is
   * for Praga's tick (GDD §9): it ignores Escudo Arcano by design.
   *
   * `attackerId` is the id of whatever caused the damage; `kill` decides on its
   * own whether that earns a kill.
   */
  dealDamage(m: Mage, amount: number, opts: DamageOptions = {}): void {
    // Stone is not a legal target, so this returns before the shield is touched
    // and before anything can be credited a kill — see `damageImmune`, which is
    // a separate question from a multiplier of zero for exactly that reason.
    if (!m.alive || m.immunityTimer > 0 || damageImmune(m)) return;

    // Arcane marks a target so the rest of the squad hits harder (GDD §8.7) —
    // applied before the shield, so vulnerability burns through Escudo Arcano
    // faster too.
    //
    // The attacker's own multiplier joins it here, resolved at the moment the
    // damage lands rather than when it was set in motion. That is the same rule
    // vulnerability already follows, and it keeps one clock for both sides of
    // the exchange. `attackerId` is not always a mage — a Tower bolt carries the
    // structure's id and a Praga zone the literal 'spell' — and neither is in
    // `mages`, so both come back unmultiplied.
    const attacker = opts.attackerId ? this.mages.get(opts.attackerId) : undefined;
    const dealt = attacker ? damageDealtMultiplier(attacker) : 1;
    // An execution mark is the one multiplier that asks about the *state* of the
    // target rather than about an effect on it, so it cannot live in
    // `damageTakenMultiplier` with the others — that function is handed a
    // carrier and has no health to read. Measured before this hit lands: a mark
    // that counted the damage it is currently applying would fire on the blow
    // that brings the target under the line rather than on the one after, which
    // is a finisher that finishes what was not yet dying.
    const mark = magnitudeOf(m, 'marked');
    const executing = mark > 0 && m.health <= m.maxHealth * EXECUTE_THRESHOLD;

    let remaining = amount * dealt * damageTakenMultiplier(m) * (executing ? 1 + mark : 1);
    // Ahead of the shield, because what is handed to the rest of the squad was
    // never this body's to absorb: the share should meet *their* shields, not
    // be eaten by one Escudo Arcano on the mage who happened to be aimed at.
    remaining = this.shareBondedDamage(m, remaining, opts);
    if (!opts.bypassShield) remaining = absorbWithShield(m, remaining);
    m.health -= remaining;

    if (opts.knockMag && opts.knockMag > 0 && opts.knockDir) {
      const n = opts.knockDir.normalized();
      if (n.lengthSq() > 0) {
        // Additive initial velocity, decayed over the stun window in
        // updateMage — not an instant teleport (see KNOCKBACK_DAMPING).
        m.knockbackVelocity = m.knockbackVelocity.add(n.scale(opts.knockMag));
      }
      // A shove that big also breaks a healer's concentration (GDD §9). Read
      // off the knockback rather than off an element list on purpose: whatever
      // is heavy enough to move a mage is heavy enough to cut its healing, and
      // re-tuning which elements qualify stays a `balance.json` edit.
      if (opts.knockMag >= HEAL_INTERRUPT_KNOCKBACK) {
        m.healInterruptTimer = Math.max(m.healInterruptTimer, HEAL_INTERRUPT_DURATION);
      }
    }
    // Never shorten a running stun: a lightning stun outlasts HIT_STUN, and a
    // graze landing during it must not cut the crowd control short.
    if (!opts.noHitStun) m.stunTimer = Math.max(m.stunTimer, HIT_STUN);

    if (m.health <= 0) this.kill(m, opts.attackerId ?? null);
    this.spreadBondedPain(m, remaining, opts);
  }

  /**
   * Vínculo de Solidariedade: `magnitude` of a hit is lifted off the body it
   * landed on and split evenly among the rest of the bond (GDD §9). Returns
   * what the struck mage is left holding.
   *
   * Nothing is lost on the way round, and that is the design rather than an
   * accident of the arithmetic. A bond that quietly shed damage in transit
   * would be a mitigation card wearing a bond's clothes, and every number in
   * the game would have to be re-read against it. What the card buys is not
   * less damage — it is that no single body falls off the field, and a death
   * costs six seconds of presence where a wound costs none.
   *
   * With nobody else left in the bond the share has nowhere to go, so the mage
   * keeps all of it: a solidarity of one is the last survivor of a squad, and
   * quietly deleting the other half of the hit would make it the toughest mage
   * in the game at exactly the wrong moment.
   */
  private shareBondedDamage(m: Mage, amount: number, opts: DamageOptions): number {
    if (this.bondEcho || amount <= 0) return amount;
    const share = magnitudeOf(m, 'bonded');
    if (share <= 0) return amount;

    const others: Mage[] = [];
    for (const id of sortedIds(this.mages.keys())) {
      const other = this.mages.get(id);
      if (!other || other === m || !other.alive || other.team !== m.team) continue;
      if (hasEffect(other, 'bonded')) others.push(other);
    }
    if (others.length === 0) return amount;

    const each = (amount * share) / others.length;
    this.bondEcho = true;
    try {
      // Credited to whoever swung, and without the flinch: the blow landed on
      // one body, and stunning three more for it would take a whole squad off
      // the field for a hit they were not in the way of.
      for (const other of others) {
        this.dealDamage(other, each, { attackerId: opts.attackerId ?? null, noHitStun: true });
      }
    } finally {
      this.bondEcho = false;
    }
    return amount * (1 - share);
  }

  /**
   * Vínculo da Dor: a share of what one bound mage took arrives on the others
   * (GDD §9).
   *
   * Spread from `remaining` — what actually landed after the multipliers and
   * after the shield ate its part — rather than from the damage that was aimed.
   * A bond that copied the raw number would pay out in full through a shield
   * that stopped the hit, which is a card doing its damage twice.
   *
   * `bondEcho` is the guard, and it is not defensive. Mirrored damage is
   * damage: without it the mirror walks straight back into `dealDamage`, finds
   * the same web, and bounces between two bodies inside a single call — for as
   * long as float arithmetic keeps shrinking it, and forever at a share of 1.
   * One hop is also the right *rule*, not merely the terminating one: the bond
   * shares what the fight did, not what the bond did.
   */
  private spreadBondedPain(source: Mage, dealt: number, opts: DamageOptions): void {
    if (this.bondEcho || dealt <= 0) return;
    const share = magnitudeOf(source, 'linked');
    if (share <= 0) return;

    this.bondEcho = true;
    try {
      for (const id of sortedIds(this.mages.keys())) {
        const other = this.mages.get(id);
        if (!other || other === source || !other.alive) continue;
        if (!hasEffect(other, 'linked')) continue;
        // Credited to whoever swung: a bond is a way of hitting four mages with
        // one throw, and the kill it eventually earns belongs to the thrower.
        this.dealDamage(other, dealt * share, {
          attackerId: opts.attackerId ?? null,
          // The flinch belongs to the body that was actually struck. Stunning a
          // whole web every time one of them is grazed would take four mages
          // off the field for a hit that landed on one.
          noHitStun: true,
        });
      }
    } finally {
      this.bondEcho = false;
    }
  }

  /**
   * Credit is deliberately narrow. `attackerId` is whatever owned the damage,
   * which is not always a mage: a Tower bolt carries the structure's id, and a
   * Praga zone carries the literal `'spell'` — neither is in `mages`, so both
   * fall through the lookup and score nothing. Poison puddles hurt both teams by
   * design (GDD §8.5), so the team check is what stops an Alquimista scoring on
   * his own squad. The victim always takes the death either way.
   */
  private kill(m: Mage, attackerId: string | null = null): void {
    m.deaths++;

    const killer = attackerId === null ? undefined : this.mages.get(attackerId);
    if (killer && killer !== m && killer.team !== m.team) killer.kills++;

    m.health = 0;
    m.alive = false;
    m.charging = false;
    m.charge = 0;
    m.knockbackVelocity = Vec2.zero;
    m.velocity = Vec2.zero;
    m.state = 'dead';
    // Squad mages always come back (GDD §4) — death costs presence on the
    // field, not the mage itself.
    m.respawnTimer = RESPAWN_DELAY;
  }

  /**
   * Note what is *not* reset here: `kills` and `deaths` are a match-long record,
   * not per-life state. Everything around them is cleared, which makes this the
   * one place someone would zero them by reflex.
   */
  private respawn(m: Mage): void {
    // Its own slot, not the first free seat: a whole squad wiped at once used
    // to come back stacked, where spacing then shoved them into the back wall.
    m.position = this.findClearSpawn(m.team, this.squadSlotOf(m));
    m.velocity = Vec2.zero;
    m.health = m.maxHealth;
    m.alive = true;
    m.state = 'idle';
    m.immunityTimer = RESPAWN_IMMUNITY;
    m.charge = 0;
    m.charging = false;
    m.stunTimer = 0;
    m.healInterruptTimer = 0;
    // A mage comes back clean: nothing that was on it survives the trip, and
    // the streak that was building toward a burn or a stun starts over.
    clearEffects(m);
    m.streakElement = null;
    m.streakCount = 0;
    m.streakTimer = 0;
  }

  /** A mage's position among its team, in id order — its spawn slot. */
  private squadSlotOf(m: Mage): number {
    let slot = 0;
    for (const id of sortedMageIds(this)) {
      const other = this.mages.get(id);
      if (!other || other.team !== m.team) continue;
      if (other === m) return slot;
      slot++;
    }
    return 0;
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
