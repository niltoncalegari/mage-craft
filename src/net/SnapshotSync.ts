import type { EntityId } from '../ecs/Entity';
import type { EventBus } from '../core/EventBus';
import { DAMAGE, SIM } from '../game/config';
import { isElementId, type ElementId } from '../game/elements';
import { launchSnowball } from '../game/Snowball';
import { type AnimationName, PlayerState, Team, type Player, type Structure } from '../game/types';
import type { World } from '../game/World';
import { rotateTowards } from '../utils/math';
import { Vector2 } from '../utils/Vector2';
import type {
  MageSnapshotDTO,
  ProjectileSnapshotDTO,
  PuddleSnapshotDTO,
  SnapshotMsg,
  StructureSnapshotDTO,
} from './protocol';

/** How fast rendered position/rotation ease toward the latest snapshot, per second. */
const POSITION_SMOOTHING_RATE = 18;
const ROTATION_SMOOTHING_RATE = 12;
/** Speed (world units/sec) above which a mage is considered "moving" for animation purposes. */
const MOVE_SPEED_THRESHOLD = 0.15;

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
}

const EMPTY_MATCH_STATE: MatchState = {
  mana: 0,
  elapsed: 0,
  suddenDeath: false,
  hand: [],
  next: null,
};

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
}

/**
 * Translates server `SnapshotMsg`s into a render-only {@link World}: creates/
 * updates/removes `players`/`snowballs`/`puddles` from wire data, infers the
 * bits the protocol deliberately omits (alive, animation state, POV-relative
 * team), and smooths position/rotation between the server's ~20Hz snapshots
 * for ~60fps rendering. Runs no simulation — the server is authoritative.
 *
 * Also emits the same {@link GameEvents} the offline sim's systems emit
 * (`PlayerHit`, `PlayerDefeated`, `SnowballThrown`, `SnowballImpact`) —
 * inferred from snapshot deltas, since the wire protocol has no discrete
 * event messages — so `AudioManager` and the particle/pickup renderers work
 * unmodified against online matches.
 */
export class SnapshotSync {
  private readonly mageTracks = new Map<string, MageTrack>();
  private readonly projectileIds = new Map<string, EntityId>();
  private readonly puddleIds = new Map<string, EntityId>();
  private readonly structureIds = new Map<string, EntityId>();
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
    };

    this.syncMages(snap.mages, dtSim);
    this.syncProjectiles(snap.projectiles);
    this.syncPuddles(snap.puddles);
    this.syncStructures(snap.structures);
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
      this.mageTracks.delete(wireId);
    }
  }

  private createMageTrack(m: MageSnapshotDTO): MageTrack {
    const player = this.world.addPlayer(this.teamOf(m.team), m.position.x, m.position.y);
    player.rotation = Math.atan2(m.facing.y, m.facing.x);
    player.selected = m.id === this.localPlayerId;
    if (player.selected) this.localEntity = player.id;

    const track: MageTrack = {
      entityId: player.id,
      targetX: m.position.x,
      targetY: m.position.y,
      targetRotation: player.rotation,
      prevX: m.position.x,
      prevY: m.position.y,
      prevHealth: m.health,
      hitUntil: 0,
    };
    this.mageTracks.set(m.id, track);
    return track;
  }

  private applyMageSnapshot(track: MageTrack, m: MageSnapshotDTO, dtSim: number): void {
    const player = this.world.getPlayer(track.entityId);
    if (!player) return;

    player.team = this.teamOf(m.team);
    player.health = m.health;
    player.shielded = m.shielded;
    player.alive = m.health > 0;
    if (dtSim > 0) {
      player.velocity.set((m.position.x - track.prevX) / dtSim, (m.position.y - track.prevY) / dtSim);
    }

    track.targetX = m.position.x;
    track.targetY = m.position.y;
    track.targetRotation = Math.atan2(m.facing.y, m.facing.x);

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
      const entityId = this.projectileIds.get(p.id);
      const existing = entityId !== undefined ? this.world.snowballs.find((s) => s.id === entityId) : undefined;
      if (existing) {
        existing.position.set(p.position.x, p.position.y);
        existing.velocity.set(p.velocity.x, p.velocity.y);
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
        0,
        dir,
        speed,
        0,
        element,
      );
      this.projectileIds.set(p.id, snowball.id);
      this.events.emit('SnowballThrown', { snowballId: snowball.id, ownerId: snowball.id, team: Team.Player });
    }

    for (const [wireId, entityId] of this.projectileIds) {
      if (seen.has(wireId)) continue;
      const idx = this.world.snowballs.findIndex((s) => s.id === entityId);
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
      this.projectileIds.delete(wireId);
      this.events.emit('SnowballImpact', { snowballId: entityId, x, y, hitPlayerId: null, element: impactElement });
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
