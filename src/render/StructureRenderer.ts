import * as THREE from 'three';
import type { GameRenderer } from '../core/Game';
import type { AssetManager } from '../engine/AssetManager';
import type { EntityId } from '../ecs/Entity';
import { TEAM_COLORS } from '../game/config';
import { Team, type Structure } from '../game/types';
import type { World } from '../game/World';
import { toThree } from './coords';

const RUBBLE_COLOR = 0x6b7480;
const STONE_COLOR = 0xdbe6f2;
const BAR_BACK_COLOR = 0x1d2b39;
const GROUND_LIFT = 0.03;

const TOWER_HEIGHT = 3.2;
const CORE_HEIGHT = 3.8;

/** Ground-plane health bar, in world units. */
const BAR_THICKNESS = 0.45;
const BAR_GAP = 0.6;

interface StructureView {
  root: THREE.Group;
  body: THREE.Group;
  rubble: THREE.Mesh;
  shield: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  barFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  barBack: THREE.Mesh;
  spin: number;
}

/**
 * Draws the Cores and Towers a siege is fought over (GDD §5): a team-colored
 * keep per Tower, a floating crystal per Core, a ground-plane health bar, and
 * the shield that reads "immune while the Towers stand". Destroyed structures
 * collapse into rubble rather than vanishing, so the map still tells you which
 * flank fell.
 *
 * Online-only, like {@link PuddleRenderer}: it observes `world.structures`,
 * which only the snapshot sync fills.
 */
export class StructureRenderer implements GameRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly views = new Map<EntityId, StructureView>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly world: World,
  ) {
    this.group.name = 'StructureRenderer';
    this.scene.add(this.group);
  }

  sync(alpha: number): void {
    void alpha;
    for (const structure of this.world.structures) {
      this.updateView(this.ensureView(structure), structure);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) {
      view.shield.material.dispose();
      view.barFill.material.dispose();
    }
    this.scene.remove(this.group);
    this.group.clear();
    this.views.clear();
  }

  private updateView(view: StructureView, structure: Structure): void {
    view.body.visible = structure.alive;
    view.rubble.visible = !structure.alive;
    view.shield.visible = structure.alive && structure.invulnerable;

    if (structure.alive && structure.kind === 'core') {
      view.spin += 0.004;
      view.body.rotation.y = view.spin;
    }

    const fraction = clamp01(structure.health / Math.max(1, structure.maxHealth));
    const width = structure.radius * 2.4;
    view.barBack.visible = structure.alive;
    view.barFill.visible = structure.alive;
    view.barBack.scale.set(width, 1, BAR_THICKNESS);
    view.barFill.scale.set(width * fraction, 1, BAR_THICKNESS);
    view.barFill.material.color.setStyle(healthColor(fraction));
  }

  private ensureView(structure: Structure): StructureView {
    const existing = this.views.get(structure.id);
    if (existing) return existing;

    const color = TEAM_COLORS[structure.team === Team.Player ? 'player' : 'enemy'];
    const root = new THREE.Group();
    const body =
      structure.kind === 'core' ? this.buildCore(color, structure) : this.buildTower(color, structure);
    root.add(body);

    const rubble = new THREE.Mesh(
      this.assets.geometry('structure-rubble', () => {
        const geo = new THREE.CircleGeometry(1, 20);
        geo.rotateX(-Math.PI / 2);
        return geo;
      }),
      this.assets.standardMaterial(RUBBLE_COLOR),
    );
    rubble.scale.setScalar(structure.radius);
    rubble.position.y = GROUND_LIFT;
    rubble.visible = false;
    root.add(rubble);

    const shield = new THREE.Mesh(
      this.assets.geometry('structure-shield', () => new THREE.SphereGeometry(1, 20, 14)),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const shieldRadius = structure.radius * 1.5;
    shield.scale.set(shieldRadius, shieldRadius * 0.85, shieldRadius);
    shield.position.y = shieldRadius * 0.4;
    root.add(shield);

    // The bar lies flat on the ground in front of the structure: the match
    // camera looks down, so this stays readable without billboarding.
    const barBack = new THREE.Mesh(this.barGeometry(), new THREE.MeshBasicMaterial({ color: BAR_BACK_COLOR }));
    const barFill = new THREE.Mesh(this.barGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    for (const [i, bar] of [barBack, barFill].entries()) {
      bar.position.set(-structure.radius * 1.2, GROUND_LIFT + 0.01 * (i + 1), structure.radius + BAR_GAP);
      root.add(bar);
    }

    toThree(this.tmp, structure.position.x, structure.position.y, 0);
    root.position.copy(this.tmp);
    this.group.add(root);

    const view: StructureView = { root, body, rubble, shield, barFill, barBack, spin: 0 };
    this.views.set(structure.id, view);
    return view;
  }

  /** A unit plane whose left edge is its origin, so scaling x fills it. */
  private barGeometry(): THREE.BufferGeometry {
    return this.assets.geometry('structure-bar', () => {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0.5, 0, 0);
      return geo;
    });
  }

  private buildTower(color: number, structure: Structure): THREE.Group {
    const group = new THREE.Group();
    const r = structure.radius * 0.72;

    const shaft = new THREE.Mesh(
      this.assets.geometry('tower-shaft', () => new THREE.CylinderGeometry(0.85, 1, 1, 8)),
      this.assets.standardMaterial(STONE_COLOR),
    );
    shaft.scale.set(r, TOWER_HEIGHT, r);
    shaft.position.y = TOWER_HEIGHT / 2;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    const crown = new THREE.Mesh(
      this.assets.geometry('tower-crown', () => new THREE.CylinderGeometry(1, 0.9, 1, 8)),
      this.assets.standardMaterial(color),
    );
    crown.scale.set(r * 1.15, 0.5, r * 1.15);
    crown.position.y = TOWER_HEIGHT + 0.2;
    crown.castShadow = true;
    group.add(crown);

    return group;
  }

  private buildCore(color: number, structure: Structure): THREE.Group {
    const group = new THREE.Group();
    const r = structure.radius * 0.8;

    const plinth = new THREE.Mesh(
      this.assets.geometry('core-plinth', () => new THREE.CylinderGeometry(1, 1.15, 1, 10)),
      this.assets.standardMaterial(STONE_COLOR),
    );
    plinth.scale.set(r, 1.1, r);
    plinth.position.y = 0.55;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    const crystal = new THREE.Mesh(
      this.assets.geometry('core-crystal', () => new THREE.OctahedronGeometry(1, 0)),
      this.assets.standardMaterial(color),
    );
    crystal.scale.set(r * 0.75, CORE_HEIGHT * 0.5, r * 0.75);
    crystal.position.y = 1.1 + CORE_HEIGHT * 0.45;
    crystal.castShadow = true;
    group.add(crystal);

    return group;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Green when healthy through red when nearly down, matching the HUD meter. */
function healthColor(fraction: number): string {
  return `hsl(${Math.round(fraction * 120)} 78% 48%)`;
}
