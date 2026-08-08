import * as THREE from 'three';
import type { GameRenderer } from '../core/Game';
import type { EntityId } from '../ecs/Entity';
import type { World } from '../game/World';
import { toThree } from './coords';

/**
 * Radii of the ring, chosen to sit outside every other ground marker a mage can
 * wear: selection 0.58–0.72, shield 0.76–0.86, haste 0.90–1.00, slow 1.04–1.16
 * (see PlayerRenderer). Overlapping any of those would read as a status effect
 * rather than "this is the one you picked".
 */
const INNER_RADIUS = 1.24;
const OUTER_RADIUS = 1.42;
/** Below the 0.025/0.03/0.035 the status rings already occupy. */
const GROUND_LIFT = 0.02;

const PULSE_RATE = 4;
const SPIN_RATE = 0.6;
const SCALE_SWING = 0.07;
const MIN_OPACITY = 0.4;
const OPACITY_SWING = 0.45;

/** Fixed step: the online match drives renderers with `sync(0)` and no dt. */
const FRAME_STEP = 1 / 60;

/**
 * Marks the one mage the player has picked out of the squad panel, with a
 * pulsing ring on the ground under it.
 *
 * Deliberately its own renderer rather than a ninth ring inside
 * `PlayerRenderer`: the ring materials there come from the shared
 * {@link AssetManager} cache, so animating opacity on one mage would animate it
 * on all of them. This owns its geometry and material outright, which is what
 * lets it pulse at all.
 */
export class SquadHighlightRenderer implements GameRenderer {
  private readonly geometry: THREE.RingGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    /** The mage to mark, or null when nothing is picked. */
    private readonly getTarget: () => EntityId | null,
  ) {
    this.geometry = new THREE.RingGeometry(INNER_RADIUS, OUTER_RADIUS, 40);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xfff06a,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
  }

  sync(): void {
    this.clock += FRAME_STEP;

    const id = this.getTarget();
    const player = id === null ? undefined : this.world.getPlayer(id);
    // A fallen mage keeps its row in the panel — its ring would just hover over
    // a corpse, so it goes away until the mage is back.
    this.mesh.visible = player !== undefined && player.alive;
    if (!this.mesh.visible || !player) return;

    toThree(this.tmp, player.position.x, player.position.y, GROUND_LIFT);
    this.mesh.position.copy(this.tmp);

    const pulse = 0.5 + 0.5 * Math.sin(this.clock * PULSE_RATE);
    this.mesh.scale.setScalar(1 + SCALE_SWING * pulse);
    this.mesh.rotation.y = this.clock * SPIN_RATE;
    this.material.opacity = MIN_OPACITY + OPACITY_SWING * pulse;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
