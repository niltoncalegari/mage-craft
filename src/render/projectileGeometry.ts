import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetManager } from '../engine/AssetManager';

/**
 * The body of each elemental projectile (GDD §8, §17).
 *
 * Every element used to be drawn with the same `SphereGeometry(1, 12, 10)`,
 * recolored — which is why the Golem's boulder read as a snowball and why only
 * lightning, the one element with a mesh of its own, looked like a spell. The
 * fix is a distinct *silhouette* per element: at the match camera's distance
 * colour alone does not survive, but a tumbling faceted rock, a dart and a
 * spinning crescent do.
 *
 * Everything here follows the art direction in GDD §542 — low-poly primitives
 * generated in code, no file textures — and everything is built through
 * {@link AssetManager.geometry}, so a shape is constructed once per match and
 * shared by all 64 pooled projectile slots.
 *
 * Orientation is the caller's job ({@link ParticleRenderer}); the convention
 * these shapes are modelled to is:
 * - `shard` is long on **+Y** — align Y with the flight direction.
 * - `blade` and `wave` lie in the **XY plane** with their axis on **+Z** —
 *   align Z with the flight direction so they cut edge-first.
 * - `rock`, `glob` and `sigil` are orientation-free; they just spin.
 */

/** Local coordinate keys are rounded to this many places when welding vertices. */
const WELD_PRECISION = 1e4;

/**
 * Deterministic PRNG. The rock is jittered by hand rather than by
 * `Math.random`, so it is the *same* rock every session — a boulder whose
 * facets rearranged between matches would read as a rendering glitch.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pushes every vertex in or out along its own normal-from-origin by up to
 * `amount`, so a regular solid becomes an irregular lump.
 *
 * Polyhedron geometries are non-indexed — each face carries its own copy of a
 * corner — so the offset has to be keyed by *position*, not by vertex index.
 * Jittering per index would pull the copies apart and tear the mesh open.
 */
function roughen(geometry: THREE.BufferGeometry, amount: number, seed: number): void {
  const rand = mulberry32(seed);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const offsets = new Map<string, number>();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * WELD_PRECISION)},${Math.round(y * WELD_PRECISION)},${Math.round(z * WELD_PRECISION)}`;

    let scale = offsets.get(key);
    if (scale === undefined) {
      scale = 1 + (rand() - 0.5) * 2 * amount;
      offsets.set(key, scale);
    }

    pos.setXYZ(i, x * scale, y * scale, z * scale);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Stone Golem: a chunky irregular boulder. 20 faces, and it shows. */
function buildRock(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  roughen(geometry, 0.18, 0x51_0e_57);
  // Nothing in nature is a sphere with bumps; squashing the whole solid is what
  // sells "a piece broken off something" over "a ball".
  geometry.scale(1.0, 0.86, 0.93);
  return geometry;
}

/** Ice Sentinel: a shard flying point-first. Long axis on +Y. */
function buildShard(): THREE.BufferGeometry {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(0.62, 2.2, 0.62);
  return geometry;
}

/** Alchemist: a blob of something that should not be held. */
function buildGlob(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  roughen(geometry, 0.16, 0x0a_1c_3f);
  return geometry;
}

/**
 * Wind Dervish: a crescent blade thrown flat, like a chakram.
 *
 * Two decisions, both learned from looking at it: the tube is *flattened* into
 * the arc's own plane, or a round tube reads as a bent wire rather than
 * something with an edge; and the whole thing is laid into the **ground
 * plane** rather than aimed down the flight path. A crescent standing on the
 * flight axis flies edge-on to the match camera and collapses to a line — laid
 * flat it keeps its full profile and its spin reads as a buzzsaw.
 */
function buildBlade(): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(1, 0.3, 3, 20, Math.PI * 1.2);
  geometry.scale(1, 1, 0.34);
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
}

/**
 * Cleric: a cross inside a ring. Pre-tilted toward the match camera rather
 * than left flat or upright — at the arena's fixed camera angle a flat sigil
 * collapses to a line and an upright one hides behind the mage.
 */
function buildSigil(): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(1, 0.1, 3, 14);
  const upright = new THREE.BoxGeometry(0.16, 1.5, 0.16);
  const crossbar = new THREE.BoxGeometry(0.9, 0.16, 0.16);
  crossbar.translate(0, 0.24, 0);

  const merged = mergeGeometries([ring, upright, crossbar], false);
  ring.dispose();
  upright.dispose();
  crossbar.dispose();
  if (!merged) throw new Error('projectileGeometry: failed to merge the holy sigil');

  merged.rotateX(-Math.PI * 0.25);
  return merged;
}

/**
 * Arcane Bard: three concentric arcs, like the rings drawn off a struck bell.
 * Lies in XY with its axis on +Z, so it travels face-on to whatever it hits.
 */
function buildWave(): THREE.BufferGeometry {
  // Same trick as the blade: flattened bands, not round wires. Three thin
  // rings of round tube read as tangled thread at this size.
  const arcs = [0.4, 0.72, 1.04].map(
    (radius, i) => new THREE.TorusGeometry(radius, 0.17 - i * 0.03, 3, 14, Math.PI * 1.45),
  );

  const merged = mergeGeometries(arcs, false);
  for (const arc of arcs) arc.dispose();
  if (!merged) throw new Error('projectileGeometry: failed to merge the sonic wave');

  merged.scale(1, 1, 0.3);
  return merged;
}

/** Arcane Archer: the band of runes orbiting the orb, drawn as its own mesh. */
function buildRuneRing(): THREE.BufferGeometry {
  return new THREE.TorusGeometry(1, 0.06, 3, 16);
}

/** What a projectile's body is, beyond "a ball". */
export type ProjectileShape =
  | 'orb'
  | 'bolt'
  | 'rock'
  | 'shard'
  | 'glob'
  | 'runeOrb'
  | 'blade'
  | 'sigil'
  | 'wave';

/** Shapes whose long axis is +Y and must be turned to face the flight path. */
export const AXIAL_SHAPES: ReadonlySet<ProjectileShape> = new Set(['shard']);

/**
 * Shapes that lie in XY and must be turned so their +Z faces the flight path —
 * they travel face-on, through their own hole. `blade` deliberately is *not*
 * one of these: see {@link buildBlade}.
 */
export const FACING_SHAPES: ReadonlySet<ProjectileShape> = new Set(['wave']);

/** Shapes already modelled in their final attitude; they only spin about up. */
export const UPRIGHT_SPIN_SHAPES: ReadonlySet<ProjectileShape> = new Set(['sigil', 'blade']);

const BUILDERS: Readonly<Record<ProjectileShape, () => THREE.BufferGeometry>> = {
  // 'orb' and 'bolt' keep the pre-existing look: the orb is the shared sphere
  // fire still uses, and a bolt draws no body at all (see LightningBolt).
  orb: () => new THREE.SphereGeometry(1, 12, 10),
  bolt: () => new THREE.SphereGeometry(1, 12, 10),
  rock: buildRock,
  shard: buildShard,
  glob: buildGlob,
  runeOrb: () => new THREE.SphereGeometry(1, 12, 10),
  blade: buildBlade,
  sigil: buildSigil,
  wave: buildWave,
};

/**
 * The body geometry for a projectile shape, built once per match and cached in
 * the {@link AssetManager} — the pool hands the same instance to every slot.
 */
export function projectileGeometry(
  assets: AssetManager,
  shape: ProjectileShape,
): THREE.BufferGeometry {
  return assets.geometry(`projectile-shape:${shape}`, BUILDERS[shape]);
}

/** The orbiting rune band; only `runeOrb` asks for one. */
export function runeRingGeometry(assets: AssetManager): THREE.BufferGeometry {
  return assets.geometry('projectile-shape:rune-ring', buildRuneRing);
}
