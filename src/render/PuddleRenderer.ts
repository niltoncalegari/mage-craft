import * as THREE from 'three';
import type { GameRenderer } from '../core/Game';
import type { AssetManager } from '../engine/AssetManager';
import type { EntityId } from '../ecs/Entity';
import type { Puddle } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';

const PUDDLE_COLOR = 0x6fd15a;
const GROUND_LIFT = 0.02;

/**
 * Flat, translucent ground disc per active poison puddle. Online-only — the
 * offline sim has no element-tied hazards, so there is no precedent renderer
 * to reuse. Purely observes `world.puddles`; no discrete events needed.
 */
export class PuddleRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly views = new Map<EntityId, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
  ) {
    this.group.name = 'PuddleRenderer';
    this.scene.add(this.group);
  }

  sync(): void {
    const seen = new Set<EntityId>();
    for (const puddle of this.world.puddles) {
      seen.add(puddle.id);
      this.updateView(this.ensureView(puddle.id), puddle);
    }
    for (const [id, mesh] of this.views) {
      if (seen.has(id)) continue;
      this.group.remove(mesh);
      mesh.material.dispose();
      this.views.delete(id);
    }
  }

  dispose(): void {
    for (const mesh of this.views.values()) mesh.material.dispose();
    this.scene.remove(this.group);
    this.group.clear();
    this.views.clear();
  }

  private updateView(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, puddle: Puddle): void {
    toThree(this.tmp, puddle.position.x, puddle.position.y, GROUND_LIFT);
    mesh.position.copy(this.tmp);
    mesh.scale.setScalar(puddle.radius);
    mesh.material.opacity = Math.min(0.55, 0.2 + puddle.remaining * 0.1);
  }

  private ensureView(id: EntityId): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const existing = this.views.get(id);
    if (existing) return existing;

    const mesh = new THREE.Mesh(
      this.assets.geometry('puddle-disc', () => {
        const geo = new THREE.CircleGeometry(1, 24);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      new THREE.MeshBasicMaterial({
        color: PUDDLE_COLOR,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.group.add(mesh);
    this.views.set(id, mesh);
    return mesh;
  }
}
