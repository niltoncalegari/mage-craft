import type { EntityId } from '../ecs/Entity';
import type { EventBus } from '../core/EventBus';
import { DAMAGE, SIM } from '../game/config';
import type { FxKind } from '../game/effects';
import { isElementId, type ElementId } from '../game/elements';
import { launchSnowball } from '../game/Snowball';
import { rosterFor } from '../../sim/cards';
import { isRole } from '../../sim/roles';
import { type AnimationName, PlayerState, Team, type Player, type Structure } from '../game/types';
import type { World } from '../game/World';
import { rotateTowards } from '../utils/math';
import { Vector2 } from '../utils/Vector2';
import type {
  FiredRuleDTO,
  MageSnapshotDTO,
  ProjectileSnapshotDTO,
  PuddleSnapshotDTO,
  SnapshotMsg,
  SpellCastDTO,
  StructureSnapshotDTO,
} from './protocol';

/** How fast rendered position/rotation ease toward the latest snapshot, per second. */
const POSITION_SMOOTHING_RATE = 18;
const ROTATION_SMOOTHING_RATE = 12;
/**
 * Height eases rather than snapping: the arc a projectile flies is sampled at
 * 20Hz, and a spell crossing the arena in half a second would otherwise
 * visibly stair-step up and down.
 */
const HEIGHT_SMOOTHING_RATE = 22;
/** Speed (world units/sec) above which a mage is considered "moving" for animation purposes. */
const MOVE_SPEED_THRESHOLD = 0.15;

/** Whether a wire mage carries an effect of this kind (see `sim/effects.ts`). */
function hasWireFx(m: MageSnapshotDTO, kind: FxKind): boolean {
  return m.fx?.some((f) => f.k === kind) ?? false;
}

/**
 * The per-player state a siege match is played from (GDD §6, §7): everything
 * the card bar and the match clock need, none of which is derivable from the
 * rendered world. The server sends it in every snapshot, so this is always the
 * authoritative view — a rejected cast corrects itself on the next one.
 */
export interface MatchState {
  /** The local player's own mana, 0..MANA_MAX. */
  mana: number;
  /** Seconds of match time elapsed. */
  elapsed: number;
  suddenDeath: boolean;
  /** The local player's hand, in slot order. Empty while spectating. */
  hand: string[];
  /** The card entering the hand next, or null when unknown. */
  next: string | null;
  /**
   * The local player's rule that last actually cast, or null before one has.
   *
   * Since the idle pivot this is the only in-match feedback there is: nobody
   * clicked, so being told which of their own rules spent their mana is what
   * separates a match the player authored from one that merely happens near
   * them. Null for a spectator, who has no program.
   */
  firedRule: FiredRuleDTO | null;
}

/**
 * One row of the squad dashboard: everything about a mage that the render-only
 * {@link World} does not carry (identity, tally, respawn clock) plus the health
 * and status it does.
 *
 * Mutated in place every snapshot rather than reallocated — the panel reads this
 * 60 times a second and eight fresh objects per frame is pure garbage.
 */
export interface SquadMemberView {
  /** The server's mage id — what the panel keys selection on. */
  readonly wireId: string;
  /** The render world's numeric id — what the highlight ring resolves against. */
  readonly entityId: EntityId;
  /** POV-relative, so `Team.Player` is always the local commander's squad. */
  team: Team;
  rosterId: string | null;
  role: string;
  health: number;
  maxHealth: number;
  alive: boolean;
  kills: number;
  deaths: number;
  /** Seconds until it returns; 0 while alive. */
  respawnRemaining: number;
  shielded: boolean;
  hasted: boolean;
  slowed: boolean;
  immune: boolean;
}

const EMPTY_MATCH_STATE: MatchState = {
  mana: 0,
  elapsed: 0,
  suddenDeath: false,
  hand: [],
  next: null,
  firedRule: null,
};

/**
 * A projectile in flight. It is dead-reckoned between snapshots (see
 * {@link SnapshotSync.tick}) rather than teleported 20 times a second: a
 * fireball travels a full world unit between two snapshots, which reads as a
 * stutter, and its particle tail needs a continuously advancing `age` to shed
 * anything at all.
 */
interface ProjectileTrack {
  entityId: EntityId;
  targetHeight: number;
}

interface MageTrack {
  entityId: EntityId;
  targetX: number;
  targetY: number;
  targetRotation: number;
  prevX: number;
  prevY: number;
  prevHealth: number;
  /** Local clock time until which the hit pose should be held. */
  hitUntil: number;
  /** The dashboard row for this mage, updated in place from every snapshot. */
  view: SquadMemberView;
}

/**
 * Translates server `SnapshotMsg`s into a render-only {@link World}: creates/
 * updates/removes `players`/`snowballs`/`puddles` from wire data, infers the
 * bits the protocol deliberately omits (alive, animation state, POV-relative
 * team), and smooths position/rotation between the server's ~20Hz snapshots
 * for ~60fps rendering. Runs no simulation — the server is authoritative.
 *
 * Also emits the same {@link GameEvents} the offline sim's systems emit
 * (`PlayerHit`, `PlayerDefeated`, `PlayerRespawned`, `SnowballThrown`,
 * `SnowballImpact`) — inferred from snapshot deltas, since the wire protocol
 * has no discrete event messages — so `AudioManager` and the particle/pickup
 * renderers work unmodified against online matches.
 */
export class SnapshotSync {
  private readonly mageTracks = new Map<string, MageTrack>();
  /**
   * Dashboard rows in first-seen order. Squads are built once by `initSquad` and
   * no mage is ever removed, so every snapshot lists them in the same order and
   * this array is written once, on the first snapshot, then only mutated. Not
   * sorted by id on purpose — `mage-10` sorts before `mage-9`.
   */
  private readonly squadViews: SquadMemberView[] = [];
  private readonly projectileTracks = new Map<string, ProjectileTrack>();
  private readonly puddleIds = new Map<string, EntityId>();
  private readonly structureIds = new Map<string, EntityId>();
  /** Cast ids already turned into a `SpellCast` event; a cast lingers in several snapshots. */
  private readonly seenCasts = new Set<string>();
  private myTeamNumber: number | null;
  private localEntity: EntityId | null = null;
  private lastTick: number | null = null;
  /** Local wall clock (seconds), advanced by `tick()`; used for the hit-hold timer. */
  private clock = 0;
  private match: MatchState = EMPTY_MATCH_STATE;

  constructor(
    private readonly world: World,
    private readonly localPlayerId: string,
    private readonly events: EventBus,
    /**
     * Which wire team the local player commands. Since the pivot a player has no
     * mage in the arena, so it can no longer be inferred from the snapshot — and
     * guessing wrong would mirror the whole POV, showing your own Core as the
     * enemy's. Null only while spectating.
     */
    localTeam: number | null = null,
  ) {
    this.myTeamNumber = localTeam;
  }

  get localEntityId(): EntityId | null {
    return this.localEntity;
  }

  /** The latest per-player match state (mana, clock, hand) from the wire. */
  get matchState(): MatchState {
    return this.match;
  }

  /** Every mage in the match, in a match-stable order. Backs the squad panel. */
  get squad(): readonly SquadMemberView[] {
    return this.squadViews;
  }

  /**
   * Which half of the arena the local commander's own side occupies.
   *
   * Teams are mirrored by POV — your squad is always `Team.Player`, whichever
   * wire team you drew — but *positions* are not: the board renders exactly as
   * the server laid it out. So a commander seated on the right watches their own
   * blue squad on the right, and a HUD pinned to the left would be reading the
   * board backwards. Derived from where your own Core stands rather than from
   * the team number, so it stays right if a map ever seats teams differently.
   */
  get mySide(): 'left' | 'right' {
    const core = this.world.structures.find((s) => s.team === Team.Player && s.kind === 'core');
    return core && core.position.x > 0 ? 'right' : 'left';
  }

  /** The render world's id for a server mage id — how the highlight finds its mage. */
  entityIdFor(wireId: string | null): EntityId | null {
    if (wireId === null) return null;
    return this.mageTracks.get(wireId)?.entityId ?? null;
  }

  /** Whether the given wire team number (0/1) is the local player's team. */
  isMyTeam(wireTeam: number): boolean {
    return wireTeam === (this.myTeamNumber ?? 0);
  }

  applySnapshot(snap: SnapshotMsg): void {
    if (this.myTeamNumber === null) {
      const mine = snap.mages.find((m) => m.id === this.localPlayerId);
      if (mine) this.myTeamNumber = mine.team;
    }

    const dtSim = this.lastTick !== null ? Math.max(0, (snap.tick - this.lastTick) / SIM.hz) : 0;
    this.lastTick = snap.tick;
    this.world.time = snap.tick / SIM.hz;

    this.match = {
      mana: snap.mana,
      elapsed: snap.elapsed,
      suddenDeath: snap.suddenDeath,
      hand: snap.hand ?? [],
      next: snap.next ?? null,
      // Handed straight through rather than copied into a retained object: the
      // wire message is already a fresh parse, so referencing it costs nothing
      // and the HUD reads it at most 20 times a second.
      firedRule: snap.firedRule ?? null,
    };

    this.syncMages(snap.mages, dtSim);
    this.syncProjectiles(snap.projectiles);
    this.syncPuddles(snap.puddles);
    this.syncStructures(snap.structures);
    this.syncSpellCasts(snap.spells ?? []);
  }

  /** Per-rAF-frame smoothing toward the latest authoritative snapshot. */
  tick(dt: number): void {
    this.clock += dt;
    const t = 1 - Math.exp(-POSITION_SMOOTHING_RATE * dt);
    for (const track of this.mageTracks.values()) {
      const player = this.world.getPlayer(track.entityId);
      if (!player) continue;
      player.position.x += (track.targetX - player.position.x) * t;
      player.position.y += (track.targetY - player.position.y) * t;
      player.rotation = rotateTowards(player.rotation, track.targetRotation, ROTATION_SMOOTHING_RATE * dt);
      player.animationTime += dt;
    }

    this.advanceProjectiles(dt);
  }

  /**
   * Carries projectiles forward along their own velocity between snapshots and
   * ages them. Nothing else advances them online — there is no local
   * ProjectileSystem — so without this a spell both stutters and, because the
   * particle tail is spawned off `age`, sheds no trail whatsoever.
   */
  private advanceProjectiles(dt: number): void {
    const heightT = 1 - Math.exp(-HEIGHT_SMOOTHING_RATE * dt);
    for (const track of this.projectileTracks.values()) {
      const snowball = this.world.snowballs.find((s) => s.id === track.entityId);
      if (!snowball) continue;
      snowball.position.x += snowball.velocity.x * dt;
      snowball.position.y += snowball.velocity.y * dt;
      snowball.height += (track.targetHeight - snowball.height) * heightT;
      snowball.age += dt;
    }
  }

  private teamOf(wireTeam: number): Team {
    const mine = this.myTeamNumber ?? 0;
    return wireTeam === mine ? Team.Player : Team.Enemy;
  }

  private syncMages(mages: MageSnapshotDTO[], dtSim: number): void {
    const seen = new Set<string>();
    for (const m of mages) {
      seen.add(m.id);
      const track = this.mageTracks.get(m.id) ?? this.createMageTrack(m);
      this.applyMageSnapshot(track, m, dtSim);
    }
    for (const [wireId, track] of this.mageTracks) {
      if (seen.has(wireId)) continue;
      const idx = this.world.players.findIndex((p) => p.id === track.entityId);
      if (idx !== -1) this.world.players.splice(idx, 1);
      if (track.entityId === this.localEntity) this.localEntity = null;
      // Never taken in a real match — squads are permanent (GDD §4) — but the
      // dashboard must not keep a row for a mage the server stopped sending.
      const row = this.squadViews.indexOf(track.view);
      if (row !== -1) this.squadViews.splice(row, 1);
      this.mageTracks.delete(wireId);
    }
  }

  private createMageTrack(m: MageSnapshotDTO): MageTrack {
    const player = this.world.addPlayer(this.teamOf(m.team), m.position.x, m.position.y);
    player.rotation = Math.atan2(m.facing.y, m.facing.x);
    player.selected = m.id === this.localPlayerId;
    if (player.selected) this.localEntity = player.id;

    // Identity, not state: a mage's element and role never change, so they are
    // read once here rather than every snapshot. Both arrive as bare strings on
    // the wire; anything the client does not recognize stays undefined and the
    // renderer falls back to the team look instead of throwing.
    player.element = isElementId(m.element) ? m.element : undefined;
    player.role = isRole(m.role) ? m.role : undefined;

    const view: SquadMemberView = {
      wireId: m.id,
      entityId: player.id,
      team: player.team,
      rosterId: m.rosterId ?? null,
      role: m.role,
      health: m.health,
      maxHealth: m.maxHealth,
      alive: m.health > 0,
      kills: m.kills,
      deaths: m.deaths,
      respawnRemaining: m.respawnRemaining ?? 0,
      shielded: hasWireFx(m, 'shield'),
      hasted: hasWireFx(m, 'haste'),
      slowed: hasWireFx(m, 'slow'),
      immune: m.immune ?? false,
    };
    this.squadViews.push(view);

    const track: MageTrack = {
      entityId: player.id,
      targetX: m.position.x,
      targetY: m.position.y,
      targetRotation: player.rotation,
      prevX: m.position.x,
      prevY: m.position.y,
      prevHealth: m.health,
      hitUntil: 0,
      view,
    };
    this.mageTracks.set(m.id, track);
    return track;
  }

  private applyMageSnapshot(track: MageTrack, m: MageSnapshotDTO, dtSim: number): void {
    const player = this.world.getPlayer(track.entityId);
    if (!player) return;

    // Respawn teleports the sim mage to a spawn pad; easing that jump would
    // drag the fallen body across the arena. Snap pose + zero velocity instead.
    const respawned = track.prevHealth <= 0 && m.health > 0;

    player.team = this.teamOf(m.team);
    player.health = m.health;
    // The three booleans are derived rather than sent: the wire carries the
    // whole effect list now, and the renderers that predate it still only ask
    // about these three.
    player.fx = (m.fx ?? []).map((f) => ({ kind: f.k, stacks: f.s ?? 1 }));
    const wasShielded = player.shielded === true;
    player.shielded = hasWireFx(m, 'shield');
    player.hasted = hasWireFx(m, 'haste');
    player.slowed = hasWireFx(m, 'slow');
    player.alive = m.health > 0;

    // Falling edge: a shield that vanished while the mage is still standing was
    // broken (a Cleric's light, or absorbed through), not expired with it. The
    // wire has no event channel, so the client infers it the same way it infers
    // a hit from a health drop.
    if (wasShielded && !player.shielded && player.alive) {
      this.events.emit('ShieldBroken', { playerId: player.id, x: m.position.x, y: m.position.y });
    }

    const view = track.view;
    view.team = player.team;
    view.rosterId = m.rosterId ?? null;
    view.role = m.role;
    view.health = m.health;
    view.maxHealth = m.maxHealth;
    view.alive = player.alive;
    view.kills = m.kills;
    view.deaths = m.deaths;
    view.respawnRemaining = m.respawnRemaining ?? 0;
    view.shielded = player.shielded;
    view.hasted = player.hasted;
    view.slowed = player.slowed;
    view.immune = m.immune ?? false;

    track.targetX = m.position.x;
    track.targetY = m.position.y;
    track.targetRotation = Math.atan2(m.facing.y, m.facing.x);

    if (respawned) {
      player.position.set(m.position.x, m.position.y);
      player.rotation = track.targetRotation;
      player.velocity.set(0, 0);
      this.events.emit('PlayerRespawned', {
        playerId: player.id,
        x: m.position.x,
        y: m.position.y,
      });
    } else if (dtSim > 0) {
      player.velocity.set((m.position.x - track.prevX) / dtSim, (m.position.y - track.prevY) / dtSim);
    }

    // Deliberately outside the animation chain below: being healed is not a
    // pose, and folding it in there would cost the mage its walk/charge
    // animation for the tick it happened to be topped up on.
    if (player.alive && !respawned && m.health > track.prevHealth) {
      // Health only ever goes up from a heal, and the wire never says who did
      // it — the healer is inferred the way the sim picks its target, so the
      // beam lands on the pair a player would have guessed anyway.
      this.events.emit('MageHealed', {
        playerId: player.id,
        healerId: this.findHealerFor(player),
        x: m.position.x,
        y: m.position.y,
      });
    }

    if (!player.alive) {
      if (track.prevHealth > 0) {
        this.events.emit('PlayerDefeated', { playerId: player.id, team: player.team });
      }
      this.setAnimation(player, PlayerState.Defeated, 'defeated');
    } else if (this.clock < track.hitUntil) {
      this.setAnimation(player, PlayerState.Hit, 'hit');
    } else if (m.health < track.prevHealth) {
      track.hitUntil = this.clock + DAMAGE.stun;
      this.events.emit('PlayerHit', {
        playerId: player.id,
        attackerId: player.id,
        damage: track.prevHealth - m.health,
        x: m.position.x,
        y: m.position.y,
      });
      this.setAnimation(player, PlayerState.Hit, 'hit');
    } else if (m.charging) {
      player.aimDirection.set(m.facing.x, m.facing.y);
      player.throwCharge = m.charge;
      this.setAnimation(player, PlayerState.PreparingThrow, 'throw');
    } else {
      player.throwCharge = 0;
      const moving = player.velocity.length() > MOVE_SPEED_THRESHOLD;
      this.setAnimation(player, moving ? PlayerState.Moving : PlayerState.Idle, moving ? 'walk' : 'idle');
    }

    track.prevHealth = m.health;
    track.prevX = m.position.x;
    track.prevY = m.position.y;
  }

  /**
   * The Cleric most likely responsible for topping `target` up: the closest
   * living ally carrying the holy element, within its heal range. Mirrors
   * `World.healPulse`'s range check rather than its "most hurt ally" pick,
   * because from here the *healed* mage is the known end of the pair.
   *
   * Returns null when nothing qualifies — a pickup or a cast spell also raises
   * health, and drawing a beam from nobody would be a lie.
   */
  private findHealerFor(target: Player): EntityId | null {
    const range = rosterFor('cleric')?.healRange ?? 0;
    if (range <= 0) return null;

    let best: EntityId | null = null;
    let bestDistanceSq = range * range;
    for (const other of this.world.players) {
      if (other === target || !other.alive || other.team !== target.team) continue;
      if (other.element !== 'holy') continue;

      const dx = other.position.x - target.position.x;
      const dy = other.position.y - target.position.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > bestDistanceSq) continue;
      bestDistanceSq = distanceSq;
      best = other.id;
    }
    return best;
  }

  private setAnimation(player: Player, state: PlayerState, animation: AnimationName): void {
    if (player.currentAnimation !== animation) {
      player.currentAnimation = animation;
      player.animationTime = 0;
    }
    player.state = state;
  }

  private syncProjectiles(projectiles: ProjectileSnapshotDTO[]): void {
    const seen = new Set<string>();
    for (const p of projectiles) {
      seen.add(p.id);
      const track = this.projectileTracks.get(p.id);
      const existing = track ? this.world.snowballs.find((s) => s.id === track.entityId) : undefined;
      if (existing && track) {
        existing.position.set(p.position.x, p.position.y);
        existing.velocity.set(p.velocity.x, p.velocity.y);
        existing.radius = p.radius;
        track.targetHeight = p.height;
        continue;
      }

      const dir = new Vector2(p.velocity.x, p.velocity.y);
      const speed = dir.length();
      dir.normalize();
      const snowball = this.world.acquireSnowball();
      const element = isElementId(p.element) ? p.element : undefined;
      launchSnowball(
        snowball,
        this.world.ids.allocate(),
        0,
        Team.Player,
        p.position.x,
        p.position.y,
        p.height,
        dir,
        speed,
        0,
        element,
      );
      snowball.radius = p.radius;
      this.projectileTracks.set(p.id, { entityId: snowball.id, targetHeight: p.height });
      this.events.emit('SnowballThrown', { snowballId: snowball.id, ownerId: snowball.id, team: Team.Player });
    }

    for (const [wireId, track] of this.projectileTracks) {
      if (seen.has(wireId)) continue;
      const idx = this.world.snowballs.findIndex((s) => s.id === track.entityId);
      // The wire has no discrete impact message — a projectile just stops
      // appearing in the snapshot — so its last known position/element has to
      // be read off the snowball before it's released back to the pool.
      let x = 0;
      let y = 0;
      let impactElement: ElementId | undefined;
      if (idx !== -1) {
        const [snowball] = this.world.snowballs.splice(idx, 1);
        x = snowball.position.x;
        y = snowball.position.y;
        impactElement = snowball.element;
        this.world.snowballPool.release(snowball);
      }
      this.projectileTracks.delete(wireId);
      this.events.emit('SnowballImpact', {
        snowballId: track.entityId,
        x,
        y,
        hitPlayerId: null,
        element: impactElement,
      });
    }
  }

  /**
   * Fires one `SpellCast` per cast id. The server keeps a cast in the snapshot
   * for a second (see SPELL_CAST_FX_DURATION) so a client cannot miss it
   * between two 20Hz frames, which means the same cast arrives many times —
   * `seenCasts` is what makes it a one-shot event.
   */
  private syncSpellCasts(spells: SpellCastDTO[]): void {
    const seen = new Set<string>();
    for (const fx of spells) {
      seen.add(fx.id);
      if (this.seenCasts.has(fx.id)) continue;
      this.seenCasts.add(fx.id);
      this.events.emit('SpellCast', {
        spellId: fx.spellId,
        x: fx.position.x,
        y: fx.position.y,
        radius: fx.radius,
        friendly: this.isMyTeam(fx.team),
      });
    }

    for (const id of this.seenCasts) {
      if (!seen.has(id)) this.seenCasts.delete(id);
    }
  }

  /**
   * Cores and Towers. Unlike every other entity these are created once and then
   * only ever change health — a destroyed structure keeps arriving with
   * `alive: false` so the renderer can leave rubble behind.
   */
  private syncStructures(structures: StructureSnapshotDTO[]): void {
    for (const s of structures) {
      const entityId = this.structureIds.get(s.id);
      const existing =
        entityId !== undefined ? this.world.structures.find((x) => x.id === entityId) : undefined;
      const target =
        existing ??
        (() => {
          const created: Structure = {
            id: this.world.ids.allocate(),
            team: this.teamOf(s.team),
            kind: s.kind === 'core' ? 'core' : 'tower',
            position: new Vector2(s.position.x, s.position.y),
            radius: s.radius,
            health: s.health,
            maxHealth: s.maxHealth,
            alive: s.alive,
            invulnerable: s.invulnerable,
          };
          this.world.structures.push(created);
          this.structureIds.set(s.id, created.id);
          return created;
        })();

      target.team = this.teamOf(s.team);
      target.health = s.health;
      target.maxHealth = s.maxHealth;
      target.alive = s.alive;
      target.invulnerable = s.invulnerable;
    }
  }

  private syncPuddles(puddles: PuddleSnapshotDTO[]): void {
    const seen = new Set<string>();
    for (const p of puddles) {
      seen.add(p.id);
      const entityId = this.puddleIds.get(p.id);
      const existing = entityId !== undefined ? this.world.puddles.find((x) => x.id === entityId) : undefined;
      if (existing) {
        existing.position.set(p.position.x, p.position.y);
        existing.radius = p.radius;
        existing.remaining = p.remaining;
        continue;
      }

      const puddle = {
        id: this.world.ids.allocate(),
        position: new Vector2(p.position.x, p.position.y),
        radius: p.radius,
        remaining: p.remaining,
      };
      this.world.puddles.push(puddle);
      this.puddleIds.set(p.id, puddle.id);
    }

    for (const [wireId, entityId] of this.puddleIds) {
      if (seen.has(wireId)) continue;
      const idx = this.world.puddles.findIndex((x) => x.id === entityId);
      if (idx !== -1) this.world.puddles.splice(idx, 1);
      this.puddleIds.delete(wireId);
    }
  }
}
