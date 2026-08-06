import * as THREE from 'three';
import type { GameRenderer } from '../core/Game';
import type { AssetManager } from '../engine/AssetManager';
import type { EntityId } from '../ecs/Entity';
import type { Puddle } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';

const PUDDLE_COLOR = 0x6fd15a;
const PUDDLE_DEEP_COLOR = 0x2f6b1a;
const PUDDLE_RIM_COLOR = 0xb6e84a;
const GROUND_LIFT = 0.02;
/** Seconds of fade-out before a puddle expires, so it drains instead of vanishing. */
const FADE_OUT = 0.8;
const PULSE_HZ = 1.7;

interface PuddleView {
  readonly root: THREE.Group;
  /** Wide, pale body of the pool. */
  readonly base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Darker inner blot, breathing out of phase with the rim. */
  readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Bright edge, slowly turning so the pool never looks frozen. */
  readonly rim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Per-puddle phase offset, so two overlapping pools don't pulse in lockstep. */
  readonly phase: number;
  spin: number;
}

/**
 * The ground hazard poison and Praga leave behind (GDD §8.5, §9). Three
 * stacked discs rather than one: a pale body, a darker core that breathes, and
 * a bright rim that turns — a single flat disc read as a decal painted on the
 * floor instead of something corrosive sitting on it. The bubbles boiling out
 * of it are the {@link ParticleRenderer}'s half of the same effect.
 *
 * Online-only: the offline sim has no element-tied hazards, so there is no
 * precedent renderer to reuse. Purely observes `world.puddles`; no discrete
 * events needed.
 */
export class PuddleRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly views = new Map<EntityId, PuddleView>();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
  ) {
    this.group.name = 'PuddleRenderer';
    this.scene.add(this.group);
  }

  sync(): void {
    // Fixed step: this renderer is driven from the same 60Hz sync as the
    // particle pools, and the pulse only has to look continuous.
    this.clock += 1 / 60;

    const seen = new Set<EntityId>();
    for (const puddle of this.world.puddles) {
      seen.add(puddle.id);
      this.updateView(this.ensureView(puddle.id), puddle);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.disposeView(view);
      this.views.delete(id);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.scene.remove(this.group);
    this.group.clear();
    this.views.clear();
  }

  private updateView(view: PuddleView, puddle: Puddle): void {
    toThree(this.tmp, puddle.position.x, puddle.position.y, GROUND_LIFT);
    view.root.position.copy(this.tmp);

    const pulse = Math.sin(this.clock * PULSE_HZ * Math.PI * 2 + view.phase);
    view.spin += 0.0035;
    view.rim.rotation.y = view.spin;

    // Fresh puddles are strong and expiring ones thin out — the only cue a
    // player gets that it is safe to walk through again.
    const fade = Math.min(1, Math.max(0, puddle.remaining / FADE_OUT));
    const strength = Math.min(1, 0.45 + puddle.remaining * 0.18) * fade;

    view.base.scale.setScalar(puddle.radius);
    view.base.material.opacity = 0.5 * strength;

    view.core.scale.setScalar(puddle.radius * (0.62 + pulse * 0.06));
    view.core.material.opacity = 0.4 * strength;

    view.rim.scale.setScalar(puddle.radius * (0.98 + pulse * 0.02));
    // Additive over grass: much above this and the edge reads as a white halo
    // rather than as something corrosive.
    view.rim.material.opacity = 0.38 * strength;
  }

  private ensureView(id: EntityId): PuddleView {
    const existing = this.views.get(id);
    if (existing) return existing;

    const root = new THREE.Group();
    const base = this.disc('puddle-disc', PUDDLE_COLOR, 0.4, 0);
    const core = this.disc('puddle-disc', PUDDLE_DEEP_COLOR, 0.35, 0.004);
    const rim = new THREE.Mesh(
      this.assets.geometry('puddle-rim', () => {
        const geo = new THREE.RingGeometry(0.86, 1, 32);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      this.rimMaterial(),
    );
    rim.position.y = 0.008;
    root.add(base, core, rim);
    this.group.add(root);

    const view: PuddleView = { root, base, core, rim, phase: Math.random() * Math.PI * 2, spin: 0 };
    this.views.set(id, view);
    return view;
  }

  private disc(
    geometryKey: string,
    color: number,
    opacity: number,
    lift: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const mesh = new THREE.Mesh(
      this.assets.geometry(geometryKey, () => {
        const geo = new THREE.CircleGeometry(1, 32);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    mesh.position.y = lift;
    return mesh;
  }

  private rimMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: PUDDLE_RIM_COLOR,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private disposeView(view: PuddleView): void {
    this.group.remove(view.root);
    view.base.material.dispose();
    view.core.material.dispose();
    view.rim.material.dispose();
  }
}
