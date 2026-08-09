import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EventBus } from '../core/EventBus';
import type { GameRenderer } from '../core/Game';
import type { EntityId } from '../ecs/Entity';
import type { AssetManager } from '../engine/AssetManager';
import type { Player } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';
import { ELEMENT_TINT } from './elementPalette';

/**
 * What the two support mages actually *do*, drawn (GDD §8, and §530's open
 * question: "is the support legible?").
 *
 * Until now the answer was no. A Cleric healed and a Bard hastened with
 * nothing on screen at all — the only evidence was a health bar creeping up
 * somewhere else on the field, which nobody watching a fight is looking at.
 *
 * What is drawn, and what deliberately is not:
 * - **The Cleric's link**, a beam to the ally it is currently topping up, plus
 *   small green crosses on that ally. This is the whole story of the heal:
 *   who, to whom, right now.
 * - **A few motes** rising off each support, so a mage that is quietly working
 *   is not indistinguishable from one standing idle.
 * - **No range rings.** Both effects are radius-based, and a ground ring at
 *   the true radius (5 and 4 world units) is enormous next to a mage. Drawn,
 *   two of them owned the midfield and read as the main event; the first thing
 *   anyone asked on seeing one was what it was. The beam already says who is
 *   being healed, which is the part that matters in a fight — the exact reach
 *   is a number, not a picture.
 *
 * Keyed off `player.element`: since each roster entry owns one element, `holy`
 * *is* the Cleric and `sonic` *is* the Bard. Nothing new crosses the wire.
 *
 * Online-only, like {@link PuddleRenderer} — offline mages carry no element.
 */

/** Motes lifted off each support per second. Deliberately sparse. */
const MOTE_RATE = 3;
const MOTE_LIFE = 1.1;
const MOTE_RISE = 1.6;
/**
 * How far out from the mage motes start. Close in, on purpose: this is a hint
 * that the mage is doing something, not a map of how far the something reaches.
 */
const MOTE_SPREAD = 0.55;
/**
 * How long a beam survives without another heal arriving. The Cleric heals
 * continuously (8 HP/s), so `MageHealed` lands on every snapshot — this is a
 * *keep-alive*, not a lifetime: each heal refreshes the one beam that already
 * connects the pair, and it fades only once the healing actually stops.
 */
const BEAM_LINGER = 0.3;
const BEAM_RADIUS = 0.055;
/** Where a beam attaches on both mages, in world units above the ground. */
const BEAM_HEIGHT = 1.1;
/**
 * Seconds between the green crosses that mark a heal landing. Heals arrive far
 * faster than this; without the throttle the target would disappear inside a
 * cloud of them.
 */
const CROSS_INTERVAL = 0.45;
const CROSS_LIFE = 0.85;
const CROSS_RISE = 1.15;
/** Peak opacity of a cross. Solid enough to name the colour, faint enough to stay a hint. */
const CROSS_OPACITY = 0.9;
/**
 * Classic heal green, deliberately not the Cleric's gold: gold is who, green
 * is what. Saturated rather than pastel — the arena floor is *also* green, and
 * a pale mint cross on grass just reads as a white speck.
 */
const HEAL_GREEN = 0x1fd655;

/** Per-support mote emission. No mesh: the rings are gone, only the drip remains. */
interface AuraView {
  /** Fractional motes owed, so a sparse rate does not round down to zero every frame. */
  moteDebt: number;
}

/**
 * One live beam per Cleric — not per heal event. `World.healPulse` tops up a
 * single ally at a time, so a Cleric has exactly one link at any moment, and
 * both ends are re-read from the mages every frame so the line follows them as
 * they move.
 */
interface BeamView {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  targetId: EntityId;
  /** Seconds until it fades, refreshed by every incoming heal. */
  linger: number;
  /** Seconds until the next green cross is dropped on the target. */
  crossCooldown: number;
}

const MOTE_POOL_SIZE = 48;
const CROSS_POOL_SIZE = 16;

interface MoteSlot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  vy: number;
}

export class SupportRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly views = new Map<EntityId, AuraView>();
  /** Keyed by healer: one Cleric, one link. */
  private readonly beams = new Map<EntityId, BeamView>();
  private readonly moteSlots: MoteSlot[] = [];
  private readonly crossSlots: MoteSlot[] = [];
  private readonly offMageHealed: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
    events: EventBus,
  ) {
    this.group.name = 'SupportRenderer';
    this.scene.add(this.group);

    const moteGeometry = assets.geometry(
      'support-renderer-mote',
      () => new THREE.OctahedronGeometry(1, 0),
    );
    const crossGeometry = assets.geometry('support-renderer-cross', () => {
      const upright = new THREE.BoxGeometry(0.34, 1, 0.12);
      const bar = new THREE.BoxGeometry(1, 0.34, 0.12);
      const merged = mergeGeometries([upright, bar], false);
      upright.dispose();
      bar.dispose();
      if (!merged) throw new Error('SupportRenderer: failed to merge the heal cross');
      return merged;
    });

    for (let i = 0; i < MOTE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(moteGeometry, this.additive(ELEMENT_TINT.holy.core, 0));
      mesh.visible = false;
      this.group.add(mesh);
      this.moteSlots.push({ mesh, life: 0, maxLife: MOTE_LIFE, vy: MOTE_RISE });
    }

    for (let i = 0; i < CROSS_POOL_SIZE; i++) {
      /*
       * The one mark here that is NOT additive. Additive green over the arena's
       * green floor — or over a mage's bright hat — adds up to white, which is
       * exactly what the cross must not be: it is the only thing on screen
       * saying "healed", and it says it by being green. Normal blending keeps
       * the hue; `depthTest: false` keeps it from being swallowed by the mage
       * it belongs to.
       */
      const material = new THREE.MeshBasicMaterial({
        color: HEAL_GREEN,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(crossGeometry, material);
      // Drawn after the mages, so it reads as an overlay rather than as
      // something buried in the crowd.
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.group.add(mesh);
      this.crossSlots.push({ mesh, life: 0, maxLife: CROSS_LIFE, vy: CROSS_RISE });
    }

    this.offMageHealed = events.on('MageHealed', (event) => {
      this.registerHeal(event.healerId, event.playerId);
    });
  }

  /*
   * Fixed 1/60 step throughout, matching ParticleRenderer: every timer here is
   * cosmetic and only has to look continuous.
   */
  sync(): void {
    const seen = new Set<EntityId>();
    for (const player of this.world.players) {
      const kind = supportKind(player);
      if (!kind || !player.alive) continue;
      seen.add(player.id);
      this.updateView(this.ensureView(player.id), player, kind);
    }

    for (const id of this.views.keys()) {
      if (!seen.has(id)) this.views.delete(id);
    }

    this.updateBeams();
    this.updateMotes();
    this.updateCrosses();
  }

  dispose(): void {
    this.offMageHealed();
    this.scene.remove(this.group);
    this.views.clear();
    for (const beam of this.beams.values()) beam.mesh.material.dispose();
    this.beams.clear();
    for (const slot of this.moteSlots) slot.mesh.material.dispose();
    for (const slot of this.crossSlots) slot.mesh.material.dispose();
    this.group.clear();
  }

  private ensureView(id: EntityId): AuraView {
    const existing = this.views.get(id);
    if (existing) return existing;

    const view: AuraView = { moteDebt: 0 };
    this.views.set(id, view);
    return view;
  }

  private updateView(view: AuraView, player: Player, kind: 'holy' | 'sonic'): void {
    view.moteDebt += MOTE_RATE / 60;
    while (view.moteDebt >= 1) {
      view.moteDebt -= 1;
      this.spawnMote(player.position.x, player.position.y, kind, MOTE_SPREAD);
    }
  }

  /**
   * A mote lifting off and fading as it climbs. `spread` is how far out from
   * the mage it starts — always small: this says "working", not "reaches this
   * far".
   */
  private spawnMote(x: number, y: number, kind: 'holy' | 'sonic', spread: number): void {
    const slot = this.moteSlots.find((s) => s.life <= 0);
    if (!slot) return;

    const angle = Math.random() * Math.PI * 2;
    const distance = spread * (0.5 + Math.random() * 0.45);
    toThree(this.tmp, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 0.15);

    slot.mesh.position.copy(this.tmp);
    slot.mesh.scale.setScalar(0.07 + Math.random() * 0.05);
    slot.mesh.material.color.setHex(ELEMENT_TINT[kind].core);
    slot.mesh.visible = true;
    slot.life = MOTE_LIFE;
    slot.maxLife = MOTE_LIFE;
    slot.vy = MOTE_RISE * (0.7 + Math.random() * 0.6);
  }

  private updateMotes(): void {
    for (const slot of this.moteSlots) {
      if (slot.life <= 0) continue;
      slot.life -= 1 / 60;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        slot.mesh.material.opacity = 0;
        continue;
      }
      slot.mesh.position.y += slot.vy / 60;
      slot.mesh.rotation.y += 2.5 / 60;
      // Fade in over the first fifth of the life, out over the rest, so a mote
      // appears to lift off rather than blink into existence.
      const t = slot.life / slot.maxLife;
      slot.mesh.material.opacity = t > 0.8 ? (1 - t) * 5 * 0.9 : (t / 0.8) * 0.9;
    }
  }

  /**
   * Notes that `healerId` is currently healing `targetId`. Crucially this does
   * *not* create anything per heal: the Cleric heals every snapshot, so
   * spawning a beam per event left a fan of stale lines frozen at the
   * positions the mages held when each one fired. Instead the healer's single
   * beam is retargeted and its keep-alive refreshed, and `updateBeams` re-reads
   * both endpoints every frame so the line follows them as they walk.
   *
   * With no healer in range the heal came from something else (a pickup, a cast
   * Bênção), so nothing is drawn — an unattached beam would credit the wrong
   * mechanic.
   */
  private registerHeal(healerId: EntityId | null, targetId: EntityId): void {
    if (healerId === null || healerId === targetId) return;
    if (!this.world.getPlayer(healerId) || !this.world.getPlayer(targetId)) return;

    const existing = this.beams.get(healerId);
    if (existing) {
      existing.targetId = targetId;
      existing.linger = BEAM_LINGER;
      return;
    }

    const mesh = new THREE.Mesh(
      this.assets.geometry('support-renderer-beam', () => {
        // Modelled along +Y and anchored at its base, so aiming it is one
        // setFromUnitVectors and one scale rather than a midpoint calculation.
        const geometry = new THREE.CylinderGeometry(BEAM_RADIUS * 0.5, BEAM_RADIUS, 1, 5, 1, true);
        geometry.translate(0, 0.5, 0);
        return geometry;
      }),
      this.additive(ELEMENT_TINT.holy.glow, 0.7),
    );
    mesh.visible = false;
    this.group.add(mesh);
    this.beams.set(healerId, { mesh, targetId, linger: BEAM_LINGER, crossCooldown: 0 });
  }

  /**
   * Re-aims every live beam at where its pair actually is this frame, and drops
   * the occasional green cross on the mage being healed.
   */
  private updateBeams(): void {
    for (const [healerId, beam] of this.beams) {
      beam.linger -= 1 / 60;
      const healer = this.world.getPlayer(healerId);
      const target = this.world.getPlayer(beam.targetId);

      if (beam.linger <= 0 || !healer?.alive || !target?.alive) {
        this.group.remove(beam.mesh);
        beam.mesh.material.dispose();
        this.beams.delete(healerId);
        continue;
      }

      // Rendered positions, not the snapshot's: the mages on screen are eased
      // toward the snapshot, so anchoring to raw wire coordinates would leave
      // the beam hanging off both of them.
      toThree(this.tmp, healer.position.x, healer.position.y, BEAM_HEIGHT);
      toThree(this.tmpTarget, target.position.x, target.position.y, BEAM_HEIGHT);
      this.tmpTarget.sub(this.tmp);
      const length = this.tmpTarget.length();
      if (length < 1e-4) {
        beam.mesh.visible = false;
        continue;
      }

      this.tmpTarget.divideScalar(length);
      beam.mesh.position.copy(this.tmp);
      beam.mesh.quaternion.setFromUnitVectors(BEAM_AXIS, this.tmpTarget);
      beam.mesh.scale.set(1, length, 1);
      beam.mesh.visible = true;
      // Only the tail end fades; while healing continues the beam holds steady
      // instead of strobing once per snapshot.
      beam.mesh.material.opacity = Math.min(1, beam.linger / BEAM_LINGER) * 0.7;

      beam.crossCooldown -= 1 / 60;
      if (beam.crossCooldown <= 0) {
        beam.crossCooldown = CROSS_INTERVAL;
        this.spawnCross(target.position.x, target.position.y);
      }
    }
  }

  /**
   * The small green cross that says *healed*, on the mage receiving it. Green
   * rather than the Cleric's gold on purpose: the gold on the hat and the ring
   * says which mage this is, the green says what just happened to this one.
   */
  private spawnCross(x: number, y: number): void {
    const slot = this.crossSlots.find((s) => s.life <= 0);
    if (!slot) return;

    // Spawned above head height and drifting only slightly off-centre: over
    // the mage's own body it has something to contrast against, out on the
    // grass it would be green on green.
    toThree(this.tmp, x + (Math.random() - 0.5) * 0.35, y + (Math.random() - 0.5) * 0.35, 1.45);
    slot.mesh.position.copy(this.tmp);
    slot.mesh.scale.setScalar(0.2 + Math.random() * 0.05);
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.visible = true;
    slot.life = CROSS_LIFE;
    slot.maxLife = CROSS_LIFE;
    slot.vy = CROSS_RISE * (0.8 + Math.random() * 0.4);
  }

  /** Crosses rise and fade like motes, but face the camera instead of tumbling. */
  private updateCrosses(): void {
    for (const slot of this.crossSlots) {
      if (slot.life <= 0) continue;
      slot.life -= 1 / 60;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        slot.mesh.material.opacity = 0;
        continue;
      }
      slot.mesh.position.y += slot.vy / 60;
      const t = slot.life / slot.maxLife;
      slot.mesh.material.opacity =
        (t > 0.85 ? (1 - t) * (1 / 0.15) : t / 0.85) * CROSS_OPACITY;
    }
  }

  /** Every mark here is light, so every material is additive and depth-write free. */
  private additive(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }
}

/** The beam geometry's own long axis; see the cylinder built in the constructor. */
const BEAM_AXIS = new THREE.Vector3(0, 1, 0);

/** Which support a mage is, by the element only that support carries. */
function supportKind(player: Player): 'holy' | 'sonic' | null {
  if (player.element === 'holy') return 'holy';
  if (player.element === 'sonic') return 'sonic';
  return null;
}
