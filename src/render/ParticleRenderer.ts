import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameRenderer } from '../core/Game';
import type { EntityId } from '../ecs/Entity';
import type { AssetManager } from '../engine/AssetManager';
import { PLAYER, SNOWBALL, TEAM_COLORS, BUFF_COLORS } from '../game/config';
import type { ElementId } from '../game/elements';
import type { Player, Puddle, Snowball } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';

const SNOWBALL_POOL_SIZE = 64;
const PARTICLE_POOL_SIZE = 900;
const FOOTPRINT_POOL_SIZE = 64;
const SPARKLE_POOL_SIZE = 72;
const RING_POOL_SIZE = 20;
const PLAYER_FX_STATE_SIZE = 32;
const PARTICLE_DT = 1 / 60;
const PARTICLE_GRAVITY = 7.5;
const TRAIL_LIFE = 0.34;
const BURST_LIFE = 0.55;
/** Particles spawned per flight tick, forming the tail (GDD §17 — the tail is particles, not a solid mesh). */
const TAIL_STREAK_COUNT = 3;
const FOOTPRINT_INTERVAL = 0.22;
const FOOTPRINT_LIFE = 3.8;
const FOOTPRINT_SIDE_OFFSET = 0.16;
const FOOTPRINT_MOVE_THRESHOLD_SQ = (PLAYER.moveSpeed * 0.12) ** 2;
const PUFF_COOLDOWN = 0.28;
const SHARP_TURN_COS = 0.25;
const SPARKLE_TWO_PI = Math.PI * 2;
const WHITE = 0xffffff;
const SMOKE_COLOR = 0x33302c;
const FOOTPRINT_COLOR = 0x86a5b8;
const RING_LIFT = 0.05;
const BUBBLE_MIN_INTERVAL = 0.05;
const BUBBLE_MAX_INTERVAL = 0.13;
const BUBBLE_COLOR = 0x80b918;
const BUBBLE_POP_COLOR = 0xa6ff5c;

/**
 * Per-element look (GDD §17: "efeito ativo tem que ser visível"). One entry
 * drives the projectile's own material, the particle tail it sheds in
 * flight, and its impact burst/shockwave — so a fireball, a frost shard and
 * a poison flask read as different spells at a glance, not as the same white
 * ball recolored.
 */
interface ElementVfx {
  /** Projectile body color + emissive glow. */
  core: number;
  glow: number;
  /** Particles shed continuously along the flight path. */
  trailColor: number;
  trailSize: number;
  /** Particles per second while airborne. */
  trailRate: number;
  /** Impact burst. */
  impactColors: readonly number[];
  impactCount: number;
  impactSpeed: number;
  gravityScale: number;
  /** Cosmetic-only scale multiplier on the projectile mesh. */
  visualScale: number;
  /** Expanding shockwave ring on impact. */
  ring: boolean;
  ringScale: number;
  /** Rising smoke puff on a ground/obstacle miss. */
  smoke: boolean;
}

/** Legacy offline snowball (no element): pixel-identical to the pre-VFX-pass look. */
const DEFAULT_VFX: ElementVfx = {
  core: WHITE,
  glow: WHITE,
  trailColor: WHITE,
  trailSize: 0.1,
  trailRate: 18,
  impactColors: [WHITE],
  impactCount: 8,
  impactSpeed: 1.5,
  gravityScale: 1,
  visualScale: 1,
  ring: false,
  ringScale: 0,
  smoke: false,
};

const ELEMENT_VFX: Readonly<Record<ElementId, ElementVfx>> = {
  fire: {
    core: 0xffb238,
    glow: 0xff5a1f,
    trailColor: 0xff7a1a,
    trailSize: 0.11,
    trailRate: 30,
    impactColors: [0xffcf6b, 0xff6a2e, 0xff3d1a],
    impactCount: 16,
    impactSpeed: 2.6,
    gravityScale: 1,
    visualScale: 1.05,
    ring: true,
    ringScale: 2.4,
    smoke: true,
  },
  ice: {
    core: 0xd8f7ff,
    glow: 0x4cc9f0,
    trailColor: 0x8fe3ff,
    trailSize: 0.08,
    trailRate: 24,
    impactColors: [0xbdf1ff, 0x4cc9f0, 0xffffff],
    impactCount: 14,
    impactSpeed: 2.2,
    gravityScale: 0.8,
    visualScale: 0.95,
    ring: true,
    ringScale: 1.8,
    smoke: false,
  },
  lightning: {
    core: 0xffffff,
    glow: 0xffe066,
    trailColor: 0xfff275,
    trailSize: 0.06,
    trailRate: 44,
    impactColors: [0xffffff, 0xffe066, 0xffd60a],
    impactCount: 18,
    impactSpeed: 3.6,
    gravityScale: 0.6,
    visualScale: 0.85,
    ring: true,
    ringScale: 1.6,
    smoke: false,
  },
  poison: {
    core: 0xcdf27a,
    glow: 0x80b918,
    trailColor: 0x9bd63d,
    trailSize: 0.09,
    trailRate: 20,
    impactColors: [0xb6e84a, 0x80b918, 0x5c8a12],
    impactCount: 12,
    impactSpeed: 1.6,
    gravityScale: 1.3,
    visualScale: 1.05,
    ring: false,
    ringScale: 0,
    smoke: false,
  },
  stone: {
    core: 0xc7cdd6,
    glow: 0x8d99ae,
    trailColor: 0x9aa4b2,
    trailSize: 0.1,
    trailRate: 10,
    impactColors: [0xdbe6f2, 0x8d99ae, 0x6b7480],
    impactCount: 14,
    impactSpeed: 2.1,
    gravityScale: 1.4,
    visualScale: 1.35,
    ring: true,
    ringScale: 1.4,
    smoke: true,
  },
  arcane: {
    core: 0xe6d1ff,
    glow: 0x9b5de5,
    trailColor: 0xc9a6f5,
    trailSize: 0.1,
    trailRate: 26,
    impactColors: [0xe6d1ff, 0x9b5de5, 0x6a2fb0],
    impactCount: 16,
    impactSpeed: 2.4,
    gravityScale: 0.7,
    visualScale: 1.05,
    ring: true,
    ringScale: 2.0,
    smoke: false,
  },
  wind: {
    core: 0xf3fbfb,
    glow: 0xa8dadc,
    trailColor: 0xd7f1f2,
    trailSize: 0.07,
    trailRate: 22,
    impactColors: [0xf3fbfb, 0xa8dadc, 0xffffff],
    impactCount: 14,
    impactSpeed: 3.0,
    gravityScale: 0.4,
    visualScale: 0.85,
    ring: true,
    ringScale: 2.6,
    smoke: false,
  },
};

function vfxFor(element: ElementId | undefined): ElementVfx {
  return element ? ELEMENT_VFX[element] : DEFAULT_VFX;
}

interface SnowballSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  snowballId: number;
  lastTrailTick: number;
}

interface ParticleSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  /** Multiplier on world gravity; <1 lets smoke/bubbles hang and drift up longer. */
  gravityScale: number;
  active: boolean;
}

interface FootprintSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  active: boolean;
}

interface SparkleSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  x: number;
  y: number;
  height: number;
  vx: number;
  vy: number;
  fall: number;
  phase: number;
  phaseSpeed: number;
  size: number;
}

/** Flat, expanding shockwave ring — the "explosion" beat under an impact burst. */
interface RingSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  maxScale: number;
  active: boolean;
}

interface PlayerFxState {
  playerId: number;
  footprintTimer: number;
  puffCooldown: number;
  side: number;
  wasMoving: boolean;
  lastVx: number;
  lastVy: number;
}

/**
 * Observes snowball simulation data and combat events, rendering pooled flying
 * projectiles (with a per-element glow and a particle tail shed in flight),
 * snow trails, hit puffs, impact bursts/shockwaves and poison-puddle bubbles
 * — without mutating world state.
 */
export class ParticleRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly snowballSlots: SnowballSlot[] = [];
  private readonly particleSlots: ParticleSlot[] = [];
  private readonly footprintSlots: FootprintSlot[] = [];
  private readonly sparkleSlots: SparkleSlot[] = [];
  private readonly ringSlots: RingSlot[] = [];
  private readonly playerFxStates: PlayerFxState[] = [];
  private readonly puddleBubbleTimers = new Map<EntityId, number>();
  private readonly defaultBallMaterial: THREE.MeshStandardMaterial;
  private readonly offSnowballImpact: () => void;
  private readonly offPlayerHit: () => void;
  private readonly offSnowballThrown: () => void;
  private readonly offBuffPickedUp: () => void;
  private readonly offPlayerRespawned: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
    events: EventBus,
  ) {
    this.group.name = 'ParticleRenderer';
    this.scene.add(this.group);

    const snowballGeometry = assets.geometry(
      'particle-renderer-snowball-sphere',
      () => new THREE.SphereGeometry(1, 12, 10),
    );
    this.defaultBallMaterial = assets.standardMaterial(WHITE, false);
    const particleGeometry = assets.geometry(
      'particle-renderer-puff-sphere',
      () => new THREE.SphereGeometry(1, 8, 6),
    );
    const footprintGeometry = assets.geometry('particle-renderer-footprint-disc', () => {
      const geometry = new THREE.CircleGeometry(1, 12);
      geometry.rotateX(-Math.PI * 0.5);
      return geometry;
    });
    const sparkleGeometry = assets.geometry(
      'particle-renderer-sparkle-sphere',
      () => new THREE.SphereGeometry(1, 6, 4),
    );
    const ringGeometry = assets.geometry('particle-renderer-shock-ring', () => {
      const geometry = new THREE.RingGeometry(0.55, 1, 32);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    });

    for (let i = 0; i < SNOWBALL_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(snowballGeometry, this.defaultBallMaterial);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);

      this.snowballSlots.push({ mesh, snowballId: -1, lastTrailTick: -1 });
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(particleGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.particleSlots.push({
        mesh,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        gravityScale: 1,
        active: false,
      });
    }

    for (let i = 0; i < FOOTPRINT_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: FOOTPRINT_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(footprintGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.footprintSlots.push({
        mesh,
        life: 0,
        maxLife: FOOTPRINT_LIFE,
        active: false,
      });
    }

    for (let i = 0; i < SPARKLE_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkleGeometry, material);
      this.group.add(mesh);
      const slot = this.createSparkleSlot(mesh, i);
      mesh.position.set(slot.x, slot.height, slot.y);
      mesh.scale.setScalar(slot.size);
      this.sparkleSlots.push(slot);
    }

    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.ringSlots.push({ mesh, life: 0, maxLife: 1, maxScale: 1, active: false });
    }

    for (let i = 0; i < PLAYER_FX_STATE_SIZE; i++) {
      this.playerFxStates.push({
        playerId: -1,
        footprintTimer: 0,
        puffCooldown: 0,
        side: 1,
        wasMoving: false,
        lastVx: 0,
        lastVy: 0,
      });
    }

    this.offSnowballImpact = events.on('SnowballImpact', (event) => {
      if (!event.element) {
        // Legacy offline snowball: no elemental catalog, keep the original look.
        this.spawnBurst(event.x, event.y, 0.18, WHITE, event.hitPlayerId === null ? 8 : 6);
        if (event.hitPlayerId === null) this.spawnSnowPuff(event.x, event.y, 7);
        return;
      }

      const cfg = ELEMENT_VFX[event.element];
      const count = event.hitPlayerId === null ? cfg.impactCount : Math.round(cfg.impactCount * 0.7);
      this.spawnElementBurst(event.x, event.y, 0.2, cfg, count);
      if (event.hitPlayerId === null && cfg.smoke) this.spawnSmoke(event.x, event.y, 6);
      if (cfg.ring) this.spawnRing(event.x, event.y, cfg.glow, cfg.ringScale);
    });
    this.offPlayerHit = events.on('PlayerHit', (event) => {
      this.spawnBurst(event.x, event.y, 0.55, this.teamColorForPlayer(event.attackerId), 9);
      this.spawnRing(event.x, event.y, WHITE, 1.1, 0.16);
    });
    this.offSnowballThrown = events.on('SnowballThrown', (event) => {
      const snowball = this.findSnowball(event.snowballId);
      if (!snowball) return;
      const cfg = vfxFor(snowball.element);
      toThree(this.tmp, snowball.position.x, snowball.position.y, snowball.height);
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        0,
        0.45,
        0,
        cfg.trailSize,
        TRAIL_LIFE,
        cfg.trailColor,
        cfg.gravityScale,
      );
      if (snowball.element) {
        this.spawnElementBurst(snowball.position.x, snowball.position.y, snowball.height, cfg, 7, 0.55);
      }
    });
    this.offBuffPickedUp = events.on('BuffPickedUp', (event) => {
      const color = BUFF_COLORS[event.buff];
      this.spawnBurst(event.x, event.y, 0.7, color, 14);
      this.spawnSnowPuff(event.x, event.y, 6);
      this.spawnRing(event.x, event.y, color, 1.6, 0.3);
    });
    this.offPlayerRespawned = events.on('PlayerRespawned', (event) => {
      this.spawnBurst(event.x, event.y, 0.8, BUFF_COLORS.immunity, 16);
      this.spawnSnowPuff(event.x, event.y, 9);
      this.spawnRing(event.x, event.y, BUFF_COLORS.immunity, 2.0, 0.4);
    });
  }

  sync(alpha: number): void {
    void alpha;
    let visibleSnowballs = 0;

    for (const snowball of this.world.snowballs) {
      if (!snowball.alive || visibleSnowballs >= SNOWBALL_POOL_SIZE) continue;
      const slot = this.snowballSlots[visibleSnowballs];
      this.updateSnowballSlot(slot, snowball);
      visibleSnowballs++;
    }

    for (let i = visibleSnowballs; i < SNOWBALL_POOL_SIZE; i++) {
      const slot = this.snowballSlots[i];
      slot.mesh.visible = false;
      slot.snowballId = -1;
      slot.lastTrailTick = -1;
    }

    this.updatePlayerEffects();
    this.updateParticles();
    this.updateFootprints();
    this.updateSparkles();
    this.updateRings();
    this.updatePuddleBubbles();
  }

  dispose(): void {
    this.offSnowballImpact();
    this.offPlayerHit();
    this.offSnowballThrown();
    this.offBuffPickedUp();
    this.offPlayerRespawned();
    this.scene.remove(this.group);

    for (const particle of this.particleSlots) {
      particle.mesh.material.dispose();
    }
    for (const footprint of this.footprintSlots) {
      footprint.mesh.material.dispose();
    }
    for (const sparkle of this.sparkleSlots) {
      sparkle.mesh.material.dispose();
    }
    for (const ring of this.ringSlots) {
      ring.mesh.material.dispose();
    }
    this.group.clear();
  }

  private updateSnowballSlot(slot: SnowballSlot, snowball: Snowball): void {
    if (slot.snowballId !== snowball.id) {
      slot.snowballId = snowball.id;
      slot.lastTrailTick = -1;
      this.applySlotElement(slot, snowball.element);
    }

    const cfg = vfxFor(snowball.element);
    toThree(this.tmp, snowball.position.x, snowball.position.y, snowball.height);
    const scale = Math.max(snowball.radius, SNOWBALL.radius * 0.5) * cfg.visualScale;
    slot.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    slot.mesh.scale.setScalar(scale);
    slot.mesh.visible = true;

    const trailTick = Math.floor(snowball.age * cfg.trailRate);
    if (snowball.height > SNOWBALL.radius * 0.5 && trailTick > slot.lastTrailTick) {
      slot.lastTrailTick = trailTick;
      this.spawnTrail(snowball, cfg);
    }
  }

  /** Swaps the pooled projectile's material for the element now occupying this slot. */
  private applySlotElement(slot: SnowballSlot, element: ElementId | undefined): void {
    slot.mesh.material = element ? this.ballMaterialFor(element) : this.defaultBallMaterial;
  }

  private ballMaterialFor(element: ElementId): THREE.MeshStandardMaterial {
    const cfg = ELEMENT_VFX[element];
    return this.assets.material(
      `particle-renderer-ball:${element}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: cfg.core,
          emissive: cfg.glow,
          emissiveIntensity: 0.85,
          roughness: 0.3,
          metalness: 0.05,
        }),
    );
  }

  /**
   * The "tail" is the trail itself: a short scatter of particles per flight
   * tick, offset sideways off the flight axis so it reads as a stream rather
   * than a single-file dotted line — a bright core-colored particle plus a
   * couple of dimmer, smaller trailColor ones falling slightly behind it.
   */
  private spawnTrail(snowball: Snowball, cfg: ElementVfx): void {
    toThree(this.tmp, snowball.position.x, snowball.position.y, snowball.height);
    const speed = Math.max(0.001, Math.hypot(snowball.velocity.x, snowball.velocity.y));
    const perpX = -snowball.velocity.y / speed;
    const perpZ = snowball.velocity.x / speed;

    for (let i = 0; i < TAIL_STREAK_COUNT; i++) {
      const jitter = (Math.random() - 0.5) * cfg.trailSize * 2.4;
      const back = i * 0.16;
      this.spawnParticle(
        this.tmp.x + perpX * jitter - snowball.velocity.x * back * 0.05,
        this.tmp.y + (Math.random() - 0.4) * cfg.trailSize,
        this.tmp.z + perpZ * jitter - snowball.velocity.y * back * 0.05,
        -snowball.velocity.x * 0.025,
        0.18 + Math.random() * 0.12,
        -snowball.velocity.y * 0.025,
        cfg.trailSize * (1 - i * 0.25),
        TRAIL_LIFE * (1 - i * 0.15),
        i === 0 ? cfg.core : cfg.trailColor,
        cfg.gravityScale,
      );
    }
  }

  private spawnBurst(x: number, y: number, height: number, color: number, count: number): void {
    toThree(this.tmp, x, y, height);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 1.5 + (i % 3) * 0.35;
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        Math.cos(angle) * speed,
        1.9 + (i % 2) * 0.45,
        Math.sin(angle) * speed,
        0.13 + (i % 3) * 0.025,
        BURST_LIFE,
        color,
      );
    }
  }

  /** Multi-color impact burst, cycling through the element's palette (GDD §17). */
  private spawnElementBurst(
    x: number,
    y: number,
    height: number,
    cfg: ElementVfx,
    count: number,
    speedScale = 1,
  ): void {
    toThree(this.tmp, x, y, height);
    const palette = cfg.impactColors;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.35;
      const speed = (cfg.impactSpeed + (i % 3) * 0.4) * speedScale;
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        Math.cos(angle) * speed,
        (1.6 + (i % 2) * 0.6) * speedScale,
        Math.sin(angle) * speed,
        cfg.trailSize * (1.1 + (i % 3) * 0.25),
        BURST_LIFE,
        palette[i % palette.length],
        cfg.gravityScale,
      );
    }
  }

  /** Rising, slow-falling smoke puff — the aftermath of a fire/stone impact. */
  private spawnSmoke(x: number, y: number, count: number): void {
    toThree(this.tmp, x, y, 0.1);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 0.35 + (i % 3) * 0.15;
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        Math.cos(angle) * speed,
        1.1 + (i % 2) * 0.5,
        Math.sin(angle) * speed,
        0.16 + (i % 3) * 0.05,
        0.7,
        SMOKE_COLOR,
        0.35,
      );
    }
  }

  private spawnSnowPuff(x: number, y: number, count: number): void {
    toThree(this.tmp, x, y, 0.05);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 0.45 + (i % 3) * 0.18;
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        Math.cos(angle) * speed,
        0.45 + (i % 2) * 0.18,
        Math.sin(angle) * speed,
        0.09 + (i % 3) * 0.018,
        0.42,
        WHITE,
      );
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    color: number,
    gravityScale = 1,
  ): void {
    for (const particle of this.particleSlots) {
      if (particle.active) continue;
      particle.x = x;
      particle.y = y;
      particle.z = z;
      particle.vx = vx;
      particle.vy = vy;
      particle.vz = vz;
      particle.life = life;
      particle.maxLife = life;
      particle.size = size;
      particle.gravityScale = gravityScale;
      particle.active = true;
      particle.mesh.material.color.setHex(color);
      particle.mesh.material.opacity = 1;
      particle.mesh.position.set(x, y, z);
      particle.mesh.scale.setScalar(size);
      particle.mesh.visible = true;
      return;
    }
  }

  private updateParticles(): void {
    for (const particle of this.particleSlots) {
      if (!particle.active) continue;

      particle.life -= PARTICLE_DT;
      if (particle.life <= 0) {
        particle.active = false;
        particle.mesh.visible = false;
        particle.mesh.material.opacity = 0;
        continue;
      }

      particle.vy -= PARTICLE_GRAVITY * particle.gravityScale * PARTICLE_DT;
      particle.x += particle.vx * PARTICLE_DT;
      particle.y += particle.vy * PARTICLE_DT;
      particle.z += particle.vz * PARTICLE_DT;

      const t = particle.life / particle.maxLife;
      particle.mesh.position.set(particle.x, particle.y, particle.z);
      particle.mesh.scale.setScalar(particle.size * (0.35 + t * 0.65));
      particle.mesh.material.opacity = t;
    }
  }

  private updatePlayerEffects(): void {
    for (const player of this.world.players) {
      const state = this.fxStateForPlayer(player);
      if (state === null) continue;

      if (state.puffCooldown > 0) {
        state.puffCooldown -= PARTICLE_DT;
      }

      const vx = player.velocity.x;
      const vy = player.velocity.y;
      const speedSq = vx * vx + vy * vy;
      const moving = player.alive && speedSq > FOOTPRINT_MOVE_THRESHOLD_SQ;

      if (moving) {
        const speed = Math.sqrt(speedSq);
        let sharpTurn = false;
        const lastSpeedSq = state.lastVx * state.lastVx + state.lastVy * state.lastVy;
        if (lastSpeedSq > FOOTPRINT_MOVE_THRESHOLD_SQ) {
          const dot = (vx * state.lastVx + vy * state.lastVy) / (speed * Math.sqrt(lastSpeedSq));
          sharpTurn = dot < SHARP_TURN_COS;
        }

        if ((!state.wasMoving || sharpTurn) && state.puffCooldown <= 0) {
          this.spawnSnowPuff(player.position.x, player.position.y, 5);
          state.puffCooldown = PUFF_COOLDOWN;
        }

        state.footprintTimer -= PARTICLE_DT;
        if (state.footprintTimer <= 0) {
          const sideOffset = FOOTPRINT_SIDE_OFFSET * state.side;
          this.spawnFootprint(
            player.position.x - (vy / speed) * sideOffset,
            player.position.y + (vx / speed) * sideOffset,
            Math.atan2(vx, vy),
          );
          state.side = -state.side;
          state.footprintTimer = FOOTPRINT_INTERVAL;
        }

        state.lastVx = vx;
        state.lastVy = vy;
      } else {
        state.footprintTimer = 0;
        state.lastVx = 0;
        state.lastVy = 0;
      }

      state.wasMoving = moving;
    }
  }

  private spawnFootprint(x: number, y: number, rotation: number): void {
    for (const footprint of this.footprintSlots) {
      if (footprint.active) continue;
      toThree(this.tmp, x, y, 0.012);
      footprint.life = FOOTPRINT_LIFE;
      footprint.maxLife = FOOTPRINT_LIFE;
      footprint.active = true;
      footprint.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      footprint.mesh.rotation.set(0, rotation, 0);
      footprint.mesh.scale.set(0.12, 1, 0.26);
      footprint.mesh.material.opacity = 0.34;
      footprint.mesh.visible = true;
      return;
    }
  }

  private updateFootprints(): void {
    for (const footprint of this.footprintSlots) {
      if (!footprint.active) continue;

      footprint.life -= PARTICLE_DT;
      if (footprint.life <= 0) {
        footprint.active = false;
        footprint.mesh.visible = false;
        footprint.mesh.material.opacity = 0;
        continue;
      }

      const t = footprint.life / footprint.maxLife;
      footprint.mesh.material.opacity = 0.34 * t;
    }
  }

  private updateSparkles(): void {
    const halfWidth = this.world.arena.width * 0.5;
    const halfHeight = this.world.arena.height * 0.5;

    for (const sparkle of this.sparkleSlots) {
      sparkle.x += sparkle.vx * PARTICLE_DT;
      sparkle.y += sparkle.vy * PARTICLE_DT;
      sparkle.height -= sparkle.fall * PARTICLE_DT;
      sparkle.phase += sparkle.phaseSpeed * PARTICLE_DT;

      if (sparkle.phase > SPARKLE_TWO_PI) {
        sparkle.phase -= SPARKLE_TWO_PI;
      }
      if (sparkle.x > halfWidth) {
        sparkle.x = -halfWidth;
      } else if (sparkle.x < -halfWidth) {
        sparkle.x = halfWidth;
      }
      if (sparkle.y > halfHeight) {
        sparkle.y = -halfHeight;
      } else if (sparkle.y < -halfHeight) {
        sparkle.y = halfHeight;
      }
      if (sparkle.height < 0.05) {
        sparkle.height = 1.4 + (sparkle.phase / SPARKLE_TWO_PI) * 0.9;
      }

      const twinkle = 0.5 + Math.sin(sparkle.phase) * 0.5;
      sparkle.mesh.position.set(sparkle.x, sparkle.height, sparkle.y);
      sparkle.mesh.material.opacity = 0.08 + twinkle * 0.18;
    }
  }

  private createSparkleSlot(
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    index: number,
  ): SparkleSlot {
    const width = Math.max(this.world.arena.width, 1);
    const height = Math.max(this.world.arena.height, 1);
    const fx = ((index * 37) % SPARKLE_POOL_SIZE) / SPARKLE_POOL_SIZE;
    const fy = ((index * 53) % SPARKLE_POOL_SIZE) / SPARKLE_POOL_SIZE;
    const phase = ((index * 17) % SPARKLE_POOL_SIZE) / SPARKLE_POOL_SIZE * SPARKLE_TWO_PI;
    return {
      mesh,
      x: (fx - 0.5) * width,
      y: (fy - 0.5) * height,
      height: 0.12 + ((index % 9) / 9) * 1.9,
      vx: 0.08 + (index % 5) * 0.012,
      vy: -0.035 - (index % 7) * 0.007,
      fall: 0.018 + (index % 4) * 0.004,
      phase,
      phaseSpeed: 1.2 + (index % 6) * 0.16,
      size: 0.018 + (index % 3) * 0.006,
    };
  }

  /** Spawns a flat shockwave ring that expands and fades — the "explosion" beat of an impact. */
  private spawnRing(x: number, y: number, color: number, maxScale: number, life = 0.32): void {
    if (maxScale <= 0) return;
    for (const ring of this.ringSlots) {
      if (ring.active) continue;
      toThree(this.tmp, x, y, RING_LIFT);
      ring.life = life;
      ring.maxLife = life;
      ring.maxScale = maxScale;
      ring.active = true;
      ring.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      ring.mesh.scale.setScalar(0.05);
      ring.mesh.material.color.setHex(color);
      ring.mesh.material.opacity = 0.85;
      ring.mesh.visible = true;
      return;
    }
  }

  private updateRings(): void {
    for (const ring of this.ringSlots) {
      if (!ring.active) continue;

      ring.life -= PARTICLE_DT;
      if (ring.life <= 0) {
        ring.active = false;
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
        continue;
      }

      const t = 1 - ring.life / ring.maxLife;
      const eased = 1 - (1 - t) * (1 - t);
      ring.mesh.scale.setScalar(0.05 + eased * ring.maxScale);
      ring.mesh.material.opacity = 0.85 * (1 - t);
    }
  }

  /** Green bubbles rising out of every live poison puddle (GDD §9 Praga/Alquimista). */
  private updatePuddleBubbles(): void {
    const seen = new Set<EntityId>();
    for (const puddle of this.world.puddles) {
      seen.add(puddle.id);
      let timer = this.puddleBubbleTimers.get(puddle.id);
      if (timer === undefined) {
        timer = Math.random() * BUBBLE_MAX_INTERVAL;
      }
      timer -= PARTICLE_DT;
      if (timer <= 0) {
        this.spawnPuddleBubble(puddle);
        timer = BUBBLE_MIN_INTERVAL + Math.random() * (BUBBLE_MAX_INTERVAL - BUBBLE_MIN_INTERVAL);
      }
      this.puddleBubbleTimers.set(puddle.id, timer);
    }

    for (const id of this.puddleBubbleTimers.keys()) {
      if (!seen.has(id)) this.puddleBubbleTimers.delete(id);
    }
  }

  private spawnPuddleBubble(puddle: Puddle): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * puddle.radius * 0.85;
    const x = puddle.position.x + Math.cos(angle) * dist;
    const y = puddle.position.y + Math.sin(angle) * dist;
    toThree(this.tmp, x, y, 0.03);
    const color = Math.random() < 0.35 ? BUBBLE_POP_COLOR : BUBBLE_COLOR;
    this.spawnParticle(
      this.tmp.x,
      this.tmp.y,
      this.tmp.z,
      (Math.random() - 0.5) * 0.1,
      0.4 + Math.random() * 0.35,
      (Math.random() - 0.5) * 0.1,
      0.045 + Math.random() * 0.05,
      0.35 + Math.random() * 0.25,
      color,
      0.3,
    );
  }

  private fxStateForPlayer(player: Player): PlayerFxState | null {
    let empty: PlayerFxState | null = null;
    for (const state of this.playerFxStates) {
      if (state.playerId === player.id) return state;
      if (state.playerId === -1 && empty === null) {
        empty = state;
      }
    }
    if (empty === null) return null;
    empty.playerId = player.id;
    empty.footprintTimer = 0;
    empty.puffCooldown = 0;
    empty.side = 1;
    empty.wasMoving = false;
    empty.lastVx = 0;
    empty.lastVy = 0;
    return empty;
  }

  private findSnowball(id: number): Snowball | null {
    for (const snowball of this.world.snowballs) {
      if (snowball.id === id) return snowball;
    }
    return null;
  }

  private teamColorForPlayer(playerId: number): number {
    for (const player of this.world.players) {
      if (player.id === playerId) return TEAM_COLORS[player.team];
    }
    return WHITE;
  }
}
