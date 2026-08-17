import * as THREE from 'three';
import type { Role } from '../../sim/roles';
import type { GameRenderer } from '../core/Game';
import type { AssetManager } from '../engine/AssetManager';
import { PLAYER, TEAM_COLORS } from '../game/config';
import { fxStacks, hasFx } from '../game/effects';
import { PlayerState, type Player } from '../game/types';
import type { World } from '../game/World';
import { clamp } from '../utils/math';
import { toThree } from './coords';
import { elementTint } from './elementPalette';
import {
  buildSpiralStaffHead,
  buildVoidFace,
  hatBrimGeometry,
  hatConeGeometry,
} from './mageParts';

/** Brief hold on the fallen pose before the corpse starts dissolving. */
const DEATH_FADE_HOLD = 0.35;
/** Seconds to fade a downed mage out so the body does not clutter the arena. */
const DEATH_FADE_DURATION = 1.15;
/** Soft pop-in when a mage returns at the spawn pad. */
const RESPAWN_FADE_IN = 0.3;
/** Approximate frame step used by {@link PlayerRenderer.sync}. */
const RENDER_DT = 1 / 60;

/* ---- Status effect looks (GDD §8, §9) -------------------------------------- */

/** Ice's wash. `ELEMENT_TINT.ice.core`, so a slowed mage reads as *iced*. */
const FROST_COLOR = new THREE.Color(0xd8f7ff);
/** Fire's. Deliberately the glow, not the core: the core is nearly white. */
const EMBER_COLOR = new THREE.Color(0xff5a1f);
const VULNERABLE_COLOR = 0x9b5de5;
/**
 * Petrify's grey. Applied at full strength, unlike every other tint here — see
 * {@link PlayerRenderer.updateBodyTint}. Cool rather than neutral, so a statue
 * still separates from the sand of the arena floor behind it.
 */
const STONE_COLOR = new THREE.Color(0x8a8f98);
const STUN_COLOR = 0xffe066;
/**
 * How pale a slowed mage goes at most. Well short of 1: the mage still has to
 * read as its team colour, and a fully blanched figure loses the one thing a
 * player scans for in a scrum.
 */
const FROST_TINT_MAX = 0.55;
/**
 * How fast the wash eases in. Effects arrive at 20Hz, so snapping the colour on
 * the snapshot boundary reads as a glitch rather than as frost spreading.
 */
const TINT_EASE_RATE = 6;
const STUN_MOTE_COUNT = 3;
const STUN_MOTE_HEIGHT = 1.55;

/**
 * Where the hat pivots: the crown of the head. Rotating the whole hat group
 * from here swings the bent tip while the brim stays seated — pivoting at the
 * hat's own origin would slide the brim off the head instead.
 */
const HAT_PIVOT_Y = 1.1;

/**
 * The void head: radius, and where it sits under the brim.
 *
 * Sunk low into the collar, which is both the reference silhouette and the only
 * way the eyes are visible at all: the brim is a disc 0.37 across sitting at
 * {@link HAT_PIVOT_Y}, and from the match camera's 52° elevation it shades
 * everything within its own radius. The lower the face rides, the further
 * forward the sightline to the eyes exits before it reaches brim height. At the
 * old head height the brim covered the eyes even with the mage walking straight
 * at the camera.
 */
const HEAD_RADIUS = 0.25;
const HEAD_Y = 0.88;
/** Height of the staff crystal above the staff's own origin. */
const GEM_Y = 0.86;
/**
 * How far the brim reaches. Every centimetre here is shade over the mage's own
 * face at the match camera's angle, and the eyes under it are the facing cue —
 * so this is as wide as the hat can be and still let the mage be read.
 */
const BRIM_RADIUS = 0.37;
/** Radius of the hat cone where it meets the brim, and where the band grips it. */
const HAT_BASE_RADIUS = 0.3;
const HAT_BAND_Y = 0.045;
/**
 * The face. Not pure black — a surface with zero albedo takes no light at all
 * and reads as a hole punched in the frame rather than as a hooded face.
 */
const FACE_COLOR = 0x0b0b12;
/**
 * The eyes, and the one thing on the mage that is *not* element-coloured.
 *
 * Every mage's eyes are the same gold on purpose: the element already owns the
 * hat and the staff crystal, and the eyes have a different job — they are the
 * only bright mark on the head, so they are what the player reads facing from
 * (the beard used to do that, badly, from above). Tinting them per element
 * would make the cue itself change appearance mage to mage.
 */
const EYE_COLOR = 0xffea00;
const EYE_GLOW = 0xffd500;
const EYE_INTENSITY = 2.2;

/**
 * Height of Marca do Carrasco's drop above the mage's origin.
 *
 * Clear of the tallest hat in the roster: the mark has to be findable by
 * sweeping the field, and one that hides behind a cone on some mages and not
 * others is a mark the player learns not to trust.
 */
const MARK_DROP_Y = 2.05;
/**
 * Spring driving the hat tip's lag (see {@link PlayerRenderer.applySecondaryMotion}).
 * Tuned to settle in roughly a third of a second without ringing: a hat that
 * oscillates after the mage stops reads as broken, not as cloth.
 */
const SWAY_STIFFNESS = 90;
const SWAY_DAMPING = 13;
/** Hard cap on the sway, in radians. A knockback spike must not fold the hat flat. */
const SWAY_LIMIT = 0.35;
/** Sway angle at full running speed, before the spring lag. */
const SWAY_AT_FULL_SPEED = 0.26;
/** The hem follows the hat, weaker and opposed — a robe is heavier than a felt tip. */
const HEM_SWAY_RATIO = 0.33;

/**
 * How a role reads at a glance (GDD §8). Four mages of a squad used to be
 * pixel-identical; the differences are deliberately in the *silhouette* — hem
 * width and hat height survive the match camera's distance, where a color
 * change alone would not.
 *
 * Everything stays stout: the chunky proportions are the house style, so a tank
 * is a wider mage rather than a taller one.
 */
interface RoleLook {
  /** Robe radius at the ground. */
  readonly hem: number;
  /** Height of the hat cone, before the bend. */
  readonly hatHeight: number;
}

const ROLE_LOOK: Readonly<Record<Role, RoleLook>> = {
  tank: { hem: 0.52, hatHeight: 0.46 },
  damage: { hem: 0.44, hatHeight: 0.76 },
  support: { hem: 0.46, hatHeight: 0.62 },
};

/** Practice and the legacy offline path send no role; they get the middle build. */
const DEFAULT_LOOK: RoleLook = { hem: 0.46, hatHeight: 0.62 };

function lookFor(role: Role | undefined): RoleLook {
  return role ? ROLE_LOOK[role] : DEFAULT_LOOK;
}

interface PlayerView {
  readonly root: THREE.Group;
  readonly figure: THREE.Group;
  readonly ring: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Escudo Arcano indicator (GDD §9): a ring on the ground plus the bubble it implies. */
  readonly shieldRing: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly shieldDome: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /**
   * Marca do Carrasco's drop, floating over the crown.
   *
   * Its own material rather than a shared one, like the frost wash and the
   * vulnerability shell, because its opacity breathes per mage — a shared
   * material would make every marked mage pulse in lockstep with the first.
   */
  readonly markDrop: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Bênção de Ímpeto (GDD §9) — spins fast, the way haste should read. */
  readonly hasteRing: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Maldição da Lentidão or an ice hit (GDD §8.3, §9) — drags the other way. */
  readonly slowRing: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly leftArm: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly rightArm: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Hat pivot at the crown; the whole hat rotates here so the tip can lag. */
  readonly hatGroup: THREE.Group;
  /** The robe, whose hem trails the hat's sway at a fraction of the angle. */
  readonly robe: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /**
   * The eyes' material, held so petrify can put them out. Shared by the pair on
   * purpose — nothing ever lights one eye and not the other.
   */
  readonly eyeMaterial: THREE.MeshStandardMaterial;
  /** Element-tinted crystal on the staff. Swells and brightens with throw charge. */
  readonly gem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Additive shell around the gem; its opacity *is* the charge readout. */
  readonly gemHalo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /**
   * Support only: a mote circling the head. Parented to `root`, not `figure`,
   * so it orbits steadily instead of inheriting the body's bob and squash.
   */
  readonly orb: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null;
  /**
   * Arcane's mark (GDD §8.7): a bruised shell saying "hit this one". Its own
   * material, unlike the ground rings, because its opacity breathes per mage.
   */
  readonly vulnerableShell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /**
   * Stun (GDD §8.4): motes circling the head. Parented to `root` like the
   * support orb, so they keep orbiting while the body is being knocked around.
   */
  readonly stunMotes: THREE.Group;
  readonly stunMoteMaterial: THREE.MeshBasicMaterial;
  /**
   * Per-mage figure materials (cloned from the shared palette). Opacity is
   * animated on death/respawn; shared AssetManager mats must not be touched.
   */
  readonly fadeMaterials: THREE.MeshStandardMaterial[];
  /**
   * The colour each `fadeMaterials` entry was built with. Tinting a mage (ice
   * blanches it, fire embers it) has to lerp *from* somewhere, and once the
   * material has been tinted its own `color` is no longer that somewhere.
   */
  readonly baseColors: THREE.Color[];
  /** How blanched the figure currently is, 0..1 — eased so a slow fades in. */
  tint: number;
  /**
   * Everything this view must dispose — a superset of `fadeMaterials` that also
   * holds the gem halo, whose opacity is driven by charge rather than the fade.
   */
  readonly ownedMaterials: THREE.Material[];
  /** Current figure opacity, 0..1. */
  opacity: number;
  /** Secondary-motion spring state: angle and angular velocity, per axis. */
  swayX: number;
  swayZ: number;
  swayVelX: number;
  swayVelZ: number;
}

/**
 * Procedural Three.js renderer for child units. It observes simulation players
 * and mirrors them with lightweight cartoon primitives without mutating world
 * state.
 */
export class PlayerRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly activeIds = new Set<number>();
  private readonly views = new Map<number, PlayerView>();
  /** Renderer-local clock for status-effect spin; see updateStatusFx. */
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
  ) {
    this.group.name = 'PlayerRenderer';
    this.scene.add(this.group);

    for (const player of this.world.players) {
      this.ensureView(player);
    }
  }

  sync(alpha: number): void {
    this.clock += 1 / 60;
    this.activeIds.clear();

    for (const player of this.world.players) {
      this.activeIds.add(player.id);
      this.updateView(this.ensureView(player), player, alpha);
    }

    for (const [id, view] of this.views) {
      if (!this.activeIds.has(id)) {
        this.removeView(id, view);
      }
    }
  }

  dispose(): void {
    for (const [id, view] of this.views) {
      this.removeView(id, view);
    }
    this.scene.remove(this.group);
  }

  private ensureView(player: Player): PlayerView {
    const existing = this.views.get(player.id);
    if (existing) return existing;

    const view = this.buildView(player);
    this.views.set(player.id, view);
    this.group.add(view.root);
    return view;
  }

  private buildView(player: Player): PlayerView {
    const root = new THREE.Group();
    root.name = `player-${player.id}`;

    const figure = new THREE.Group();
    const look = lookFor(player.role);
    const teamColor = TEAM_COLORS[player.team];
    // Division of labour between the two things a player must read at a glance:
    // the robe carries the *team* (it is the biggest mass, and friend-or-foe can
    // never be ambiguous), the hat carries the *element*.
    //
    // The hat gets it because of the camera: the arena is viewed from above, so
    // the brim disc and the cone are the largest surfaces actually facing the
    // player. A 6cm band was the first attempt and it is sub-pixel at match
    // zoom — every mage looked identical from up there.
    const tint = elementTint(player.element, teamColor);

    const bodyMat = this.fadeMaterial(teamColor);
    const accentMat = this.fadeMaterial(this.darken(teamColor));
    // Double-sided because the collar is an open tube; the other parts sharing
    // this material are closed solids, which do not care either way.
    accentMat.side = THREE.DoubleSide;
    const faceMat = this.fadeMaterial(FACE_COLOR, { roughness: 1 });
    const eyeMat = this.fadeMaterial(EYE_COLOR, { emissive: EYE_GLOW });
    eyeMat.emissiveIntensity = EYE_INTENSITY;
    const bootMat = this.fadeMaterial(0x27313d);
    const leatherMat = this.fadeMaterial(0x7a5230);
    const woodMat = this.fadeMaterial(0x6b4f2a);
    // From `glow`, not `core`. The core is the hot centre of a projectile and
    // several elements have a white one — a lightning hat came out pale pink
    // and read as "no element" rather than as lightning. The glow is where each
    // element's actual hue lives (lightning gold, fire orange, poison green).
    const hatMat = this.fadeMaterial(this.asCloth(tint.glow));
    // The band now runs the *other* way — dark team color — so a sliver of team
    // survives on the hat and the brim edge stays defined against the ground.
    const bandMat = this.fadeMaterial(this.darken(teamColor));
    const buckleMat = this.fadeMaterial(0xe5e5e5, { metalness: 0.9, roughness: 0.2 });
    const gemMat = this.fadeMaterial(tint.core, { emissive: tint.glow, roughness: 0.35 });
    // The eyes are in here with everything else, so a dissolving corpse takes
    // its glow with it — two lights left burning over the spot where a mage fell
    // read as a live enemy standing there.
    const fadeMaterials = [
      bodyMat,
      accentMat,
      faceMat,
      eyeMat,
      bootMat,
      leatherMat,
      woodMat,
      hatMat,
      bandMat,
      buckleMat,
      gemMat,
    ];

    const ring = new THREE.Mesh(
      this.assets.geometry('player-selection-ring', () => {
        const geo = new THREE.RingGeometry(0.58, 0.72, 32);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      this.assets.material(
        'player-selection-ring-material',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0xfff06a,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
      ),
    );
    ring.position.y = 0.025;
    ring.visible = false;
    root.add(ring);

    const shieldRing = new THREE.Mesh(
      this.assets.geometry('player-shield-ring', () => {
        const geo = new THREE.RingGeometry(0.76, 0.86, 32);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      this.assets.material(
        'player-shield-ring-material',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
      ),
    );
    shieldRing.position.y = 0.03;
    shieldRing.visible = false;
    root.add(shieldRing);

    // The bubble the ring implies. Additive and thin so the mage inside stays
    // readable — an opaque shell would hide who is being protected.
    const shieldDome = new THREE.Mesh(
      this.assets.geometry(
        'player-shield-dome',
        () => new THREE.SphereGeometry(0.92, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      ),
      this.assets.material(
        'player-shield-dome-material',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
      ),
    );
    shieldDome.scale.y = 1.35;
    shieldDome.visible = false;
    root.add(shieldDome);

    /*
     * Marca do Carrasco is the one card that does nothing you can see when it
     * lands — it only pays later, and only against a target already dying. So
     * the single question it has to answer on screen is *who is carrying it*,
     * and that has to be legible from the camera's height across a whole squad.
     *
     * Above the crown rather than on the ground: every other status here owns a
     * ring at the feet, and a fourth one would be a fourth stripe in a stack the
     * eye already has to parse. Overhead is empty space, and a mark is the one
     * status that is genuinely *about* the individual rather than about the
     * fight around them.
     *
     * A cone pointed down, which at this size is a drop hanging. Not additive:
     * the drop should read as blood rather than as glow, and everything else
     * bright on this mage is already additive.
     */
    const markDrop = new THREE.Mesh(
      this.assets.geometry('player-mark-drop', () => {
        const geo = new THREE.ConeGeometry(0.1, 0.26, 8);
        // Point the tip at the ground: a drop hangs, it does not stand.
        geo.rotateX(Math.PI);
        return geo;
      }),
      new THREE.MeshBasicMaterial({ color: 0xd62839, transparent: true, opacity: 0 }),
    );
    markDrop.position.y = MARK_DROP_Y;
    markDrop.visible = false;
    root.add(markDrop);

    const hasteRing = this.buffRing('player-haste-ring', 0.9, 1.0, 0xffd166);
    root.add(hasteRing);

    const slowRing = this.buffRing('player-slow-ring', 1.04, 1.16, 0x8ecae6);
    root.add(slowRing);

    // Deliberately *not* a fourth ground ring: the ring radii from 0.58 to 1.42
    // are already spoken for (see SquadHighlightRenderer's budget), and a fifth
    // concentric circle turns the floor under a mage into a target.
    const vulnerableShell = new THREE.Mesh(
      this.assets.geometry(
        'player-vulnerable-shell',
        () => new THREE.SphereGeometry(0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      ),
      new THREE.MeshBasicMaterial({
        color: VULNERABLE_COLOR,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    vulnerableShell.scale.y = 1.5;
    vulnerableShell.visible = false;
    root.add(vulnerableShell);

    const { stunMotes, stunMoteMaterial } = this.buildStunMotes();
    root.add(stunMotes);

    // The robe flares to the ground where the old tunic was straight-sided; the
    // belly sphere below still does the heavy lifting for the stout silhouette.
    const robe = this.shadowMesh(
      this.assets.geometry(
        `player-robe-${look.hem}`,
        () => new THREE.CylinderGeometry(0.3, look.hem, 0.66, 14),
      ),
      bodyMat,
    );
    robe.position.y = 0.42;
    figure.add(robe);
    // Parented to the robe so the belt and the rolled hem ride its sway instead
    // of hanging in the air while the cloth swings out from under them.
    this.addRobeTrim(robe, look, accentMat);

    const belly = this.shadowMesh(
      this.assets.geometry('player-belly', () => new THREE.SphereGeometry(0.37, 14, 12)),
      bodyMat,
    );
    belly.scale.y = 0.78;
    belly.position.y = 0.3;
    figure.add(belly);

    // The flared collar: an open tube standing up around the jaw, which is what
    // actually puts the face in shadow. The old flat ring only broke up the body
    // at that height; this one is half the silhouette.
    const collar = this.shadowMesh(
      this.assets.geometry(
        'player-collar',
        () => new THREE.CylinderGeometry(0.33, 0.26, 0.2, 16, 1, true),
      ),
      accentMat,
    );
    // Its rim stops below the eyes: raised any higher, the collar takes over the
    // brim's job of hiding them.
    collar.position.y = 0.74;
    figure.add(collar);

    // No skin and no beard: under the brim there is a shadow with two lights in
    // it. The eyes carry the facing the beard used to (and carry it better —
    // from the match camera's height a beard was a lump on top of a lump), and
    // they are the same pair the title screen shows.
    const face = buildVoidFace(HEAD_RADIUS, faceMat, eyeMat);
    face.group.position.y = HEAD_Y;
    figure.add(face.group);

    const hatGroup = this.buildHat(look, hatMat, bandMat, buckleMat);
    figure.add(hatGroup);

    // Pushed out from the old ±0.35: the flared robe is wider than the straight
    // tunic was and swallowed the arms entirely at the previous offset.
    const leftArm = this.buildArm(bodyMat, leatherMat, -0.42);
    const rightArm = this.buildArm(bodyMat, leatherMat, 0.42);
    figure.add(leftArm, rightArm);

    // The staff hangs off the arm rather than the body, so every existing arm
    // pose — the throw windup, the walk swing — moves it for free.
    const { gem, gemHalo } = this.buildStaff(rightArm, woodMat, gemMat, tint.glow);

    const leftBoot = this.buildBoot(bootMat, -0.16);
    const rightBoot = this.buildBoot(bootMat, 0.16);
    figure.add(leftBoot, rightBoot);

    const orb = this.addRoleParts(player.role, figure, root, accentMat, gemMat);

    root.add(figure);
    return {
      root,
      figure,
      ring,
      shieldRing,
      shieldDome,
      markDrop,
      hasteRing,
      slowRing,
      vulnerableShell,
      stunMotes,
      stunMoteMaterial,
      leftArm,
      rightArm,
      hatGroup,
      robe,
      eyeMaterial: eyeMat,
      gem,
      gemHalo,
      orb,
      fadeMaterials,
      baseColors: fadeMaterials.map((m) => m.color.clone()),
      tint: 0,
      ownedMaterials: [
        ...fadeMaterials,
        gemHalo.material,
        vulnerableShell.material,
        stunMoteMaterial,
        markDrop.material,
      ],
      opacity: 1,
      swayX: 0,
      swayZ: 0,
      swayVelX: 0,
      swayVelZ: 0,
    };
  }

  /**
   * The pointed hat, ported from the `sim/test.html` study: brim, bent cone,
   * band and buckle. Grouped and pivoted at the crown ({@link HAT_PIVOT_Y}) so
   * {@link applySecondaryMotion} can swing the whole thing as one piece.
   */
  private buildHat(
    look: RoleLook,
    accentMat: THREE.Material,
    bandMat: THREE.Material,
    buckleMat: THREE.Material,
  ): THREE.Group {
    const hatGroup = new THREE.Group();
    hatGroup.position.y = HAT_PIVOT_Y;

    const brim = this.shadowMesh(
      // Narrow on purpose (see BRIM_RADIUS): seen from the match camera's 52°
      // elevation a wide brim is an umbrella that hides the entire head — eyes
      // and facing included.
      this.assets.geometry('player-hat-brim', () => hatBrimGeometry(BRIM_RADIUS, 0.025)),
      accentMat,
    );
    brim.position.y = 0.01;
    hatGroup.add(brim);

    // Cached per distinct hat height: the bend runs once for the whole match,
    // never per mage and never per frame.
    const cone = this.shadowMesh(
      this.assets.geometry(`player-hat-cone-${look.hatHeight}`, () =>
        hatConeGeometry(look.hatHeight, HAT_BASE_RADIUS),
      ),
      accentMat,
    );
    cone.position.y = look.hatHeight / 2;
    hatGroup.add(cone);

    // Open-ended so it reads as a band wrapped around the cone rather than a
    // second solid cone sitting on the brim. Its radius follows the cone's own
    // taper at the band's height — a fixed radius gripped the tall damage hat
    // and floated off the short tank one.
    const bandRadius = HAT_BASE_RADIUS * (1 - HAT_BAND_Y / look.hatHeight) + 0.005;
    const band = this.shadowMesh(
      this.assets.geometry(
        `player-hat-band-${look.hatHeight}`,
        () => new THREE.CylinderGeometry(bandRadius, bandRadius, 0.06, 20, 1, true),
      ),
      bandMat,
    );
    band.position.y = HAT_BAND_Y;
    hatGroup.add(band);

    const buckle = this.shadowMesh(
      this.assets.geometry('player-hat-buckle', () => new THREE.BoxGeometry(0.075, 0.075, 0.02)),
      buckleMat,
    );
    // +X is the mage's forward — where the eyes look — so the buckle faces the
    // camera whenever the mage is coming at you.
    buckle.position.set(bandRadius, HAT_BAND_Y, 0);
    buckle.rotation.y = Math.PI / 2;
    hatGroup.add(buckle);

    return hatGroup;
  }

  /**
   * The belt and the rolled hem, both parented to the robe so they inherit its
   * sway. Their radii are read off the robe's own taper at each height, so a
   * tank's wider hem does not leave its trim hanging inside the cloth.
   */
  private addRobeTrim(robe: THREE.Object3D, look: RoleLook, mat: THREE.Material): void {
    // The robe is a cone from `look.hem` at the bottom to 0.3 at the top, 0.66
    // tall and centred on its own origin.
    const radiusAt = (localY: number): number => {
      const t = (localY + 0.33) / 0.66;
      return look.hem + (0.3 - look.hem) * t;
    };

    for (const [localY, tube] of [
      [-0.325, 0.035],
      [-0.02, 0.03],
    ] as const) {
      const radius = radiusAt(localY);
      const trim = this.shadowMesh(
        this.assets.geometry(
          `player-robe-trim-${radius.toFixed(3)}-${tube}`,
          () => new THREE.TorusGeometry(radius, tube, 8, 20),
        ),
        mat,
      );
      trim.rotation.x = Math.PI / 2;
      trim.position.y = localY;
      robe.add(trim);
    }
  }

  /**
   * Staff and crystal, parented to the right arm so it inherits every pose in
   * {@link setArmPose} without touching the animation clips. The arm's own
   * resting tilt is cancelled here, otherwise the staff leans out sideways.
   */
  private buildStaff(
    arm: THREE.Object3D,
    woodMat: THREE.Material,
    gemMat: THREE.MeshStandardMaterial,
    glow: number,
  ): {
    gem: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    gemHalo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  } {
    const staff = new THREE.Group();
    // Held out at the hand end of the arm and pushed clear of the body: run it
    // any closer to the centerline and the pole crosses the mage's own face at
    // the arena camera's three-quarter angle.
    staff.position.set(0.1, -0.2, 0.16);
    staff.rotation.z = -0.22; // cancels the arm's resting lean (see buildArm)
    arm.add(staff);

    const pole = this.shadowMesh(
      this.assets.geometry(
        'player-staff-pole',
        () => new THREE.CylinderGeometry(0.025, 0.03, 1.0, 6),
      ),
      woodMat,
    );
    pole.position.y = 0.34;
    staff.add(pole);

    // The carved curl the crystal sits in. Built around an empty centre because
    // the gem swells with throw charge — the wood frames that space, it does not
    // occupy it.
    const head = buildSpiralStaffHead(0.12, woodMat);
    head.position.y = GEM_Y;
    staff.add(head);

    const gemGeo = this.assets.geometry(
      'player-staff-gem',
      () => new THREE.IcosahedronGeometry(0.075, 0),
    );
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.position.y = GEM_Y;
    gem.castShadow = true;
    staff.add(gem);

    // Backside + additive shell, the same halo recipe the structures use. Its
    // own material rather than a shared one: opacity here means "how charged is
    // *this* mage", so sharing it would light up the entire squad at once.
    const gemHalo = new THREE.Mesh(
      gemGeo,
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    gemHalo.position.y = GEM_Y;
    staff.add(gemHalo);

    return { gem, gemHalo };
  }

  /**
   * The one part of the figure that is role-specific beyond hem and hat: a tank
   * gets shoulders, a support gets a hood and an attendant mote. Damage dealers
   * carry their difference in the tall hat alone.
   *
   * Returns the support orb (or null), which the caller parks on `root`.
   */
  private addRoleParts(
    role: Role | undefined,
    figure: THREE.Group,
    root: THREE.Group,
    accentMat: THREE.Material,
    gemMat: THREE.Material,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null {
    if (role === 'tank') {
      const geo = this.assets.geometry(
        'player-pauldron',
        () => new THREE.SphereGeometry(0.17, 10, 8),
      );
      for (const z of [-0.34, 0.34]) {
        const pauldron = this.shadowMesh(geo, accentMat);
        pauldron.scale.y = 0.7;
        pauldron.position.set(0, 0.72, z);
        figure.add(pauldron);
      }
      return null;
    }

    if (role === 'support') {
      const hood = this.shadowMesh(
        this.assets.geometry('player-hood', () => new THREE.SphereGeometry(0.28, 12, 10)),
        accentMat,
      );
      hood.scale.set(1, 0.9, 0.95);
      hood.position.set(-0.06, 0.98, 0);
      figure.add(hood);

      const orb = this.shadowMesh(
        this.assets.geometry('player-orb', () => new THREE.IcosahedronGeometry(0.055, 0)),
        gemMat,
      );
      root.add(orb);
      return orb;
    }

    return null;
  }

  /** Private clone so death/respawn opacity does not tint every mage of that color. */
  private fadeMaterial(
    color: number,
    opts?: { emissive?: number; metalness?: number; roughness?: number },
  ): THREE.MeshStandardMaterial {
    const mat = this.assets.standardMaterial(color).clone();
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    if (opts?.emissive !== undefined) {
      mat.emissive = new THREE.Color(opts.emissive);
      mat.emissiveIntensity = 0.4;
    }
    if (opts?.metalness !== undefined) mat.metalness = opts.metalness;
    if (opts?.roughness !== undefined) mat.roughness = opts.roughness;
    return mat;
  }

  /**
   * A dashed status ring lying on the ground. Dashed rather than solid because
   * a mage can carry several of these at once (hasted *and* slowed is a normal
   * state), and concentric solid rings turn into a target painted on the floor.
   */
  private buffRing(
    key: string,
    inner: number,
    outer: number,
    color: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const mesh = new THREE.Mesh(
      this.assets.geometry(key, () => {
        const geo = new THREE.RingGeometry(inner, outer, 24, 1, 0, Math.PI * 1.55);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      this.assets.material(
        `${key}-material`,
        () =>
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
      ),
    );
    mesh.position.y = 0.035;
    mesh.visible = false;
    return mesh;
  }

  /**
   * A sleeve with the glove at the end of it. The glove hangs off the arm rather
   * than the body so every existing pose — the walk swing, the throw windup —
   * moves the hand with the sleeve, and the staff stays in the fist.
   */
  private buildArm(
    sleeveMat: THREE.Material,
    gloveMat: THREE.Material,
    z: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const arm = this.shadowMesh(
      this.assets.geometry('player-arm', () => new THREE.CapsuleGeometry(0.055, 0.3, 4, 8)),
      sleeveMat,
    );
    arm.position.set(0.02, 0.52, z);
    arm.rotation.z = z < 0 ? -0.22 : 0.22;

    const glove = this.shadowMesh(
      this.assets.geometry('player-glove', () => new THREE.SphereGeometry(0.082, 10, 8)),
      gloveMat,
    );
    glove.position.y = -0.2;
    arm.add(glove);

    return arm;
  }

  private buildBoot(
    mat: THREE.Material,
    z: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const boot = this.shadowMesh(
      this.assets.geometry('player-boot', () => new THREE.CapsuleGeometry(0.075, 0.13, 4, 8)),
      mat,
    );
    // Capsule laid on its side so the axis runs along +X, the mage's forward:
    // the toe is then a curve pointing where it walks rather than a flat end.
    boot.rotation.z = Math.PI / 2;
    // Forward of the old x=0.1 so the toes peek out from under the robe hem.
    // Left where they were, the flared robe hid them and the mage read as a
    // cone sliding across the ground.
    boot.position.set(0.3, 0.075, z);
    return boot;
  }

  private updateView(view: PlayerView, player: Player, alpha: number): void {
    const defeated = !player.alive || player.state === PlayerState.Defeated;
    const scale = player.radius / PLAYER.radius;

    toThree(this.tmp, player.position.x, player.position.y, 0);
    view.root.position.copy(this.tmp);
    view.root.rotation.y = -player.rotation;
    view.root.scale.setScalar(scale);

    view.ring.visible = player.selected && !defeated;
    this.updateStatusFx(view, player, defeated);
    this.updateDeathFade(view, player, defeated);
    this.updateStaff(view, player, defeated);
    this.updateOrb(view, defeated);

    if (defeated) {
      view.figure.position.y = 0.16;
      view.figure.rotation.set(0, 0, Math.PI / 2);
      view.figure.scale.set(1, 0.55, 1);
      // A corpse must lie still. Without this the spring keeps swinging the hat
      // on a body that is already flat on the ground.
      this.restSway(view);
      return;
    }

    const renderTime = player.animationTime + alpha / 60;
    this.applyAnimation(view, player, renderTime);
    this.applySecondaryMotion(view, player);
  }

  /**
   * The staff crystal as a charge readout. `throwCharge` already arrives from
   * the server on every snapshot and had no visual anywhere — an opponent
   * winding up a fully charged shot looked exactly like one standing still.
   */
  private updateStaff(view: PlayerView, player: Player, defeated: boolean): void {
    const charge = defeated ? 0 : clamp(player.throwCharge, 0, 1);

    view.gem.scale.setScalar(1 + charge * 0.7);
    view.gem.rotation.y = this.clock * 1.4;
    view.gem.material.emissiveIntensity = 0.4 + charge * 1.6;

    // The pulse is scaled by charge, so an idle mage's gem sits still and only
    // a mage actually winding up throbs.
    const pulse = Math.sin(this.clock * 9) * charge * 0.12;
    view.gemHalo.visible = view.opacity > 0.02;
    // Kept small on purpose: a halo that grows past the hat swallows the mage
    // it is supposed to be describing. Brightness carries the charge, not size.
    view.gemHalo.scale.setScalar(1.7 + charge * 0.7 + pulse);
    view.gemHalo.material.opacity = (0.1 + charge * 0.6) * view.opacity;
  }

  /** Support's attendant mote, circling the head on `root` (never the body's squash). */
  private updateOrb(view: PlayerView, defeated: boolean): void {
    const orb = view.orb;
    if (!orb) return;

    orb.visible = !defeated && view.opacity > 0.02;
    if (!orb.visible) return;

    const angle = this.clock * 1.1;
    orb.position.set(Math.cos(angle) * 0.36, 1.16 + Math.sin(this.clock * 2.2) * 0.05, Math.sin(angle) * 0.36);
    orb.rotation.y = angle * 2;
  }

  /**
   * Dissolves a fallen mage after a short hold, then fades them back in on
   * respawn. Driven by `animationTime` while defeated (reset when the defeated
   * clip starts) so online and practice share the same beat.
   */
  private updateDeathFade(view: PlayerView, player: Player, defeated: boolean): void {
    let opacity: number;
    if (defeated) {
      const t = Math.max(0, (player.animationTime - DEATH_FADE_HOLD) / DEATH_FADE_DURATION);
      opacity = 1 - Math.min(1, t);
    } else if (view.opacity >= 1) {
      opacity = 1;
    } else {
      opacity = Math.min(1, view.opacity + RENDER_DT / RESPAWN_FADE_IN);
    }
    this.setFigureOpacity(view, opacity);
  }

  private setFigureOpacity(view: PlayerView, opacity: number): void {
    view.opacity = opacity;
    view.figure.visible = opacity > 0.02;
    const transparent = opacity < 0.999;
    for (const mat of view.fadeMaterials) {
      mat.opacity = opacity;
      mat.transparent = transparent;
      mat.depthWrite = !transparent;
    }
  }

  /**
   * Washes the whole figure toward `color`. Reads from `baseColors` rather than
   * from the materials themselves, so repeated calls converge on the target
   * instead of compounding into it.
   */
  private setFigureTint(view: PlayerView, color: THREE.Color, amount: number): void {
    view.tint = amount;
    for (let i = 0; i < view.fadeMaterials.length; i++) {
      const mat = view.fadeMaterials[i];
      const base = view.baseColors[i];
      if (amount <= 0.001) mat.color.copy(base);
      else mat.color.copy(base).lerp(color, amount);
    }
  }

  /**
   * Shows which spells and elemental effects are currently *on* this mage
   * (GDD §8, §9).
   *
   * The ground rings only move their transforms: those materials are shared
   * across every mage, so animating their opacity here would animate
   * everybody's. The two effects that *are* per-mage — the frost wash and the
   * vulnerability shell — own their materials for exactly that reason.
   */
  private updateStatusFx(view: PlayerView, player: Player, defeated: boolean): void {
    const shielded = Boolean(player.shielded) && !defeated;
    view.shieldRing.visible = shielded;
    view.shieldDome.visible = shielded;

    const hasted = Boolean(player.hasted) && !defeated;
    view.hasteRing.visible = hasted;
    const slowed = Boolean(player.slowed) && !defeated;
    view.slowRing.visible = slowed;

    // Direction and speed carry the meaning: haste races forward, the slow
    // curse grinds backwards at a fraction of the rate. Driven by the
    // renderer's own clock, not `animationTime`, which restarts at every
    // animation change and would make the rings jump.
    const t = this.clock;
    if (hasted) view.hasteRing.rotation.y = t * 4.5;
    if (slowed) view.slowRing.rotation.y = -t * 0.9;
    if (shielded) view.shieldDome.rotation.y = t * 0.6;

    this.updateMarkDrop(view, player, defeated);
    this.updateBodyTint(view, player, defeated);
    this.updateVulnerableShell(view, player, defeated);
    this.updateStunMotes(view, player, defeated);
  }

  /**
   * Ice blanches a mage; fire embers it. The ring on the floor says *that*
   * something is on this mage, but at the match camera's angle a ring under a
   * scrum of eight is easy to lose — the body colour is the part you read
   * without looking for it.
   *
   * Eased rather than snapped: the effects arrive at 20Hz, and a hard cut to
   * pale on the snapshot boundary reads as a rendering glitch.
   */
  private updateBodyTint(view: PlayerView, player: Player, defeated: boolean): void {
    const burning = !defeated && hasFx(player, 'burn');
    const frozen = !defeated && Boolean(player.slowed);

    // Stone takes the whole body, and takes it outright rather than by degree.
    // Every other tint here is partial on purpose — a mage still has to read as
    // its team colour in a scrum — but petrify is the one status that removes a
    // mage from the fight in both directions, and a body that is only *mostly*
    // grey would be saying "somewhat out of the fight", which is not a state
    // this card has. It also wins over fire and ice for the same reason fire
    // wins over ice: it is the more urgent fact about that body.
    if (!defeated && hasFx(player, 'petrify')) {
      view.tint = 1;
      this.setFigureTint(view, STONE_COLOR, 1);
      // And the lights go out. Greying the albedo is not enough on its own: the
      // eyes are emissive, so a stone mage would keep staring out of a grey
      // face — the same tell the hat spring is stopped for below.
      view.eyeMaterial.emissiveIntensity = 0;
      return;
    }

    view.eyeMaterial.emissiveIntensity = EYE_INTENSITY;

    let target = 0;
    let color = FROST_COLOR;
    if (burning) {
      // Fire wins the body when both are on: a burning mage is the one about to
      // die, and that is the more urgent thing to show.
      color = EMBER_COLOR;
      target = Math.min(0.15 + fxStacks(player, 'burn') * 0.12, 0.5);
    } else if (frozen) {
      target = FROST_TINT_MAX;
    }

    const eased = view.tint + (target - view.tint) * Math.min(1, RENDER_DT * TINT_EASE_RATE);
    this.setFigureTint(view, color, eased);
  }

  private updateVulnerableShell(view: PlayerView, player: Player, defeated: boolean): void {
    const marked = !defeated && hasFx(player, 'vulnerable');
    view.vulnerableShell.visible = marked && view.opacity > 0.02;
    if (!marked) return;

    // A slow throb rather than a steady glow: the mark is a warning, and a
    // static shell disappears into the scene after a second of looking at it.
    view.vulnerableShell.material.opacity = 0.16 + Math.sin(this.clock * 3.4) * 0.07;
    view.vulnerableShell.rotation.y = this.clock * 0.8;
  }

  /**
   * Marca do Carrasco's drop: hangs over the crown for as long as the mark
   * runs, bobbing and breathing.
   *
   * Kept alive for the whole mark rather than only while it is *paying* — the
   * mark is inert until the target drops under the execute threshold, and the
   * player's decision (send the squad at this one) has to be makeable before
   * that, not after. Showing it only once it pays would light up exactly when
   * the information stopped being actionable.
   */
  private updateMarkDrop(view: PlayerView, player: Player, defeated: boolean): void {
    const marked = hasFx(player, 'marked') && !defeated;
    view.markDrop.visible = marked;
    if (!marked) {
      view.markDrop.material.opacity = 0;
      return;
    }

    const t = this.clock;
    // A slow swell rather than a blink: this is a standing condition, and a
    // blinking overhead marker reads as an alert that wants clicking — which is
    // the one thing the player cannot do in this game.
    view.markDrop.material.opacity = 0.72 + Math.sin(t * 3) * 0.22;
    view.markDrop.position.y = MARK_DROP_Y + Math.sin(t * 2) * 0.05;
    view.markDrop.rotation.y = t * 1.2;
  }

  private updateStunMotes(view: PlayerView, player: Player, defeated: boolean): void {
    const stunned = !defeated && hasFx(player, 'stun');
    view.stunMotes.visible = stunned && view.opacity > 0.02;
    if (!stunned) return;

    // Fast, flat and overhead — the cartoon shorthand, which is the only thing
    // that reads at this camera distance in under a second.
    view.stunMotes.rotation.y = this.clock * 5.5;
    view.stunMoteMaterial.opacity = 0.65 + Math.sin(this.clock * 11) * 0.25;
  }

  /** Three motes on a ring above the crown; the group is what spins. */
  private buildStunMotes(): {
    stunMotes: THREE.Group;
    stunMoteMaterial: THREE.MeshBasicMaterial;
  } {
    const stunMotes = new THREE.Group();
    stunMotes.position.y = STUN_MOTE_HEIGHT;
    stunMotes.visible = false;

    const material = new THREE.MeshBasicMaterial({
      color: STUN_COLOR,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const geo = this.assets.geometry('player-stun-mote', () => new THREE.SphereGeometry(0.06, 8, 6));

    for (let i = 0; i < STUN_MOTE_COUNT; i++) {
      const mote = new THREE.Mesh(geo, material);
      const angle = (i / STUN_MOTE_COUNT) * Math.PI * 2;
      mote.position.set(Math.cos(angle) * 0.3, 0, Math.sin(angle) * 0.3);
      stunMotes.add(mote);
    }

    return { stunMotes, stunMoteMaterial: material };
  }

  private applyAnimation(view: PlayerView, player: Player, renderTime: number): void {
    view.figure.position.y = 0;
    view.figure.rotation.set(0, 0, 0);
    view.figure.scale.set(1, 1, 1);
    this.setArmPose(view, 0, 0, 0);

    // Stone does not breathe. Returning on the neutral pose above is the whole
    // implementation: every animation here is a displacement from it, so
    // skipping the switch leaves the mage standing dead still with its arms
    // down. That matters more than it sounds — the idle bob is small but it is
    // *constant*, and a grey mage still gently breathing reads as a mage with a
    // palette problem rather than as a statue. The hat spring is skipped in
    // `applySecondaryMotion` for the same reason: a statue with a swaying hat
    // is a statue nobody believes.
    if (hasFx(player, 'petrify') && player.state !== PlayerState.Defeated) return;

    switch (player.currentAnimation) {
      case 'idle':
        this.applyIdle(view, renderTime);
        break;
      case 'walk':
        this.applyWalk(view, player, renderTime);
        break;
      case 'throw':
        this.applyThrow(view, renderTime);
        break;
      case 'hit':
        this.applyHit(view, renderTime);
        break;
      case 'victory':
        this.applyVictory(view, renderTime);
        break;
      case 'defeated':
        break;
    }
  }

  private applyIdle(view: PlayerView, renderTime: number): void {
    const phase = Math.sin(renderTime * 3);
    view.figure.position.y = 0.012 + phase * 0.01;
    view.figure.scale.set(1 + phase * 0.012, 1 - phase * 0.008, 1 + phase * 0.012);
  }

  private applyWalk(view: PlayerView, player: Player, renderTime: number): void {
    const speedScale = Math.min(player.velocity.length() / PLAYER.moveSpeed, 1);
    const phase = Math.sin(renderTime * 12);
    const bob = Math.abs(phase) * 0.04 * speedScale;
    const armSwing = phase * 0.34 * speedScale;

    view.figure.position.y = bob;
    view.figure.rotation.x = phase * 0.08 * speedScale;
    this.setArmPose(view, armSwing, -armSwing, 0);
  }

  private applyThrow(view: PlayerView, renderTime: number): void {
    const t = Math.min(renderTime, 0.55);
    const windup = Math.min(t / 0.22, 1);
    const release = Math.min(Math.max((t - 0.22) / 0.16, 0), 1);
    const lean = -0.26 * (1 - release) * windup + 0.22 * release * (1 - release);

    view.figure.rotation.z = lean;
    view.figure.position.y = 0.01 * windup;
    this.setArmPose(view, -0.18 - windup * 0.42 + release * 0.65, 0.12 + windup * 0.36, 0.08 * windup);
  }

  private applyHit(view: PlayerView, renderTime: number): void {
    const recoil = Math.max(0, 1 - renderTime / 0.35);
    const eased = recoil * recoil;

    view.figure.rotation.z = 0.34 * eased;
    view.figure.position.y = 0.025 * eased;
    view.figure.scale.set(1 + 0.08 * eased, 1 - 0.12 * eased, 1 + 0.05 * eased);
    this.setArmPose(view, -0.32 * eased, 0.32 * eased, 0);
  }

  private applyVictory(view: PlayerView, renderTime: number): void {
    const phase = Math.sin(renderTime * 9);
    const hop = Math.max(0, phase) * 0.08;

    view.figure.position.y = hop;
    view.figure.rotation.y = renderTime * 2.4;
    view.figure.rotation.z = Math.sin(renderTime * 6) * 0.08;
    this.setArmPose(view, -0.85 + phase * 0.12, 0.85 - phase * 0.12, 0.18);
  }

  /**
   * The hat tip and robe hem lagging behind the body. Deliberately a layer
   * *on top of* the animation clips rather than a change to them: every curve
   * in `applyIdle`/`applyWalk`/`applyThrow` keeps its existing timing, and this
   * only adds the inertia those hand-rolled sines never had.
   *
   * Runs after `applyAnimation`, which resets the figure transform each frame —
   * the spring state lives on the view precisely because of that reset.
   */
  private applySecondaryMotion(view: PlayerView, player: Player): void {
    // A statue with a swaying hat is a statue nobody believes. Settled to rest
    // rather than frozen where it was: a tip caught mid-swing would hold a
    // diagonal for two and a half seconds, which reads as a stuck frame.
    if (hasFx(player, 'petrify') && player.state !== PlayerState.Defeated) {
      view.swayZ = 0;
      view.swayX = 0;
      view.swayVelZ = 0;
      view.swayVelX = 0;
      view.hatGroup.rotation.set(0, 0, 0);
      view.robe.rotation.set(0, 0, 0);
      return;
    }

    // Velocity in the figure's own frame: +X is where the mage faces, +Z is its
    // left (see `coords.ts` and `root.rotation.y = -player.rotation`).
    const cos = Math.cos(player.rotation);
    const sin = Math.sin(player.rotation);
    const vx = player.velocity.x;
    const vy = player.velocity.y;
    const forward = (vx * cos + vy * sin) / PLAYER.moveSpeed;
    const leftward = (-vx * sin + vy * cos) / PLAYER.moveSpeed;

    // Moving forward throws the tip backward, and vice versa — the sign of each
    // axis is what makes it read as drag rather than as a wobble.
    const targetZ = clamp(forward, -1, 1) * SWAY_AT_FULL_SPEED;
    const targetX = -clamp(leftward, -1, 1) * SWAY_AT_FULL_SPEED;

    view.swayVelZ += ((targetZ - view.swayZ) * SWAY_STIFFNESS - view.swayVelZ * SWAY_DAMPING) * RENDER_DT;
    view.swayVelX += ((targetX - view.swayX) * SWAY_STIFFNESS - view.swayVelX * SWAY_DAMPING) * RENDER_DT;
    view.swayZ = clamp(view.swayZ + view.swayVelZ * RENDER_DT, -SWAY_LIMIT, SWAY_LIMIT);
    view.swayX = clamp(view.swayX + view.swayVelX * RENDER_DT, -SWAY_LIMIT, SWAY_LIMIT);

    view.hatGroup.rotation.z = view.swayZ;
    view.hatGroup.rotation.x = view.swayX;
    // Opposed and weaker: the hem is heavy cloth swinging against a light tip.
    view.robe.rotation.z = -view.swayZ * HEM_SWAY_RATIO;
    view.robe.rotation.x = -view.swayX * HEM_SWAY_RATIO;
  }

  /** Parks the sway spring at zero — used when the mage is down. */
  private restSway(view: PlayerView): void {
    view.swayX = 0;
    view.swayZ = 0;
    view.swayVelX = 0;
    view.swayVelZ = 0;
    view.hatGroup.rotation.set(0, 0, 0);
    view.robe.rotation.set(0, 0, 0);
  }

  private setArmPose(view: PlayerView, leftX: number, rightX: number, lift: number): void {
    view.leftArm.rotation.x = leftX;
    view.rightArm.rotation.x = rightX;
    view.leftArm.rotation.y = lift;
    view.rightArm.rotation.y = -lift;
  }

  private shadowMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  private removeView(id: number, view: PlayerView): void {
    this.group.remove(view.root);
    for (const mat of view.ownedMaterials) mat.dispose();
    this.views.delete(id);
  }

  private darken(color: number): number {
    return new THREE.Color(color).offsetHSL(0, 0.05, -0.18).getHex();
  }

  /**
   * Turns a spell color into a wearable one. The element palette is tuned for
   * things that emit light, so its entries span the whole lightness range —
   * lightning is nearly white, poison nearly black. Shifting them all by a
   * fixed amount kept those extremes: a blown-out hat and a muddy one.
   *
   * Instead every hat is forced into one narrow lightness band and saturated,
   * so the seven hats differ by *hue alone*. Hue is what survives the arena
   * camera's distance; lightness differences just read as shadow.
   */
  private asCloth(color: number): number {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(color).getHSL(hsl);
    return new THREE.Color()
      .setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.15), clamp(hsl.l, 0.34, 0.56))
      .getHex();
  }
}
