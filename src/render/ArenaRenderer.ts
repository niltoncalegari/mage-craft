import * as THREE from 'three';
import type { AssetManager } from '../engine/AssetManager';
import { toThree } from './coords';
import type { Arena, Obstacle } from '../game/types';

const BORDER_COLOR = 0x3f6330;
/** Ground texture resolution, in canvas pixels per world unit. */
const GROUND_PPU = 28;
const GRASS = '#5f8f46';
const GRASS_LIGHT = '#6d9e50';
const GRASS_DARK = '#517d3c';
const DIRT = '#8b6a45';
const DIRT_LIGHT = '#9d7c55';
const DIRT_DARK = '#6f5236';

/**
 * Deterministic scatter so the lawn is identical across reloads: screenshot
 * diffs stay meaningful instead of churning with every run.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds procedural arena visuals from arena data (design §8): a painted grass
 * ground plane plus meshes for each obstacle, assembled from Three.js
 * primitives with a cartoon palette. Static — meshes are created once and never
 * per-frame.
 */
export class ArenaRenderer {
  private readonly group = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private readonly owned: Array<THREE.Material | THREE.Texture> = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    arena: Arena,
  ) {
    this.buildGround(arena);
    for (const obstacle of arena.obstacles) {
      const mesh = this.buildObstacle(obstacle);
      if (mesh) this.group.add(mesh);
    }
    scene.add(this.group);
  }

  private buildGround(arena: Arena): void {
    const geo = new THREE.PlaneGeometry(arena.width, arena.height);
    geo.rotateX(-Math.PI / 2);

    // A dedicated material, not the shared cache: this one carries a map, and
    // the cache keys only on color.
    const texture = this.paintGround(arena);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 });
    this.owned.push(mat, texture);

    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: BORDER_COLOR }),
    );
    this.group.add(border);
  }

  /**
   * Paints the lawn into a canvas: mottled grass with dirt paths worn along the
   * lanes units actually walk. Lane positions are proportional to the arena, so
   * they land on the structures of any siege-shaped map. Deterministic, so the
   * ground is identical across reloads and screenshot diffs stay meaningful.
   */
  private paintGround(arena: Arena): THREE.CanvasTexture {
    const width = Math.round(arena.width * GROUND_PPU);
    const height = Math.round(arena.height * GROUND_PPU);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ArenaRenderer: 2D canvas is unavailable.');

    // Gameplay (x, y) -> canvas pixels. Both axes grow together here because
    // the ground plane's UVs line up with the gameplay axes (see coords.ts).
    const px = (x: number): number => ((x + arena.width / 2) / arena.width) * width;
    const py = (y: number): number => ((y + arena.height / 2) / arena.height) * height;
    const rand = mulberry32(0x51ed270b);

    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, width, height);

    // Mottling: soft patches of lighter and darker grass so the field is not a
    // flat slab of one green.
    for (let i = 0; i < 110; i++) {
      const cx = rand() * width;
      const cy = rand() * height;
      const r = (1.5 + rand() * 4) * GROUND_PPU;
      this.softBlob(ctx, cx, cy, r, rand() < 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.34);
    }

    const laneY = [0, arena.height * 0.33, -arena.height * 0.33];
    const endX = arena.width * 0.43;
    const linkX = arena.width * 0.3;

    // The three lanes across the field, plus the connectors that tie them
    // together behind each side's towers. Narrow on purpose: these should read
    // as trails worn by feet, not as roads.
    for (const y of laneY) {
      this.wornPath(
        ctx,
        this.wobble(-endX, endX, (t) => y + Math.sin(t * 5.1 + y) * 0.55, px, py),
        1.5,
        rand,
      );
    }
    for (const x of [-linkX, linkX]) {
      this.wornPath(ctx, this.wobble(laneY[2], laneY[1], (t) => t, px, py, x), 1.2, rand);
    }

    // Bare earth where bodies pile up: spawn mouths and lane crossings.
    for (const spawn of arena.spawns) {
      this.softBlob(ctx, px(spawn.x), py(spawn.y), 1.6 * GROUND_PPU, DIRT, 0.5);
    }
    for (const x of [-linkX, linkX]) {
      for (const y of laneY) {
        this.softBlob(ctx, px(x), py(y), 1.5 * GROUND_PPU, DIRT, 0.42);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** Samples a wobbling line into canvas points. */
  private wobble(
    from: number,
    to: number,
    offset: (t: number) => number,
    px: (x: number) => number,
    py: (y: number) => number,
    fixedX?: number,
  ): Array<[number, number]> {
    const steps = 26;
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      points.push(
        fixedX === undefined
          ? [px(t), py(offset(t))]
          : [px(fixedX + Math.sin(t * 4.3) * 0.5), py(t)],
      );
    }
    return points;
  }

  /**
   * A dirt track. Stroked several times from wide-and-faint to narrow-and-solid
   * so the edges fade into the grass instead of cutting a hard ribbon.
   */
  private wornPath(
    ctx: CanvasRenderingContext2D,
    points: Array<[number, number]>,
    worldWidth: number,
    rand: () => number,
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const passes: Array<[number, number, string]> = [
      [2.0, 0.09, DIRT_DARK],
      [1.4, 0.2, DIRT],
      [1.0, 0.52, DIRT],
      [0.45, 0.34, DIRT_LIGHT],
    ];
    for (const [scale, alpha, color] of passes) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = worldWidth * scale * GROUND_PPU;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }

    // Gravel, so the track is not a smooth painted stripe.
    ctx.globalAlpha = 0.5;
    for (const [x, y] of points) {
      for (let i = 0; i < 5; i++) {
        const spread = worldWidth * 0.5 * GROUND_PPU;
        ctx.fillStyle = rand() < 0.5 ? DIRT_DARK : DIRT_LIGHT;
        ctx.beginPath();
        ctx.arc(
          x + (rand() - 0.5) * spread * 2,
          y + (rand() - 0.5) * spread * 2,
          (0.04 + rand() * 0.08) * GROUND_PPU,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** A radial splotch that fades to nothing, for grass patches and bare earth. */
  private softBlob(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    color: string,
    alpha: number,
  ): void {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private buildObstacle(obstacle: Obstacle): THREE.Object3D | null {
    switch (obstacle.type) {
      case 'tree':
        return this.buildTree(obstacle);
      case 'rock':
        return this.buildRock(obstacle);
      case 'fort':
        return this.buildFort(obstacle);
      case 'fence':
        return this.buildFence(obstacle);
      case 'prop':
        return this.buildProp(obstacle);
    }
  }

  private radiusOf(obstacle: Obstacle, fallback: number): number {
    return obstacle.collision.kind === 'circle' ? obstacle.collision.radius : fallback;
  }

  private buildTree(o: Obstacle): THREE.Object3D {
    const group = new THREE.Group();
    const r = this.radiusOf(o, 0.35);
    const trunk = new THREE.Mesh(
      this.assets.geometry('tree-trunk', () => new THREE.CylinderGeometry(0.12, 0.16, 1, 6)),
      this.assets.standardMaterial(0x6b4a2b),
    );
    trunk.position.y = 0.5;
    trunk.castShadow = true;
    group.add(trunk);

    const foliageMat = this.assets.standardMaterial(0x2f7d4f);
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        this.assets.geometry('tree-foliage', () => new THREE.ConeGeometry(1, 1.1, 7)),
        foliageMat,
      );
      const scale = (1 - i * 0.22) * (r / 0.35);
      cone.scale.setScalar(scale);
      cone.position.y = 1.1 + i * 0.55;
      cone.castShadow = true;
      group.add(cone);
    }
    this.place(group, o);
    return group;
  }

  private buildRock(o: Obstacle): THREE.Object3D {
    const r = this.radiusOf(o, 0.6);
    const rock = new THREE.Mesh(
      this.assets.geometry('rock', () => new THREE.IcosahedronGeometry(1, 0)),
      this.assets.standardMaterial(0x9aa3ad),
    );
    rock.scale.set(r, r * 0.8, r);
    rock.rotation.set(0.3, 0.7, 0.2);
    rock.position.y = r * 0.5;
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.place(rock, o);
    return rock;
  }

  private buildFort(o: Obstacle): THREE.Object3D {
    const halfW = o.collision.kind === 'rect' ? o.collision.halfW : 1;
    const halfH = o.collision.kind === 'rect' ? o.collision.halfH : 1;
    const height = 1.1;
    const fort = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2, height, halfH * 2),
      this.assets.standardMaterial(0xe8f2ff),
    );
    fort.position.y = height / 2;
    fort.castShadow = true;
    fort.receiveShadow = true;
    this.place(fort, o);
    return fort;
  }

  private buildFence(o: Obstacle): THREE.Object3D {
    const halfW = o.collision.kind === 'rect' ? o.collision.halfW : 1;
    const halfH = o.collision.kind === 'rect' ? o.collision.halfH : 0.12;
    const height = 0.7;
    const fence = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2, height, halfH * 2),
      this.assets.standardMaterial(0x8a5a34),
    );
    fence.position.y = height / 2;
    fence.castShadow = true;
    this.place(fence, o);
    return fence;
  }

  private buildProp(o: Obstacle): THREE.Object3D {
    // A low-poly shrub, so the decoration belongs on a lawn.
    const group = new THREE.Group();
    const mat = this.assets.standardMaterial(0x3f7d43);
    const geo = this.assets.geometry('shrub-blob', () => new THREE.IcosahedronGeometry(1, 0));
    const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.34, 0, 0.3, 0],
      [0.25, 0.24, 0.5, 0.16],
      [0.21, -0.2, 0.42, -0.13],
    ];
    for (const [r, dx, y, dz] of blobs) {
      const blob = new THREE.Mesh(geo, mat);
      blob.scale.set(r, r * 0.85, r);
      blob.position.set(dx, y, dz);
      blob.castShadow = true;
      group.add(blob);
    }
    this.place(group, o);
    return group;
  }

  private place(obj: THREE.Object3D, o: Obstacle): void {
    toThree(this.tmp, o.position.x, o.position.y, 0);
    obj.position.x += this.tmp.x;
    obj.position.z += this.tmp.z;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    // Every other material comes from the shared cache; these are ours.
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
  }
}
