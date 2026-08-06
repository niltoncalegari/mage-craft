import * as THREE from 'three';

/**
 * Number of points along the bolt's path. Segments = POINTS - 1; more points
 * read as noise at this scale rather than as more detail.
 */
const POINTS = 10;
const SEGMENTS = POINTS - 1;
/** Two crossed ribbons (one flat, one upright) per segment, 2 triangles each. */
const VERTS_PER_POINT = 4;
const INDICES_PER_SEGMENT = 12;

/**
 * The Condutor de Raio's projectile (GDD §8.4). A bolt is the one element that
 * cannot be a ball: it is a *discharge*, so it is drawn as a jagged, flickering
 * arc trailing behind the point the simulation actually tracks.
 *
 * Geometry is two ribbons crossed at 90° — one lying flat, one standing
 * upright — so the arc keeps its width from the tilted match camera instead of
 * thinning to a line, without paying for a tube. The path is re-jittered every
 * frame, which is what makes it crackle.
 *
 * World-space by design: vertices are written in absolute coordinates and the
 * mesh itself never moves, so a pooled slot can be handed a new projectile
 * without carrying a stale transform.
 */
export class LightningBolt {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /**
   * The zig-zag this bolt last drew, as flat xyz triples. Exposed so a second,
   * wider bolt can be laid over the same path as a glow — two independent
   * jitters would read as two separate arcs, not as one with an aura.
   */
  readonly path = new Float32Array(POINTS * 3);
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly baseOpacity: number;

  constructor(color: number, opacity = 1) {
    this.positions = new Float32Array(POINTS * VERTS_PER_POINT * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(buildIndices());
    // The bolt is written in world space, so the automatic bounds Three would
    // compute from a stale frame are useless — an infinite sphere keeps it out
    // of the frustum cull instead of making it blink at the arena edges.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.baseOpacity = opacity;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * Redraws the arc from `head` back along the flight direction. `dirX`/`dirZ`
   * are the normalized ground-plane heading in Three coordinates; `spread` is
   * how far the zig-zag wanders off that axis.
   */
  update(
    head: THREE.Vector3,
    dirX: number,
    dirZ: number,
    length: number,
    width: number,
    spread: number,
  ): void {
    for (let i = 0; i < POINTS; i++) {
      const t = i / SEGMENTS;
      // Both ends pin to the axis so the arc leaves the impact point and the
      // tail cleanly instead of flapping around them.
      const wander = Math.sin(Math.PI * t) * spread;
      // Alternating sides rather than free random: a pure random walk drifts
      // into a smooth ribbon, and what makes a discharge legible is the
      // zig-zag reversing at every step.
      const side = i % 2 === 0 ? 1 : -1;
      const offset = side * (0.45 + Math.random() * 0.55) * wander;

      write(
        this.path,
        i * 3,
        head.x - dirX * length * t - dirZ * offset,
        head.y + (Math.random() - 0.5) * wander,
        head.z - dirZ * length * t + dirX * offset,
      );
    }

    this.writeRibbon(dirX, dirZ, width);
  }

  /**
   * Re-skins an arc someone else's `update` already traced. This is how the
   * glow layer stays welded to the core bolt instead of wandering off on its
   * own random walk.
   */
  updateFrom(path: Float32Array, dirX: number, dirZ: number, width: number): void {
    this.path.set(path);
    this.writeRibbon(dirX, dirZ, width);
  }

  private writeRibbon(dirX: number, dirZ: number, width: number): void {
    // Perpendicular to the heading, in the ground plane.
    const perpX = -dirZ;
    const perpZ = dirX;

    for (let i = 0; i < POINTS; i++) {
      const x = this.path[i * 3];
      const y = this.path[i * 3 + 1];
      const z = this.path[i * 3 + 2];

      // Tapers toward the tail so the arc looks like it is being dragged,
      // not like a fixed-width stick.
      const w = width * (1 - (i / SEGMENTS) * 0.85);
      const base = i * VERTS_PER_POINT * 3;
      write(this.positions, base + 0, x + perpX * w, y, z + perpZ * w);
      write(this.positions, base + 3, x - perpX * w, y, z - perpZ * w);
      write(this.positions, base + 6, x, y + w, z);
      write(this.positions, base + 9, x, y - w, z);
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    // Flicker: a discharge is never steady, and at 60fps this reads as the arc
    // guttering rather than as the mesh popping.
    this.mesh.material.opacity = this.baseOpacity * (0.72 + Math.random() * 0.28);
  }

  dispose(): void {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function write(target: Float32Array, at: number, x: number, y: number, z: number): void {
  target[at] = x;
  target[at + 1] = y;
  target[at + 2] = z;
}

/** Both ribbons share one index buffer; it never changes after construction. */
function buildIndices(): THREE.BufferAttribute {
  const indices = new Uint16Array(SEGMENTS * INDICES_PER_SEGMENT);
  let at = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * VERTS_PER_POINT;
    const b = (i + 1) * VERTS_PER_POINT;
    for (const side of [0, 2]) {
      indices[at++] = a + side;
      indices[at++] = a + side + 1;
      indices[at++] = b + side + 1;
      indices[at++] = a + side;
      indices[at++] = b + side + 1;
      indices[at++] = b + side;
    }
  }
  return new THREE.BufferAttribute(indices, 1);
}
