import * as THREE from 'three';
import type { Role } from '../../sim/roles';
import type { GameRenderer } from '../core/Game';
import type { AssetManager } from '../engine/AssetManager';
import { PLAYER, TEAM_COLORS } from '../game/config';
import { PlayerState, type Player } from '../game/types';
import type { World } from '../game/World';
import { clamp } from '../utils/math';
import { toThree } from './coords';
import { elementTint } from './elementPalette';

/** Brief hold on the fallen pose before the corpse starts dissolving. */
const DEATH_FADE_HOLD = 0.35;
/** Seconds to fade a downed mage out so the body does not clutter the arena. */
const DEATH_FADE_DURATION = 1.15;
/** Soft pop-in when a mage returns at the spawn pad. */
const RESPAWN_FADE_IN = 0.3;
/** Approximate frame step used by {@link PlayerRenderer.sync}. */
const RENDER_DT = 1 / 60;

/**
 * Where the hat pivots: the crown of the head. Rotating the whole hat group
 * from here swings the bent tip while the brim stays seated — pivoting at the
 * hat's own origin would slide the brim off the head instead.
 */
const HAT_PIVOT_Y = 1.1;
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
   * Per-mage figure materials (cloned from the shared palette). Opacity is
   * animated on death/respawn; shared AssetManager mats must not be touched.
   */
  readonly fadeMaterials: THREE.MeshStandardMaterial[];
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
    const skinMat = this.fadeMaterial(0xffd6a5);
    const bootMat = this.fadeMaterial(0x27313d);
    const woodMat = this.fadeMaterial(0x6b4f2a);
    const beardMat = this.fadeMaterial(0xe8e4dc);
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
    const fadeMaterials = [
      bodyMat,
      accentMat,
      skinMat,
      bootMat,
      woodMat,
      beardMat,
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

    const hasteRing = this.buffRing('player-haste-ring', 0.9, 1.0, 0xffd166);
    root.add(hasteRing);

    const slowRing = this.buffRing('player-slow-ring', 1.04, 1.16, 0x8ecae6);
    root.add(slowRing);

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

    const belly = this.shadowMesh(
      this.assets.geometry('player-belly', () => new THREE.SphereGeometry(0.37, 14, 12)),
      bodyMat,
    );
    belly.scale.y = 0.78;
    belly.position.y = 0.3;
    figure.add(belly);

    // Replaces the scarf: a collar closes the robe at the neck and keeps the
    // accent band that used to break up the body at that height.
    const collar = this.shadowMesh(
      this.assets.geometry('player-collar', () => new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14)),
      accentMat,
    );
    collar.position.y = 0.76;
    figure.add(collar);

    const head = this.shadowMesh(
      this.assets.geometry('player-head', () => new THREE.SphereGeometry(0.25, 14, 12)),
      skinMat,
    );
    head.position.y = 0.95;
    figure.add(head);

    // Takes over the job the carrot nose used to do: with a bare sphere for a
    // head there is nothing to say which way a mage is facing, and facing is
    // what the aim direction reads from. A beard points forward and down, and
    // its pale color survives whatever the hat and robe are tinted.
    const beard = this.shadowMesh(
      this.assets.geometry('player-beard', () => new THREE.ConeGeometry(0.19, 0.46, 8)),
      beardMat,
    );
    // Juts forward rather than hanging straight down, so the tip clears the hat
    // brim when the arena camera looks down on it.
    beard.position.set(0.24, 0.66, 0);
    beard.rotation.z = Math.PI + 0.6;
    figure.add(beard);

    const hatGroup = this.buildHat(look, hatMat, bandMat, buckleMat);
    figure.add(hatGroup);

    // Pushed out from the old ±0.35: the flared robe is wider than the straight
    // tunic was and swallowed the arms entirely at the previous offset.
    const leftArm = this.buildArm(bodyMat, -0.42);
    const rightArm = this.buildArm(bodyMat, 0.42);
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
      hasteRing,
      slowRing,
      leftArm,
      rightArm,
      hatGroup,
      robe,
      gem,
      gemHalo,
      orb,
      fadeMaterials,
      ownedMaterials: [...fadeMaterials, gemHalo.material],
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
      // 0.40, not the 0.50 the study used: seen from the match camera's 52°
      // tilt a wide brim is an umbrella that hides the entire head, beard and
      // facing included.
      this.assets.geometry('player-hat-brim', () => new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24)),
      accentMat,
    );
    brim.position.y = 0.01;
    hatGroup.add(brim);

    const cone = this.shadowMesh(this.hatConeGeometry(look.hatHeight), accentMat);
    cone.position.y = look.hatHeight / 2;
    hatGroup.add(cone);

    // Open-ended so it reads as a band wrapped around the cone rather than a
    // second solid cone sitting on the brim.
    const band = this.shadowMesh(
      this.assets.geometry(
        'player-hat-band',
        () => new THREE.CylinderGeometry(0.305, 0.305, 0.06, 20, 1, true),
      ),
      bandMat,
    );
    band.position.y = 0.045;
    hatGroup.add(band);

    const buckle = this.shadowMesh(
      this.assets.geometry('player-hat-buckle', () => new THREE.BoxGeometry(0.075, 0.075, 0.02)),
      buckleMat,
    );
    // +X is the mage's forward — where the old carrot nose pointed — so the
    // buckle faces the camera whenever the mage is coming at you.
    buckle.position.set(0.305, 0.045, 0);
    buckle.rotation.y = Math.PI / 2;
    hatGroup.add(buckle);

    return hatGroup;
  }

  /**
   * The cone with the curled tip. The bend is the vertex pass from the
   * `sim/test.html` study, with two changes: it runs over six height segments
   * so the point actually *curves* instead of shearing in a straight line, and
   * it leans along -X — the study bent toward +X, which here is the direction
   * the mage faces, folding the point down over its own eyes.
   *
   * Deliberately inside the geometry cache: the deformation runs once per
   * distinct hat height for the whole match, never per mage and never per frame.
   */
  private hatConeGeometry(height: number): THREE.BufferGeometry {
    return this.assets.geometry(`player-hat-cone-${height}`, () => {
      const geo = new THREE.CylinderGeometry(0.012, 0.3, height, 16, 6);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y <= 0) continue;
        // Quadratic in normalized height: the base stays planted on the head
        // and the curl accelerates toward the tip.
        const factor = ((y + height / 2) / height) ** 2;
        pos.setX(i, pos.getX(i) - factor * height * 0.5);
        pos.setZ(i, pos.getZ(i) + factor * height * 0.16);
      }
      geo.computeVertexNormals();
      return geo;
    });
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

    const gemGeo = this.assets.geometry(
      'player-staff-gem',
      () => new THREE.IcosahedronGeometry(0.075, 0),
    );
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.position.y = 0.86;
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
    gemHalo.position.y = 0.86;
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

  private buildArm(
    mat: THREE.Material,
    z: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const arm = this.shadowMesh(
      this.assets.geometry('player-arm', () => new THREE.CylinderGeometry(0.055, 0.07, 0.42, 8)),
      mat,
    );
    arm.position.set(0.02, 0.52, z);
    arm.rotation.z = z < 0 ? -0.22 : 0.22;
    return arm;
  }

  private buildBoot(
    mat: THREE.Material,
    z: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
    const boot = this.shadowMesh(
      this.assets.geometry('player-boot', () => new THREE.SphereGeometry(0.12, 8, 8)),
      mat,
    );
    boot.scale.set(1.25, 0.55, 0.9);
    // Forward of the old x=0.1 so the toes peek out from under the robe hem.
    // Left where they were, the flared robe hid them and the mage read as a
    // cone sliding across the ground.
    boot.position.set(0.34, 0.07, z);
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
   * Shows which spells are currently *on* this mage (GDD §9). Only the
   * transforms move: the materials are shared across every mage, so animating
   * their opacity here would animate everybody's.
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
  }

  private applyAnimation(view: PlayerView, player: Player, renderTime: number): void {
    view.figure.position.y = 0;
    view.figure.rotation.set(0, 0, 0);
    view.figure.scale.set(1, 1, 1);
    this.setArmPose(view, 0, 0, 0);

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
