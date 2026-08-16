import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameRenderer } from '../core/Game';
import type { EntityId } from '../ecs/Entity';
import type { AssetManager } from '../engine/AssetManager';
import { prefersReducedMotion } from '../engine/reducedMotion';
import { PLAYER, SNOWBALL, BUFF_COLORS } from '../game/config';
import { fxStacks } from '../game/effects';
import type { ElementId } from '../game/elements';
import type { Player, Puddle, Snowball } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';
import { ELEMENT_TINT } from './elementPalette';
import { LightningBolt } from './LightningBolt';
import {
  AXIAL_SHAPES,
  FACING_SHAPES,
  projectileGeometry,
  runeRingGeometry,
  UPRIGHT_SPIN_SHAPES,
  voxelRockGeometry,
  type ProjectileShape,
} from './projectileGeometry';
import {
  METEOR_DEBRIS_COUNT,
  METEOR_DEBRIS_LIFE,
  METEOR_FALL_TIME,
  METEOR_POOL_SIZE,
  METEOR_TRAIL_LIFE,
  METEOR_TRAIL_RATE,
  planColumnFall,
  VOXEL_POOL_SIZE,
} from './columnFall';
import { BOLT_POINTS, planBoltPath } from './boltPath';
import { EFFECT_VFX, newEmissionTimers, type EffectEmission } from './effectVfx';
import {
  planRootGrowth,
  rootVoxelScale,
  ROOT_SYSTEM_POOL,
  ROOT_VOXEL_POOL,
  ROOT_VOXEL_SIZE,
  ROOT_VOXELS_PER_CAST,
  type RootVoxel,
} from './rootGrowth';
import { spellVfxFor, type SpellVfx } from './spellVfx';

const SNOWBALL_POOL_SIZE = 64;
const PARTICLE_POOL_SIZE = 900;
const FOOTPRINT_POOL_SIZE = 64;
const SPARKLE_POOL_SIZE = 72;
const RING_POOL_SIZE = 32;
const ZONE_POOL_SIZE = 8;
const DOME_POOL_SIZE = 4;

/**
 * Bolts a `strike` cast keeps.
 *
 * Small on purpose. A strike lasts {@link STRIKE_LIFE} against a global cast
 * cooldown four times longer, so two overlapping needs both teams to fire the
 * same card within a couple of frames of each other — and unlike a zone, a
 * dropped bolt costs a flash nobody was going to look at twice.
 */
const STRIKE_POOL_SIZE = 3;
/** How long the arc hangs before it is gone, in seconds. */
const STRIKE_LIFE = 0.22;
/** Ribbon widths for the white core and the coloured aura around it. */
const STRIKE_CORE_WIDTH = 0.16;
const STRIKE_GLOW_WIDTH = 0.42;
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
const ZONE_LIFT = 0.04;
/** Peak opacity of a cast's ground disc. Additive, so it goes glary fast. */
const ZONE_OPACITY = 0.32;
const DOME_OPACITY = 0.22;
/**
 * Bubbles per second per square world unit of puddle. A rate rather than a
 * fixed interval because Praga's zone (radius 3.5) covers five times the area
 * of a poison flask's (1.5) — one bubble every 90ms looks like a boil in the
 * small one and like nothing at all in the big one.
 */
const BUBBLE_RATE_PER_AREA = 1.6;
const BUBBLE_MAX_RATE = 26;
const BUBBLE_COLOR = 0x80b918;
const BUBBLE_POP_COLOR = 0xa6ff5c;
const MIST_COLOR = 0x3f7d20;
/** Fraction of bubbles that come up as a slow, wide drifting mist puff instead. */
const MIST_CHANCE = 0.22;

/* ---- Cast shapes (GDD §17) ------------------------------------------------- */
/** Where a falling meteor starts, in world units above the ground. */
const METEOR_HEIGHT = 5.5;
/**
 * The stone itself: charcoal body, hot glow, and it tumbles.
 *
 * A `MeshStandardMaterial` rather than the additive sprites the rest of this
 * file is built from, because a stone on fire has to read as an *object* the
 * arena lights and not as a streak of light. It is the same lesson the element
 * pass already learned about the Golem's boulder — a rock with a spell's glow
 * reads as a grey orb — so the fire is the tail behind it, never the body.
 */
const METEOR_BODY_COLOR = 0x222222;
/** Deep red rather than the trail's yellow: the body glows, the fire burns. */
const METEOR_BODY_GLOW = 0xff3300;
/*
 * Small enough to still be debris. The voxel lump spans about 1.9 units before
 * scaling, so this lands it a little over half a unit across — bigger than the
 * Golem's thrown boulder, because it falls from five units up, and well short
 * of the mage it is falling next to. Twice this read as masonry dropped by a
 * crane.
 */
const METEOR_SCALE = 0.3;
const METEOR_SPIN = 7.5;
/**
 * The fire itself. Three temperatures rather than one, so the trail has depth
 * instead of reading as a single coloured smear.
 */
const METEOR_FIRE_COLORS = [0xffdd00, 0xff6600, 0xff2200];
/** Cold rock thrown out of the crater, as opposed to the fire around it. */
const METEOR_DEBRIS_COLOR = 0x6b6560;
/** Fraction of the impact spray that is rock rather than flame. */
const METEOR_DEBRIS_SHARE = 0.4;
/** Where a settled chunk sits, and how fast it stops sliding once it lands. */
const DEBRIS_REST_HEIGHT = 0.07;
const DEBRIS_SKID = 0.86;
/** The spray where a body breaks, and the ring it leaves. */
const METEOR_HIT_SPEED = 2.1;
const METEOR_HIT_RING = 1.3;
/** Tangential speed of a `torus`'s rim motes — what makes the rim read as turning. */
const TORUS_RIM_SPEED = 2.2;
/**
 * What a cast's mote count is multiplied by under `prefers-reduced-motion`.
 *
 * The motes are thinned and the ground footprint — zone, rings, the white
 * friendly flash — is left completely alone, because those are not decoration:
 * they are the answer to *where* and *whose*, and a player who has asked for
 * less motion has not asked to be told less. Same reason the continuous status
 * emission is untouched: a stream of embers is how you know a mage is burning.
 * What goes is the scatter over the top of it.
 */
const REDUCED_MOTE_SCALE = 0.4;

const SHIELD_BREAK_COLOR = 0xfff3c4;

/**
 * Lightning's arc, in world units — see {@link LightningBolt}. The glow is a
 * second, wider pass over the *same* zig-zag: a lone hairline arc washes out
 * against the bright arena floor at match zoom.
 */
const BOLT = {
  length: 2.2,
  width: 0.085,
  glowWidth: 0.2,
  glowOpacity: 0.38,
  spread: 0.34,
  /** The spark at the tip, as a fraction of the projectile's radius. */
  headScale: 0.6,
} as const;

/**
 * How fast a projectile turns over in flight, in radians per second. Spin is
 * what separates a thrown *object* from a conjured light: a boulder tumbles,
 * a shard rolls around its point, a blade whirls. Anything conjured (orb,
 * glob, sigil) turns slowly or not at all.
 */
const SPIN_RATE: Readonly<Record<ProjectileShape, number>> = {
  orb: 0,
  bolt: 0,
  rock: 4.2,
  shard: 9.0,
  glob: 1.4,
  runeOrb: 0,
  blade: 16.0,
  sigil: 2.2,
  wave: 0,
};

/** Model-space axes the oriented shapes are built along; see `projectileGeometry`. */
const UNIT_Y = new THREE.Vector3(0, 1, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);

/** How fast the Archer's rune band turns around its orb, in rad/s. */
const RUNE_RING_SPIN = 3.4;
/** Peak extra scale of the Bard's wave as it breathes, and how fast it breathes. */
const WAVE_PULSE = 0.22;
const WAVE_PULSE_HZ = 6.5;
/** How far the Alchemist's glob squashes and stretches, and how fast. */
const GLOB_WOBBLE = 0.18;
const GLOB_WOBBLE_HZ = 3.2;

/**
 * Per-element look (GDD §17: "efeito ativo tem que ser visível"). One entry
 * drives the projectile's own material, the particle tail it sheds in
 * flight, and its impact burst/shockwave — so a fireball, a frost shard and
 * a poison flask read as different spells at a glance, not as the same white
 * ball recolored.
 */
interface ElementVfx {
  /**
   * What the projectile *is* — its silhouette, built in
   * {@link projectileGeometry}. This is the element's primary identity: at
   * match zoom a recolored sphere reads as the same spell for everyone, so
   * fire keeps the conjured ball and everything else gets its own body.
   */
  shape: ProjectileShape;
  /**
   * Facet the body instead of smoothing it. What makes a rock look chipped
   * rather than inflated; wrong for anything conjured.
   */
  flatShading?: boolean;
  /**
   * A thrown object lit by the arena rather than a spell lighting itself.
   * Kills the emissive glow and roughens the surface — a boulder that glowed
   * read as a magic orb painted grey, which is exactly the bug this fixes.
   */
  matte?: boolean;
  /** Projectile body color + emissive glow. Shared with the caster's gem and hat band via {@link ELEMENT_TINT}. */
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
  shape: 'orb',
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
    shape: 'orb',
    ...ELEMENT_TINT.fire,
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
    shape: 'shard',
    flatShading: true,
    ...ELEMENT_TINT.ice,
    trailColor: 0x8fe3ff,
    trailSize: 0.08,
    trailRate: 24,
    impactColors: [0xbdf1ff, 0x4cc9f0, 0xffffff],
    impactCount: 14,
    impactSpeed: 2.2,
    gravityScale: 0.8,
    // A dart is read by its length, not its girth: the shard geometry is
    // already 2.2 long, so the scale here only has to keep it slim.
    visualScale: 0.9,
    ring: true,
    ringScale: 1.8,
    smoke: false,
  },
  lightning: {
    shape: 'bolt',
    ...ELEMENT_TINT.lightning,
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
    shape: 'glob',
    ...ELEMENT_TINT.poison,
    trailColor: 0x9bd63d,
    trailSize: 0.09,
    // Lowered to pay for the drips below: the particle pool is fixed, so a new
    // effect has to come out of an existing one rather than on top of it.
    trailRate: 14,
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
    shape: 'rock',
    flatShading: true,
    // The one projectile that is not magic — it is a rock someone threw.
    matte: true,
    ...ELEMENT_TINT.stone,
    trailColor: 0x9aa4b2,
    trailSize: 0.12,
    trailRate: 8,
    impactColors: [0xdbe6f2, 0x8d99ae, 0x6b7480],
    // The heaviest hit in the game (damage 32, and it interrupts a charge) was
    // landing with the *smallest* impact of the nine — a dull grey puff. It now
    // throws the widest shockwave of any non-wind element, which is what
    // "a boulder just arrived" should look like.
    impactCount: 20,
    impactSpeed: 2.8,
    gravityScale: 1.4,
    visualScale: 1.35,
    ring: true,
    ringScale: 2.2,
    smoke: true,
  },
  arcane: {
    shape: 'runeOrb',
    ...ELEMENT_TINT.arcane,
    trailColor: 0xc9a6f5,
    trailSize: 0.1,
    trailRate: 26,
    impactColors: [0xe6d1ff, 0x9b5de5, 0x6a2fb0],
    impactCount: 16,
    impactSpeed: 2.4,
    gravityScale: 0.7,
    // Smaller than it was: the rune band around it now carries the size.
    visualScale: 0.85,
    ring: true,
    ringScale: 2.0,
    smoke: false,
  },
  wind: {
    shape: 'blade',
    flatShading: true,
    ...ELEMENT_TINT.wind,
    trailColor: 0xd7f1f2,
    trailSize: 0.07,
    trailRate: 22,
    impactColors: [0xf3fbfb, 0xa8dadc, 0xffffff],
    impactCount: 14,
    impactSpeed: 3.0,
    gravityScale: 0.4,
    visualScale: 1.1,
    ring: true,
    ringScale: 2.6,
    smoke: false,
  },
  holy: {
    shape: 'sigil',
    ...ELEMENT_TINT.holy,
    trailColor: 0xffe9a8,
    trailSize: 0.075,
    trailRate: 18,
    impactColors: [0xfff8e1, 0xffc93c, 0xff9e00],
    impactCount: 12,
    impactSpeed: 2.0,
    gravityScale: 0.5,
    visualScale: 1.15,
    ring: true,
    ringScale: 1.9,
    smoke: false,
  },
  sonic: {
    shape: 'wave',
    ...ELEMENT_TINT.sonic,
    trailColor: 0xff8fd0,
    trailSize: 0.06,
    trailRate: 16,
    impactColors: [0xffd9f0, 0xf72585, 0xb5179e],
    impactCount: 12,
    impactSpeed: 2.8,
    gravityScale: 0.4,
    visualScale: 1.0,
    // A wide, thin shockwave: the Bard's hit shoves, so the ring is the tell.
    ring: true,
    ringScale: 2.8,
    smoke: false,
  },
};

function vfxFor(element: ElementId | undefined): ElementVfx {
  return element ? ELEMENT_VFX[element] : DEFAULT_VFX;
}

interface SnowballSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Built on demand: only lightning needs these, and most matches never field it. */
  bolt: LightningBolt | null;
  boltGlow: LightningBolt | null;
  /** Built on demand too: the rune band only the Archer's orb wears. */
  runeRing: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null;
  snowballId: number;
  lastTrailTick: number;
  /**
   * Tumble axis and phase, re-rolled for every projectile that lands in this
   * slot. Slots are handed out by index each frame, so without a reset the next
   * boulder would inherit the last one's rotation and pop.
   */
  spinAxisX: number;
  spinAxisY: number;
  spinAxisZ: number;
  spinPhase: number;
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
  /** Whether it settles on the ground instead of falling through it. */
  floor: boolean;
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

/** Filled ground disc marking the area a spell just covered. */
interface ZoneSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  radius: number;
  active: boolean;
}

/** Hemisphere that snaps up over a cast and fades — Escudo Arcano's beat. */
interface DomeSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  radius: number;
  active: boolean;
}

/**
 * A root system growing under a cast — Raízes Entrelaçadas' beat.
 *
 * One entry owns a contiguous slice of the shared instanced mesh, so a system
 * costs one draw call regardless of how many cubes it plans. The slice is fixed
 * at {@link ROOT_VOXELS_PER_CAST} rather than sized to the plan, because a
 * moving base would mean recomputing every later system's offset whenever one
 * expired.
 */
interface RootSystemSlot {
  voxels: readonly RootVoxel[];
  /** Gameplay-plane centre of the cast. */
  x: number;
  y: number;
  elapsed: number;
  life: number;
  active: boolean;
}

/** A bolt hanging in the air after a `strike` cast, crackling as it fades. */
interface StrikeSlot {
  readonly core: LightningBolt;
  readonly glow: LightningBolt;
  /** The traced arc, kept so both layers re-skin the same path every frame. */
  readonly path: Float32Array;
  life: number;
  active: boolean;
}

/** Which beat of a falling meteor a queued entry is: the body, or the break. */
type PendingKind = 'fall' | 'hit';

/** A stone on its way down. The fire is the trail it sheds, never the body. */
interface MeteorSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  life: number;
  x: number;
  y: number;
  /** Fractional embers owed from the last frame; see updateMeteors. */
  trailDebt: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  rateX: number;
  rateY: number;
  rateZ: number;
  active: boolean;
}

/** One scheduled beat of a `column` shower. */
interface PendingImpact {
  x: number;
  y: number;
  remaining: number;
  kind: PendingKind;
  cfg: SpellVfx;
}

interface PlayerFxState {
  playerId: number;
  footprintTimer: number;
  puffCooldown: number;
  side: number;
  wasMoving: boolean;
  lastVx: number;
  lastVy: number;
  /**
   * One accumulator per {@link EFFECT_VFX} row, by index; see
   * updateStatusEmission. Allocated once with the slot, so a mage picking up a
   * fourth effect mid-fight allocates nothing.
   */
  readonly timers: number[];
}

/**
 * Observes snowball simulation data and combat events, rendering pooled flying
 * projectiles (a per-element glowing orb, or a jagged arc for lightning, each
 * shedding a particle tail in flight), snow trails, hit puffs, impact
 * bursts/shockwaves, spell-cast zones and poison-puddle bubbles — without
 * mutating world state.
 */
export class ParticleRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  /** Scratch heading + roll for {@link orientBody}; reused so flight allocates nothing. */
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpSpin = new THREE.Quaternion();
  private readonly snowballSlots: SnowballSlot[] = [];
  private readonly particleSlots: ParticleSlot[] = [];
  private readonly footprintSlots: FootprintSlot[] = [];
  private readonly sparkleSlots: SparkleSlot[] = [];
  private readonly ringSlots: RingSlot[] = [];
  private readonly zoneSlots: ZoneSlot[] = [];
  private readonly domeSlots: DomeSlot[] = [];
  private readonly playerFxStates: PlayerFxState[] = [];
  private readonly puddleBubbleTimers = new Map<EntityId, number>();
  /** Beats of a `column` shower still to come; see {@link spawnColumnShaft}. */
  private readonly pendingImpacts: PendingImpact[] = [];
  private readonly meteorSlots: MeteorSlot[] = [];
  /** Cube particles: the fire a meteor sheds and the chunks it throws. */
  private readonly voxelSlots: ParticleSlot[] = [];
  /** Bolts of a `strike` cast; two per slot, a white core inside a coloured aura. */
  private readonly strikeSlots: StrikeSlot[] = [];
  /** Root systems, and the one instanced mesh all of their cubes are drawn from. */
  private readonly rootSlots: RootSystemSlot[] = [];
  private rootMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly defaultBallMaterial: THREE.MeshStandardMaterial;
  private readonly offSnowballImpact: () => void;
  private readonly offPlayerHit: () => void;
  private readonly offSnowballThrown: () => void;
  private readonly offBuffPickedUp: () => void;
  private readonly offPlayerRespawned: () => void;
  private readonly offSpellCast: () => void;
  private readonly offShieldBroken: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
    events: EventBus,
  ) {
    this.group.name = 'ParticleRenderer';
    this.scene.add(this.group);

    // Slots open on the plain orb; `applySlotElement` swaps in the shape the
    // element actually wants the moment a projectile claims the slot.
    const snowballGeometry = projectileGeometry(assets, 'orb');
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
      // A conjured ball is a solid body like anything else on the field, so it
      // drops a shadow (GDD §17) — which is also the only depth cue for how
      // high an arcing spell currently is.
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);

      this.snowballSlots.push({
        mesh,
        bolt: null,
        boltGlow: null,
        runeRing: null,
        snowballId: -1,
        lastTrailTick: -1,
        spinAxisX: 0,
        spinAxisY: 1,
        spinAxisZ: 0,
        spinPhase: 0,
      });
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
        floor: false,
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

    const zoneGeometry = assets.geometry('particle-renderer-zone-disc', () => {
      const geometry = new THREE.CircleGeometry(1, 40);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    });
    for (let i = 0; i < ZONE_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(zoneGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.zoneSlots.push({ mesh, life: 0, maxLife: 1, radius: 1, active: false });
    }

    const domeGeometry = assets.geometry(
      'particle-renderer-dome',
      // Upper half only: the lower half would be underground.
      () => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    );
    for (let i = 0; i < DOME_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(domeGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.domeSlots.push({ mesh, life: 0, maxLife: 1, radius: 1, active: false });
    }

    // Cubes rather than the shared sphere: the meteor's fire and debris are
    // voxels, so they hold their corners while everything else in the game
    // stays round. Its own pool, so a long shower cannot eat the slots the
    // impact bursts of an ordinary fight are drawing from.
    const voxelGeometry = assets.geometry(
      'particle-renderer-voxel-cube',
      () => new THREE.BoxGeometry(1, 1, 1),
    );
    for (let i = 0; i < VOXEL_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: WHITE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(voxelGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.voxelSlots.push({
        mesh,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        gravityScale: 1,
        floor: false,
        active: false,
      });
    }

    // Two bolts per strike, the same core-and-aura pair the Stormcaller's
    // projectile uses. A small pool: a strike lasts a fifth of a second against
    // a global cast cooldown four times that, so overlap needs both teams to
    // fire the same card within a frame or two of each other.
    for (let i = 0; i < STRIKE_POOL_SIZE; i++) {
      const core = this.createBolt(WHITE, 1);
      const glow = this.createBolt(WHITE, 0.5);
      this.strikeSlots.push({
        core,
        glow,
        path: new Float32Array(BOLT_POINTS * 3),
        life: 0,
        active: false,
      });
    }

    // Roots are instanced rather than pooled as individual meshes: a system is
    // over a hundred cubes and three can be alive at once, which is a scale the
    // one-mesh-per-particle pools here were never meant to reach. Not additive,
    // unlike almost everything else in this file — roots are solid matter
    // shoving out of the ground, and additive blending would make a dense
    // tangle glow like fire exactly where it should look like wood.
    const rootGeometry = assets.geometry(
      'particle-renderer-root-cube',
      () => new THREE.BoxGeometry(1, 1, 1),
    );
    const rootMaterial = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 1 });
    this.rootMesh = new THREE.InstancedMesh(rootGeometry, rootMaterial, ROOT_VOXEL_POOL);
    this.rootMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(ROOT_VOXEL_POOL * 3),
      3,
    );
    this.rootMesh.frustumCulled = false;
    this.rootMesh.visible = false;
    this.group.add(this.rootMesh);
    for (let i = 0; i < ROOT_SYSTEM_POOL; i++) {
      this.rootSlots.push({ voxels: [], x: 0, y: 0, elapsed: 0, life: 1, active: false });
    }
    this.hideAllRootInstances();

    // A voxel lump, not the Golem's smoothed boulder: a meteor is debris, and
    // corners survive being small, tumbling and half-hidden behind fire.
    const meteorGeometry = voxelRockGeometry(assets);
    for (let i = 0; i < METEOR_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(meteorGeometry, this.defaultBallMaterial);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.meteorSlots.push({
        mesh,
        life: 0,
        x: 0,
        y: 0,
        trailDebt: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        rateX: 0,
        rateY: 0,
        rateZ: 0,
        active: false,
      });
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
        timers: newEmissionTimers(),
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
      /*
       * A neutral flash, not a team-colored one. This used to burst in the
       * attacker's team color, which fought the element burst `SnowballImpact`
       * already threw at the same spot — and online it was wrong outright,
       * because the snapshot derives a hit from a health drop and has no
       * attacker to name (SnapshotSync passes the victim). Colour now belongs
       * to whatever *caused* the damage: the element on a spell hit, this bare
       * flash for a puddle, a Tower or a curse.
       */
      this.spawnBurst(event.x, event.y, 0.55, WHITE, 6);
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
    this.offSpellCast = events.on('SpellCast', (event) => {
      this.spawnSpellCast(event.spellId, event.x, event.y, event.radius, event.friendly);
    });
    // A shield coming down is the Cleric's whole contribution to a fight
    // (GDD §8.7); without a burst it happens in complete silence.
    this.offShieldBroken = events.on('ShieldBroken', (event) => {
      this.spawnBurst(event.x, event.y, 1.0, SHIELD_BREAK_COLOR, 12);
      this.spawnRing(event.x, event.y, SHIELD_BREAK_COLOR, 1.5, 0.28);
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
      this.hideBolt(slot);
      this.hideRuneRing(slot);
      slot.snowballId = -1;
      slot.lastTrailTick = -1;
    }

    this.updatePlayerEffects();
    this.updateParticles();
    this.updateFootprints();
    this.updateSparkles();
    this.updateRings();
    this.updateZones();
    this.updateDomes();
    this.updatePendingImpacts();
    this.updateRoots();
    this.updateStrikes();
    this.updateMeteors();
    this.updatePuddleBubbles();
  }

  dispose(): void {
    this.offSnowballImpact();
    this.offPlayerHit();
    this.offSnowballThrown();
    this.offBuffPickedUp();
    this.offPlayerRespawned();
    this.offSpellCast();
    this.offShieldBroken();
    this.scene.remove(this.group);

    for (const slot of this.snowballSlots) {
      slot.bolt?.dispose();
      slot.boltGlow?.dispose();
    }
    for (const zone of this.zoneSlots) {
      zone.mesh.material.dispose();
    }
    for (const dome of this.domeSlots) {
      dome.mesh.material.dispose();
    }
    for (const particle of this.particleSlots) {
      particle.mesh.material.dispose();
    }
    for (const voxel of this.voxelSlots) {
      voxel.mesh.material.dispose();
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
      this.rollSpin(slot);
      this.applySlotElement(slot, snowball.element);
    }

    const cfg = vfxFor(snowball.element);
    toThree(this.tmp, snowball.position.x, snowball.position.y, snowball.height);

    if (cfg.shape === 'bolt') {
      this.updateBolt(slot, snowball, cfg);
    } else {
      const scale = Math.max(snowball.radius, SNOWBALL.radius * 0.5) * cfg.visualScale;
      slot.mesh.castShadow = true;
      slot.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      slot.mesh.scale.setScalar(scale);
      slot.mesh.visible = true;
      this.orientBody(slot, snowball, cfg);

      if (cfg.shape === 'runeOrb') this.updateRuneRing(slot, snowball, cfg, scale);
      else this.hideRuneRing(slot);
    }

    const trailTick = Math.floor(snowball.age * cfg.trailRate);
    if (snowball.height > SNOWBALL.radius * 0.5 && trailTick > slot.lastTrailTick) {
      slot.lastTrailTick = trailTick;
      this.spawnTrail(snowball, cfg);
      if (cfg.shape === 'glob') this.spawnDrip(snowball, cfg);
    }
  }

  /**
   * Re-rolls the tumble for a projectile that just took over this slot. Slots
   * are assigned by index every frame, so a fresh boulder would otherwise
   * continue the rotation of whatever flew here last.
   */
  private rollSpin(slot: SnowballSlot): void {
    const theta = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    slot.spinAxisX = r * Math.cos(theta);
    slot.spinAxisY = r * Math.sin(theta);
    slot.spinAxisZ = z;
    slot.spinPhase = Math.random() * Math.PI * 2;
  }

  /**
   * Turns and spins the body according to its shape. A shard has to point
   * where it is going or it reads as a floating crystal; a blade has to face
   * the flight path or it reads as a hoop; a rock only has to tumble.
   */
  private orientBody(slot: SnowballSlot, snowball: Snowball, cfg: ElementVfx): void {
    const spin = SPIN_RATE[cfg.shape];
    const angle = slot.spinPhase + snowball.age * spin;
    const alongFlight = AXIAL_SHAPES.has(cfg.shape) || FACING_SHAPES.has(cfg.shape);

    if (alongFlight) {
      // Render space per coords.ts: gameplay x/y become world x/z and height
      // becomes world y. The vertical component matters — an arcing shard that
      // stays level looks like it is sliding, not flying.
      this.tmpDir.set(snowball.velocity.x, snowball.heightVelocity, snowball.velocity.y);
      if (this.tmpDir.lengthSq() < 1e-8) this.tmpDir.set(1, 0, 0);
      this.tmpDir.normalize();

      const modelAxis = AXIAL_SHAPES.has(cfg.shape) ? UNIT_Y : UNIT_Z;
      slot.mesh.quaternion.setFromUnitVectors(modelAxis, this.tmpDir);
      // Roll around the heading itself, so the spin never fights the aim.
      this.tmpSpin.setFromAxisAngle(this.tmpDir, angle);
      slot.mesh.quaternion.premultiply(this.tmpSpin);
    } else if (UPRIGHT_SPIN_SHAPES.has(cfg.shape)) {
      // These are already modelled in the attitude they should fly in — the
      // sigil pre-tilted toward the camera, the blade laid flat. Tumbling them
      // on a random axis would throw that away, so they only turn about up.
      slot.mesh.quaternion.setFromAxisAngle(UNIT_Y, angle);
    } else if (spin > 0) {
      this.tmpDir.set(slot.spinAxisX, slot.spinAxisY, slot.spinAxisZ);
      slot.mesh.quaternion.setFromAxisAngle(this.tmpDir, angle);
    }

    if (cfg.shape === 'glob') {
      // Squash and stretch on top of the tumble: a flask of something viscous
      // is the one projectile that should not hold its shape in the air.
      const wobble = Math.sin(slot.spinPhase + snowball.age * GLOB_WOBBLE_HZ * Math.PI * 2);
      const scale = slot.mesh.scale.x;
      slot.mesh.scale.set(
        scale * (1 - wobble * GLOB_WOBBLE * 0.5),
        scale * (1 + wobble * GLOB_WOBBLE),
        scale * (1 - wobble * GLOB_WOBBLE * 0.5),
      );
    } else if (cfg.shape === 'wave') {
      const pulse = 1 + Math.sin(snowball.age * WAVE_PULSE_HZ * Math.PI * 2) * WAVE_PULSE;
      slot.mesh.scale.multiplyScalar(pulse);
    }
  }

  /**
   * The band of runes turning around the Archer's orb. Built lazily on the
   * slot, like {@link LightningBolt} — most matches field no Arcane Archer.
   */
  private updateRuneRing(
    slot: SnowballSlot,
    snowball: Snowball,
    cfg: ElementVfx,
    bodyScale: number,
  ): void {
    slot.runeRing ??= this.createRuneRing(cfg.glow);
    const ring = slot.runeRing;
    ring.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    ring.scale.setScalar(bodyScale * 2.1);
    // Two axes, not one: a ring turning about a single axis reads as a disc
    // seen edge-on half the time and vanishes.
    ring.rotation.set(
      slot.spinPhase + snowball.age * RUNE_RING_SPIN,
      snowball.age * RUNE_RING_SPIN * 0.6,
      0,
    );
    ring.visible = true;
  }

  private createRuneRing(color: number): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const material = this.assets.material(
      'particle-renderer-rune-ring',
      () =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
    );
    const mesh = new THREE.Mesh(runeRingGeometry(this.assets), material);
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  private hideRuneRing(slot: SnowballSlot): void {
    if (slot.runeRing) slot.runeRing.visible = false;
  }

  /**
   * A drop of the Alchemist's flask falling out of the arc. Paid for by the
   * lowered `trailRate` on poison — the particle pool is fixed and silently
   * drops anything past its 900th live particle.
   */
  private spawnDrip(snowball: Snowball, cfg: ElementVfx): void {
    toThree(this.tmp, snowball.position.x, snowball.position.y, snowball.height);
    this.spawnParticle(
      this.tmp.x + (Math.random() - 0.5) * cfg.trailSize,
      this.tmp.y - cfg.trailSize,
      this.tmp.z + (Math.random() - 0.5) * cfg.trailSize,
      0,
      -0.4,
      0,
      cfg.trailSize * 0.7,
      TRAIL_LIFE * 1.6,
      cfg.trailColor,
      2.0,
    );
  }

  /**
   * Redraws the arc behind a lightning projectile. The simulation still tracks
   * a point; only the drawing is a bolt, so nothing about the hit changes.
   */
  private updateBolt(slot: SnowballSlot, snowball: Snowball, cfg: ElementVfx): void {
    // The tip keeps the ball mesh, shrunk to a spark: the arc trails *behind*
    // the point the simulation tracks, so without it there is nothing marking
    // where the projectile actually is. No shadow — a discharge does not
    // block the sun the way a conjured stone does.
    slot.mesh.castShadow = false;
    slot.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    slot.mesh.scale.setScalar(snowball.radius * BOLT.headScale);
    slot.mesh.visible = true;

    slot.bolt ??= this.createBolt(cfg.core, 1);
    slot.boltGlow ??= this.createBolt(cfg.glow, BOLT.glowOpacity);

    const speed = Math.hypot(snowball.velocity.x, snowball.velocity.y);
    // A bolt sitting still has no axis to draw along; fall back to +x so a
    // stalled projectile still shows something rather than collapsing.
    const dirX = speed > 1e-4 ? snowball.velocity.x / speed : 1;
    const dirZ = speed > 1e-4 ? snowball.velocity.y / speed : 0;

    slot.bolt.update(this.tmp, dirX, dirZ, BOLT.length, BOLT.width, BOLT.spread);
    slot.boltGlow.updateFrom(slot.bolt.path, dirX, dirZ, BOLT.glowWidth);
    slot.bolt.mesh.visible = true;
    slot.boltGlow.mesh.visible = true;
  }

  private createBolt(color: number, opacity: number): LightningBolt {
    const bolt = new LightningBolt(color, opacity);
    this.group.add(bolt.mesh);
    return bolt;
  }

  /**
   * Rebinds the pooled projectile to the element now occupying this slot —
   * both its body geometry and its material. The geometry used to be bound
   * once at construction, which is why every element flew as the same sphere.
   * Both sides come from the {@link AssetManager} cache, so a swap is a
   * pointer assignment, not an allocation.
   */
  private applySlotElement(slot: SnowballSlot, element: ElementId | undefined): void {
    const cfg = vfxFor(element);
    slot.mesh.geometry = projectileGeometry(this.assets, cfg.shape);
    slot.mesh.material = element ? this.ballMaterialFor(element) : this.defaultBallMaterial;
    // A slot that just stopped being a bolt (or an Archer's orb) must not leave
    // the old arc or rune band on screen.
    if (cfg.shape !== 'bolt') this.hideBolt(slot);
    if (cfg.shape !== 'runeOrb') this.hideRuneRing(slot);
  }

  private hideBolt(slot: SnowballSlot): void {
    if (slot.bolt) slot.bolt.mesh.visible = false;
    if (slot.boltGlow) slot.boltGlow.mesh.visible = false;
  }

  private ballMaterialFor(element: ElementId): THREE.MeshStandardMaterial {
    const cfg = ELEMENT_VFX[element];
    return this.assets.material(
      `particle-renderer-ball:${element}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: cfg.core,
          emissive: cfg.glow,
          // A matte projectile is an object the arena lights, not a spell that
          // lights itself: a boulder with a spell's glow reads as a grey orb.
          emissiveIntensity: cfg.matte ? 0.12 : 0.85,
          roughness: cfg.matte ? 0.95 : 0.3,
          metalness: 0.05,
          flatShading: cfg.flatShading ?? false,
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
    this.emit(this.particleSlots, x, y, z, vx, vy, vz, size, life, color, gravityScale);
  }

  /**
   * Claims a slot from a given pool. Returns it so a caller can set the few
   * per-particle behaviours that are not worth another positional argument —
   * `floor`, so far — without allocating an options object on a hot path.
   */
  private emit(
    slots: readonly ParticleSlot[],
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
  ): ParticleSlot | null {
    for (const particle of slots) {
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
      particle.floor = false;
      return particle;
    }
    return null;
  }

  private updateParticles(): void {
    this.stepParticles(this.particleSlots);
    this.stepParticles(this.voxelSlots);
  }

  private stepParticles(slots: readonly ParticleSlot[]): void {
    for (const particle of slots) {
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

      // Debris lands and stays landed rather than sinking through the floor:
      // chunks lying where a meteor broke are half of what says it broke.
      if (particle.floor && particle.y <= DEBRIS_REST_HEIGHT) {
        particle.y = DEBRIS_REST_HEIGHT;
        particle.vx *= DEBRIS_SKID;
        particle.vy = 0;
        particle.vz *= DEBRIS_SKID;
      }

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
      this.updateStatusEmission(state, player);
    }
  }

  /**
   * The continuous per-mage effect emissions (GDD §8), one pass over
   * {@link EFFECT_VFX}.
   *
   * Same accumulator shape as {@link ParticleRenderer.updatePuddleBubbles} —
   * count down by the frame step, spawn, add the interval back — because the
   * pool cannot take a spawn-per-frame and the interval is what caps the cost.
   */
  private updateStatusEmission(state: PlayerFxState, player: Player): void {
    for (let i = 0; i < EFFECT_VFX.length; i++) {
      const emission = EFFECT_VFX[i];
      const stacks = player.alive ? fxStacks(player, emission.kind) : 0;
      if (stacks <= 0) {
        state.timers[i] = 0;
        continue;
      }

      state.timers[i] -= PARTICLE_DT * (emission.perStack ? stacks : 1);
      while (state.timers[i] <= 0) {
        this.spawnEffectMote(player, emission);
        state.timers[i] += emission.interval * (0.7 + Math.random() * 0.6);
      }
    }
  }

  /**
   * One mote of a running effect, thrown off the mage's body.
   *
   * Note the {@link toThree} — the two hand-written emitters this replaced went
   * straight to `spawnParticle` with gameplay coordinates, so every ember and
   * every dissonance note has been spawning at `worldY = gameplay.y`: floating
   * in the air at a height equal to the mage's distance up the field, and at a
   * depth of about a metre from the top edge of the arena. They were visible,
   * which is presumably why it survived — just never anywhere near the mage
   * they belonged to.
   */
  private spawnEffectMote(player: Player, e: EffectEmission): void {
    const angle = Math.random() * SPARKLE_TWO_PI;
    const dist = e.radius + Math.random() * e.spread;
    toThree(
      this.tmp,
      player.position.x + Math.cos(angle) * dist,
      player.position.y + Math.sin(angle) * dist,
      e.height + Math.random() * e.heightSpread,
    );
    this.spawnParticle(
      this.tmp.x,
      this.tmp.y,
      this.tmp.z,
      Math.cos(angle) * e.drift,
      e.rise * (0.75 + Math.random() * 0.5),
      Math.sin(angle) * e.drift,
      e.size * (0.8 + Math.random() * 0.4),
      e.life * (0.75 + Math.random() * 0.5),
      e.colors[Math.floor(Math.random() * e.colors.length)],
      e.gravityScale,
    );
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

  /**
   * Green bubbles boiling out of every live poison puddle (GDD §9
   * Praga/Alquimista), at a rate proportional to the puddle's area so a big
   * Praga zone boils across its whole surface instead of at one spot.
   */
  private updatePuddleBubbles(): void {
    const seen = new Set<EntityId>();
    for (const puddle of this.world.puddles) {
      seen.add(puddle.id);
      const interval = this.bubbleInterval(puddle);
      let timer = this.puddleBubbleTimers.get(puddle.id) ?? Math.random() * interval;
      timer -= PARTICLE_DT;
      // A single tick can owe several bubbles on a wide puddle, so drain the
      // timer in a loop rather than dropping the surplus.
      while (timer <= 0) {
        this.spawnPuddleBubble(puddle);
        timer += interval * (0.6 + Math.random() * 0.8);
      }
      this.puddleBubbleTimers.set(puddle.id, timer);
    }

    for (const id of this.puddleBubbleTimers.keys()) {
      if (!seen.has(id)) this.puddleBubbleTimers.delete(id);
    }
  }

  private bubbleInterval(puddle: Puddle): number {
    const rate = Math.min(BUBBLE_MAX_RATE, BUBBLE_RATE_PER_AREA * Math.PI * puddle.radius * puddle.radius);
    return 1 / Math.max(4, rate);
  }

  private spawnPuddleBubble(puddle: Puddle): void {
    const angle = Math.random() * Math.PI * 2;
    // sqrt keeps the spawn uniform over the disc; a flat random clumps at the centre.
    const dist = Math.sqrt(Math.random()) * puddle.radius * 0.92;
    const x = puddle.position.x + Math.cos(angle) * dist;
    const y = puddle.position.y + Math.sin(angle) * dist;
    toThree(this.tmp, x, y, 0.03);

    // A minority come up as slow, fat, dark puffs — the fumes over the boil,
    // which is what stops the puddle from reading as a flat green sticker.
    if (Math.random() < MIST_CHANCE) {
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        (Math.random() - 0.5) * 0.22,
        0.28 + Math.random() * 0.22,
        (Math.random() - 0.5) * 0.22,
        0.16 + Math.random() * 0.12,
        0.9 + Math.random() * 0.5,
        MIST_COLOR,
        0.06,
      );
      return;
    }

    const color = Math.random() < 0.35 ? BUBBLE_POP_COLOR : BUBBLE_COLOR;
    this.spawnParticle(
      this.tmp.x,
      this.tmp.y,
      this.tmp.z,
      (Math.random() - 0.5) * 0.1,
      0.5 + Math.random() * 0.45,
      (Math.random() - 0.5) * 0.1,
      0.05 + Math.random() * 0.06,
      0.35 + Math.random() * 0.25,
      color,
      0.3,
    );
  }

  /* ---- Spell casts (GDD §9) ------------------------------------------------ */

  /**
   * The one beat that tells both players a card was spent and where it landed —
   * and, since the idle pivot, the only thing on the field that connects a rule
   * the player wrote to a thing that happened. Everything here is driven off
   * {@link spellVfxFor}, so retuning a spell's look is a table edit.
   *
   * The ground footprint (zone, two rings, the friendly flash) is shared by
   * every card, because *where* and *whose* are the two questions the answer
   * must never depend on knowing the card. `shape` answers the third — *which
   * card* — and is the only part that branches.
   */
  private spawnSpellCast(spellId: string, x: number, y: number, radius: number, friendly: boolean): void {
    const cfg = spellVfxFor(spellId);

    this.spawnZone(x, y, radius, cfg.zone, 0.85);
    this.spawnRing(x, y, cfg.ring, radius, 0.5);
    this.spawnRing(x, y, cfg.zone, radius * 0.62, 0.32);
    // Your own cast gets a white core flash: on a busy field the colour alone
    // does not tell you whether the spell that just went off was yours. Kept
    // small — these all blend additively, and a wide white disc on top of the
    // zone blows the whole area out to a featureless glare.
    if (friendly) this.spawnRing(x, y, WHITE, radius * 0.26, 0.18);

    switch (cfg.shape) {
      case 'dome':
        this.spawnDome(x, y, radius, cfg.ring);
        this.spawnSpellMotes(x, y, radius, cfg);
        break;
      case 'column':
        this.spawnColumnShaft(x, y, radius, cfg);
        this.spawnSpellMotes(x, y, radius, cfg);
        break;
      case 'torus':
        this.spawnRimMotes(x, y, radius, cfg);
        break;
      case 'roots':
        this.spawnRoots(x, y, radius, cfg);
        break;
      case 'strike':
        this.spawnBoltStrike(x, y, radius, cfg);
        this.spawnSpellMotes(x, y, radius, cfg);
        break;
      case 'burst':
        this.spawnSpellMotes(x, y, radius, cfg);
        break;
      default: {
        /*
         * Exhaustiveness, not defence. `cfg.shape` narrows to `never` here only
         * while every member of the union has a case above, so adding a shape
         * without a spawner is a compile error in this line — instead of a card
         * that quietly draws the shared footprint and nothing else, which is the
         * same silent no-op `spells.ts` refuses to allow in the catalog.
         * The runtime fallback is the burst, because throwing inside the render
         * loop would take the whole match down over a cosmetic gap.
         */
        const unhandled: never = cfg.shape;
        void unhandled;
        this.spawnSpellMotes(x, y, radius, cfg);
        break;
      }
    }
  }

  /**
   * A `column` cast: a shower of separate impacts scattered over the disc and
   * spread over a second, each one a body falling out of the sky and breaking
   * on the ground.
   *
   * The first cut of this drew a single narrow shaft down the middle, which was
   * wrong about the only card that uses the shape. Chuva de Meteoros covers a
   * radius of five and ticks three times — a lone shaft showed a pinprick where
   * the card covers a disc, and one arrival where the card has several. Where
   * and when each one lands is {@link planColumnFall}, which is tested; this
   * method is only the drawing.
   */
  private spawnColumnShaft(x: number, y: number, radius: number, cfg: SpellVfx): void {
    const count = this.moteBudget(cfg.impacts ?? 1);
    const window = cfg.impactWindow ?? 0;
    const fall = planColumnFall(count, radius, window);

    for (const impact of fall) {
      // Two beats per meteor: the body on its way down, then the break when it
      // arrives. Scheduling the second rather than drawing both at once is what
      // makes the thing read as *falling* instead of as a flash at altitude.
      this.schedule(x + impact.dx, y + impact.dy, impact.at, 'fall', cfg);
      this.schedule(x + impact.dx, y + impact.dy, impact.at + METEOR_FALL_TIME, 'hit', cfg);
    }
  }

  /**
   * Queues one beat of a shower. Allocates, unlike everything else in this
   * file — but a shower is cast at most every few seconds and costs a dozen of
   * these, against a particle pool that turns over hundreds per second. Pooling
   * it would buy nothing and cost a slot budget to get wrong.
   */
  private schedule(x: number, y: number, at: number, kind: PendingKind, cfg: SpellVfx): void {
    this.pendingImpacts.push({ x, y, remaining: at, kind, cfg });
  }

  /** Advances the shower queue and fires whatever has come due this frame. */
  private updatePendingImpacts(): void {
    for (let i = this.pendingImpacts.length - 1; i >= 0; i--) {
      const pending = this.pendingImpacts[i];
      pending.remaining -= PARTICLE_DT;
      if (pending.remaining > 0) continue;

      this.pendingImpacts.splice(i, 1);
      if (pending.kind === 'fall') this.spawnMeteorBody(pending.x, pending.y);
      else this.spawnMeteorHit(pending.x, pending.y, pending.cfg);
    }
  }

  /**
   * Sends one stone down: claims a slot, drops it above the point it will
   * break on, and rolls a fresh tumble.
   *
   * The tumble is re-rolled per body for the same reason {@link rollSpin} does
   * it for projectiles — slots are reused, and a stone inheriting the last
   * one's rotation pops on the frame it appears.
   */
  private spawnMeteorBody(x: number, y: number): void {
    for (const meteor of this.meteorSlots) {
      if (meteor.active) continue;

      meteor.life = METEOR_FALL_TIME;
      meteor.active = true;
      meteor.x = x;
      meteor.y = y;
      meteor.trailDebt = 0;

      // Three independent rates rather than one axis: a cube tumbling about a
      // single axis reads as a wheel, and the corners are the whole point.
      meteor.spinX = Math.random() * SPARKLE_TWO_PI;
      meteor.spinY = Math.random() * SPARKLE_TWO_PI;
      meteor.spinZ = Math.random() * SPARKLE_TWO_PI;
      meteor.rateX = (0.5 + Math.random()) * METEOR_SPIN;
      meteor.rateY = (0.5 + Math.random()) * METEOR_SPIN;
      meteor.rateZ = (0.5 + Math.random()) * METEOR_SPIN;

      meteor.mesh.material = this.meteorMaterial();
      meteor.mesh.scale.setScalar(METEOR_SCALE * (0.8 + Math.random() * 0.45));
      meteor.mesh.visible = true;
      return;
    }
    // Pool dry. Sized against `peakConcurrentMeteors` and held there by a test,
    // so reaching this means a descriptor outgrew the arithmetic rather than
    // that the arithmetic was wrong.
  }

  /**
   * Flies the stones one frame: down their line, tumbling, shedding fire.
   *
   * Position is derived from remaining life rather than integrated, so a body
   * cannot drift off its scheduled break — the ground beat is queued
   * separately, and the two have to arrive together.
   */
  private updateMeteors(): void {
    for (const meteor of this.meteorSlots) {
      if (!meteor.active) continue;

      meteor.life -= PARTICLE_DT;
      if (meteor.life <= 0) {
        meteor.active = false;
        meteor.mesh.visible = false;
        continue;
      }

      const fallen = meteor.life / METEOR_FALL_TIME;
      const height = METEOR_HEIGHT * fallen;
      toThree(this.tmp, meteor.x, meteor.y, height);
      meteor.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);

      const spun = METEOR_FALL_TIME - meteor.life;
      meteor.mesh.rotation.set(
        meteor.spinX + spun * meteor.rateX,
        meteor.spinY + spun * meteor.rateY,
        meteor.spinZ + spun * meteor.rateZ,
      );

      // Debt rather than a timer: at this speed a frame owes more than one
      // ember, and dropping the surplus would thin the trail at exactly the
      // moment the stone is moving fastest.
      meteor.trailDebt += METEOR_TRAIL_RATE * PARTICLE_DT;
      while (meteor.trailDebt >= 1) {
        meteor.trailDebt -= 1;
        this.spawnMeteorEmber(meteor, height);
      }
    }
  }

  /** One ember peeling off a falling stone and hanging in its wake. */
  private spawnMeteorEmber(meteor: MeteorSlot, height: number): void {
    const spread = METEOR_SCALE * 1.1;
    toThree(
      this.tmp,
      meteor.x + (Math.random() - 0.5) * spread,
      meteor.y + (Math.random() - 0.5) * spread,
      // Behind rather than around: the stone is falling, so its wake is above.
      height + Math.random() * 0.7,
    );
    this.emit(
      this.voxelSlots,
      this.tmp.x,
      this.tmp.y,
      this.tmp.z,
      (Math.random() - 0.5) * 0.5,
      // Fire rises, so it climbs out of the wake instead of chasing the body.
      0.8 + Math.random() * 1.2,
      (Math.random() - 0.5) * 0.5,
      0.11 + Math.random() * 0.1,
      METEOR_TRAIL_LIFE * (0.7 + Math.random() * 0.6),
      METEOR_FIRE_COLORS[Math.floor(Math.random() * METEOR_FIRE_COLORS.length)],
      // Weightless: an ember that fell would race the stone it came off.
      0,
    );
  }

  /**
   * The break: a crater ring, a spray of flame, and chunks of cold rock thrown
   * up and out that land and stay landed.
   *
   * The rock is what separates this from any other bright impact in the game.
   * Fire alone reads as an explosion; fire plus debris that settles on the
   * ground reads as something solid having *hit* it, which is the whole claim
   * a meteor makes.
   */
  private spawnMeteorHit(x: number, y: number, cfg: SpellVfx): void {
    this.spawnRing(x, y, cfg.ring, METEOR_HIT_RING, 0.26);

    const count = this.moteBudget(METEOR_DEBRIS_COUNT);
    for (let i = 0; i < count; i++) {
      const rock = Math.random() < METEOR_DEBRIS_SHARE;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = METEOR_HIT_SPEED * (0.6 + Math.random() * 0.9);
      toThree(this.tmp, x, y, 0.1);
      const slot = this.emit(
        this.voxelSlots,
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        Math.cos(angle) * speed,
        // Thrown up hard: the arc is what says it was flung rather than
        // painted on the floor.
        2.4 + Math.random() * 2.2,
        Math.sin(angle) * speed,
        rock ? 0.1 + Math.random() * 0.07 : 0.13 + Math.random() * 0.1,
        rock ? METEOR_DEBRIS_LIFE * (0.7 + Math.random() * 0.5) : 0.4 + Math.random() * 0.2,
        rock ? METEOR_DEBRIS_COLOR : METEOR_FIRE_COLORS[i % METEOR_FIRE_COLORS.length],
        rock ? 1.6 : 0.9,
      );
      // Only the rock lands. Flame that piled up on the floor would read as a
      // puddle, and this card already has one of those underneath it.
      if (slot && rock) slot.floor = true;
    }
  }

  private meteorMaterial(): THREE.MeshStandardMaterial {
    return this.assets.material(
      'particle-renderer-meteor',
      () =>
        new THREE.MeshStandardMaterial({
          color: METEOR_BODY_COLOR,
          emissive: METEOR_BODY_GLOW,
          /*
           * Half the strength the reference uses, because the reference sits
           * in a near-black scene and this arena is lit bright: at 0.8 the glow
           * swamped the base colour and the stone came out flat red, like
           * painted plastic rather than rock with heat in it. Low enough here
           * that the sun still models the faces, which is what says "voxel".
           */
          emissiveIntensity: 0.42,
          roughness: 0.95,
          metalness: 0.05,
          flatShading: true,
        }),
    );
  }

  /**
   * Motes for a `torus`: they hug the rim and travel around it instead of
   * filling the disc.
   *
   * That difference is the whole shape. A filled disc says "this was thrown at
   * the people standing here"; a turning rim says "this area is now switched
   * on", which is what a field card actually does — and, for Campo de
   * Sobrecarga, the reason it must not read as an attack on one squad is that
   * it catches both.
   */
  private spawnRimMotes(x: number, y: number, radius: number, cfg: SpellVfx): void {
    const total = this.moteBudget(cfg.moteCount);
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * Math.PI * 2;
      const dist = radius * (0.82 + Math.random() * 0.18);
      toThree(this.tmp, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, 0.1 + Math.random() * 0.5);
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        -Math.sin(angle) * TORUS_RIM_SPEED,
        cfg.direction * (0.5 + Math.random() * 0.5),
        Math.cos(angle) * TORUS_RIM_SPEED,
        0.08 + (i % 3) * 0.03,
        0.75 + Math.random() * 0.3,
        cfg.motes[i % cfg.motes.length],
        0.1,
      );
    }
  }

  /**
   * How many motes a cast is allowed, after the motion preference. Read per
   * cast rather than cached at construction — {@link prefersReducedMotion} is
   * itself cached behind a change listener, so this costs nothing and picks up
   * a player changing the setting mid-match.
   */
  private moteBudget(count: number): number {
    return prefersReducedMotion() ? Math.max(1, Math.round(count * REDUCED_MOTE_SCALE)) : count;
  }

  /** Motes filling the affected disc: they lift for a buff and rain down for a curse. */
  private spawnSpellMotes(x: number, y: number, radius: number, cfg: SpellVfx): void {
    const rising = cfg.direction > 0;
    const total = this.moteBudget(cfg.moteCount);
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * Math.PI * 2 + Math.random() * 0.5;
      const dist = Math.sqrt(Math.random()) * radius;
      toThree(
        this.tmp,
        x + Math.cos(angle) * dist,
        y + Math.sin(angle) * dist,
        rising ? 0.08 : 2.8 + Math.random() * 0.7,
      );
      this.spawnParticle(
        this.tmp.x,
        this.tmp.y,
        this.tmp.z,
        (Math.random() - 0.5) * 0.4,
        rising ? 1.7 + Math.random() * 1.2 : -2.4 - Math.random() * 0.9,
        (Math.random() - 0.5) * 0.4,
        0.09 + Math.random() * 0.07,
        0.6 + Math.random() * 0.35,
        cfg.motes[i % cfg.motes.length],
        rising ? 0.12 : 0.45,
      );
    }
  }

  private spawnZone(x: number, y: number, radius: number, color: number, life: number): void {
    for (const zone of this.zoneSlots) {
      if (zone.active) continue;
      toThree(this.tmp, x, y, ZONE_LIFT);
      zone.life = life;
      zone.maxLife = life;
      zone.radius = radius;
      zone.active = true;
      zone.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      zone.mesh.scale.setScalar(radius * 0.6);
      zone.mesh.material.color.setHex(color);
      zone.mesh.material.opacity = ZONE_OPACITY;
      zone.mesh.visible = true;
      return;
    }
  }

  private updateZones(): void {
    for (const zone of this.zoneSlots) {
      if (!zone.active) continue;

      zone.life -= PARTICLE_DT;
      if (zone.life <= 0) {
        zone.active = false;
        zone.mesh.visible = false;
        zone.mesh.material.opacity = 0;
        continue;
      }

      const t = 1 - zone.life / zone.maxLife;
      const eased = 1 - (1 - t) * (1 - t);
      zone.mesh.scale.setScalar(zone.radius * (0.6 + eased * 0.4));
      zone.mesh.material.opacity = ZONE_OPACITY * (1 - t);
    }
  }

  /**
   * A `roots` cast: branches of voxels shoving out of the soil across the disc,
   * holding for the card's duration, then withdrawing.
   *
   * The only shape whose body persists. Every other beat in this file is an
   * arrival — it happens, it fades, and what the card *did* is carried by the
   * status ring on the mage afterwards. Raízes Entrelaçadas has no ring worth
   * the name: a rooted mage looks like a standing mage, and the one thing on
   * screen saying "this one cannot walk" is the ground it is standing in. So
   * the roots stay for as long as the effect does, and `life` is the card's
   * duration rather than a fade time chosen here.
   *
   * Where the cubes go and when each appears is {@link planRootGrowth}, which is
   * tested; this method is only the drawing.
   */
  private spawnRoots(x: number, y: number, radius: number, cfg: SpellVfx): void {
    const slot = this.rootSlots.find((s) => !s.active) ?? this.oldestRootSlot();
    if (!slot) return;

    slot.voxels = planRootGrowth(radius);
    slot.x = x;
    slot.y = y;
    slot.elapsed = 0;
    // The duration the card actually holds its victims for; see the note above.
    slot.life = cfg.persist ?? 2;
    slot.active = true;

    this.writeRootColors(slot, cfg);
  }

  /**
   * Replaces the longest-running system when all three slots are taken.
   *
   * The same rule the voice cap in `AudioManager` uses, and for the same
   * reason: the newest cast is the one the player is being told about, and the
   * oldest has already been seen. Dropping the new one instead would make a
   * card silently stop drawing in exactly the fights busy enough to matter.
   */
  private oldestRootSlot(): RootSystemSlot | null {
    let best: RootSystemSlot | null = null;
    for (const slot of this.rootSlots) {
      if (!best || slot.elapsed > best.elapsed) best = slot;
    }
    return best;
  }

  /** Root cubes take the card's zone colour; flowers take its ring accent. */
  private writeRootColors(slot: RootSystemSlot, cfg: SpellVfx): void {
    const mesh = this.rootMesh;
    if (!mesh?.instanceColor) return;

    const base = this.rootSlots.indexOf(slot) * ROOT_VOXELS_PER_CAST;
    const root = new THREE.Color(cfg.zone);
    const flower = new THREE.Color(cfg.ring);

    for (let i = 0; i < slot.voxels.length; i++) {
      const c = slot.voxels[i].flower ? flower : root;
      mesh.instanceColor.setXYZ(base + i, c.r, c.g, c.b);
    }
    mesh.instanceColor.needsUpdate = true;
  }

  private hideAllRootInstances(): void {
    const mesh = this.rootMesh;
    if (!mesh) return;

    this.tmpMatrix.makeScale(0, 0, 0);
    for (let i = 0; i < ROOT_VOXEL_POOL; i++) mesh.setMatrixAt(i, this.tmpMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateRoots(): void {
    const mesh = this.rootMesh;
    if (!mesh) return;

    let anyActive = false;

    for (let s = 0; s < this.rootSlots.length; s++) {
      const slot = this.rootSlots[s];
      const base = s * ROOT_VOXELS_PER_CAST;

      if (!slot.active) continue;

      slot.elapsed += PARTICLE_DT;
      if (slot.elapsed >= slot.life) {
        slot.active = false;
        this.tmpMatrix.makeScale(0, 0, 0);
        for (let i = 0; i < ROOT_VOXELS_PER_CAST; i++) mesh.setMatrixAt(base + i, this.tmpMatrix);
        continue;
      }

      anyActive = true;

      for (let i = 0; i < ROOT_VOXELS_PER_CAST; i++) {
        const voxel = slot.voxels[i];
        const scale = voxel ? rootVoxelScale(voxel, slot.elapsed, slot.life) : 0;

        if (scale <= 0) {
          this.tmpMatrix.makeScale(0, 0, 0);
          mesh.setMatrixAt(base + i, this.tmpMatrix);
          continue;
        }

        // `taper` thins the branch toward its tip so it ends in a thread rather
        // than a brick; flowers sit slightly under a full cell so a cross of
        // four reads as a bloom and not a lump.
        const size = ROOT_VOXEL_SIZE * scale * voxel.taper * (voxel.flower ? 0.85 : 1);
        toThree(this.tmp, slot.x + voxel.x, slot.y + voxel.y, voxel.height + ROOT_VOXEL_SIZE * 0.5);
        this.tmpMatrix.makeScale(size, size, size);
        this.tmpMatrix.setPosition(this.tmp);
        mesh.setMatrixAt(base + i, this.tmpMatrix);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = anyActive;
  }

  /**
   * A `strike` cast: one bolt down through the roof of the arena onto the spot.
   *
   * The only beat in the catalog that arrives from outside the play space, and
   * the only one drawn as a line rather than as an area — which is the point.
   * Chuva de Meteoros also falls, but as seven bodies over a second: weather.
   * This is one arrival, once. A bombardment against a verdict.
   *
   * Reuses the two-bolt core-and-glow pair the Stormcaller's projectile already
   * has, welded to a single traced path through `updateFrom` so the aura sits on
   * the arc instead of wandering off on its own walk. The path itself is
   * {@link planBoltPath}, which is tested; this is only the drawing.
   */
  private spawnBoltStrike(x: number, y: number, radius: number, cfg: SpellVfx): void {
    const slot = this.strikeSlots.find((s) => !s.active) ?? this.strikeSlots[0];
    if (!slot) return;

    toThree(this.tmp, x, y, 0);
    slot.path.set(planBoltPath(this.tmp.x, this.tmp.z, 1 + radius * 0.25));
    slot.life = STRIKE_LIFE;
    slot.active = true;

    slot.core.mesh.material.color.setHex(WHITE);
    slot.glow.mesh.material.color.setHex(cfg.ring);
    slot.core.mesh.visible = true;
    slot.glow.mesh.visible = true;

    // The flash at the foot of the bolt. Small and bright rather than wide: the
    // strike's radius is already drawn by the shared zone disc, and a second
    // wide white disc on top of it blows the whole area to a flat glare.
    this.spawnRing(x, y, WHITE, radius * 0.5, 0.22);
  }

  /**
   * Re-jitters every live strike and fades it out.
   *
   * The arc is re-traced every frame rather than drawn once, which is what makes a
   * discharge crackle instead of sitting there as a static ribbon — the same
   * reason `LightningBolt.update` re-jitters a projectile's trail.
   */
  private updateStrikes(): void {
    for (const slot of this.strikeSlots) {
      if (!slot.active) continue;

      slot.life -= PARTICLE_DT;
      if (slot.life <= 0) {
        slot.active = false;
        slot.core.mesh.visible = false;
        slot.glow.mesh.visible = false;
        continue;
      }

      const t = slot.life / STRIKE_LIFE;
      // Re-traced from the same endpoints, so the bolt stays anchored on the
      // spot the card was aimed at while everything between the ends moves.
      const head = slot.path;
      slot.core.updateFrom(head, 1, 0, STRIKE_CORE_WIDTH * t);
      slot.glow.updateFrom(head, 1, 0, STRIKE_GLOW_WIDTH * t);
      slot.core.mesh.material.opacity = t;
      slot.glow.mesh.material.opacity = t * 0.5;
    }
  }

  private spawnDome(x: number, y: number, radius: number, color: number): void {
    for (const dome of this.domeSlots) {
      if (dome.active) continue;
      toThree(this.tmp, x, y, 0.02);
      dome.life = 0.7;
      dome.maxLife = 0.7;
      dome.radius = radius;
      dome.active = true;
      dome.mesh.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      dome.mesh.material.color.setHex(color);
      dome.mesh.material.opacity = DOME_OPACITY;
      dome.mesh.visible = true;
      return;
    }
  }

  private updateDomes(): void {
    for (const dome of this.domeSlots) {
      if (!dome.active) continue;

      dome.life -= PARTICLE_DT;
      if (dome.life <= 0) {
        dome.active = false;
        dome.mesh.visible = false;
        dome.mesh.material.opacity = 0;
        continue;
      }

      const t = 1 - dome.life / dome.maxLife;
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      const r = dome.radius * (0.35 + eased * 0.65);
      // Flattened: a full hemisphere over a 4-unit radius would tower over the
      // mages it is protecting and hide the fight underneath it.
      dome.mesh.scale.set(r, r * 0.55, r);
      dome.mesh.material.opacity = DOME_OPACITY * (1 - t);
    }
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
    // Staggered rather than zeroed, so four mages set alight on the same tick
    // do not pulse in lockstep like a string of lights.
    for (let i = 0; i < EFFECT_VFX.length; i++) {
      empty.timers[i] = Math.random() * EFFECT_VFX[i].interval;
    }
    return empty;
  }

  private findSnowball(id: number): Snowball | null {
    for (const snowball of this.world.snowballs) {
      if (snowball.id === id) return snowball;
    }
    return null;
  }

}
