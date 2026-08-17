import * as THREE from 'three';

/**
 * The parts every mage in the game is built from — the arena fighter
 * ({@link PlayerRenderer}) and the menu/portal figure ({@link createMageFigure})
 * alike.
 *
 * It exists because those two used to carry their own copy of the same vertex
 * passes, with the comments in each pointing at the other. A hat that curls one
 * way on the title screen and another way in the match is the kind of drift
 * nobody notices until both are on screen at once.
 *
 * Everything here is pure geometry: no materials, no caching. Callers that draw
 * many mages push these through `AssetManager.geometry` so the deformation runs
 * once per distinct size for the whole match.
 */

/**
 * The carved head of the staff: two wooden curls winding in toward the crystal,
 * plus the bud they wind out of.
 *
 * Built around an empty origin because that origin is where the element crystal
 * goes, and in the arena that crystal is the throw-charge readout — it swells as
 * the mage winds up, so the wood has to frame the space rather than fill it.
 *
 * The curls lie in the XY plane (the hole faces along Z), so the spiral is
 * side-on to a mage seen from the front — the same reading the reference model
 * has, and the one that survives the mage rotating to aim.
 */
export function buildSpiralStaffHead(radius: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  // Arcs rather than rings, and each one turned so its gap faces the next curl
  // in — that gap is the whole difference between a spiral and two washers. Kept
  // well under a full turn for the same reason: past about 270° the opening
  // closes up visually and the curl reads as a washer again.
  const outer = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.3, 8, 20, Math.PI * 1.3),
    material,
  );
  outer.position.set(radius * 0.34, radius * 0.16, 0);
  outer.rotation.z = Math.PI * 0.22;
  outer.castShadow = true;
  group.add(outer);

  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.55, radius * 0.26, 8, 16, Math.PI * 1.15),
    material,
  );
  inner.position.set(radius * 0.42, -radius * 0.62, 0);
  inner.rotation.z = Math.PI * 0.85;
  inner.castShadow = true;
  group.add(inner);

  // The knot where the curl leaves the pole; also hides the arc's cut end.
  const bud = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.42, 10, 8), material);
  bud.position.set(radius * 0.2, -radius * 1.15, 0);
  bud.castShadow = true;
  group.add(bud);

  return group;
}

/**
 * The eye pair, as fractions of the head radius.
 *
 * `x` sits just outside the skull's surface at the eyes' own `z` — enough for
 * the glow to clear the sphere, not enough to read as eyes stuck on the front
 * of a mask. The scale makes each one a tall slit: narrow in the facing axis,
 * stretched in height.
 */
const EYE = {
  radius: 0.34,
  x: 0.92,
  y: 0.06,
  z: 0.4,
  scale: new THREE.Vector3(0.5, 1.35, 0.85),
} as const;

/**
 * The face and the two lights in it.
 *
 * The whole point of the silhouette: under the brim there is no face, only a
 * shadow with a pair of eyes in it. That reads at the arena camera's distance
 * where a modelled nose and beard did not, and it is the same shape the title
 * screen shows, so the mage the player picks is the mage that walks out.
 *
 * The eyes double as the facing cue the beard used to carry — they are the only
 * bright thing on the head, and they only exist on one side of it.
 */
export function buildVoidFace(
  radius: number,
  faceMaterial: THREE.Material,
  eyeMaterial: THREE.Material,
): { group: THREE.Group; skull: THREE.Mesh; eyes: [THREE.Mesh, THREE.Mesh] } {
  const group = new THREE.Group();

  const skull = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 12), faceMaterial);
  // Named like the rest of this renderer's graph (`player-<id>`, `PlayerRenderer`)
  // so the face and its lights can be found in an inspector without counting
  // children.
  skull.name = 'mage-face';
  skull.castShadow = true;
  group.add(skull);

  const eyeGeo = new THREE.SphereGeometry(radius * EYE.radius, 10, 8);
  const eye = (side: 1 | -1): THREE.Mesh => {
    const m = new THREE.Mesh(eyeGeo, eyeMaterial);
    m.position.set(radius * EYE.x, radius * EYE.y, radius * EYE.z * side);
    m.scale.copy(EYE.scale);
    // Toed outward a little, the way the reference splays them: a pair of
    // perfectly parallel slits stares through the player rather than at them.
    m.rotation.y = -0.2 * side;
    m.name = 'mage-eye';
    group.add(m);
    return m;
  };
  const eyes: [THREE.Mesh, THREE.Mesh] = [eye(1), eye(-1)];

  return { group, skull, eyes };
}

/**
 * How far into the brim the ripple reaches, as a fraction of the radius. The
 * inner disc stays flat so the brim keeps sitting flush on the skull — ripple
 * it there and a gap opens between brim and head for the key light to pour
 * through.
 */
const BRIM_FLAT_RATIO = 0.55;

/**
 * The floppy brim: a thin disc whose outer edge undulates, so the hat reads as
 * felt that has been rained on rather than as a machined plate.
 *
 * The waves run in x and z rather than around the angle, which is what makes
 * the droop *irregular* — four evenly spaced lobes read as a fluted lampshade,
 * and the eye recognizes that as a manufactured object.
 *
 * Amplitude is proportional to the radius, so the menu mage's wide brim and the
 * arena mage's deliberately narrow one (0.4 — anything wider is an umbrella at
 * the match camera's tilt) sag by the same *proportion* instead of the wide one
 * looking stiff.
 */
export function hatBrimGeometry(radius: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 32);
  const pos = geo.attributes.position;
  const amplitude = radius * 0.09;
  // Scaled by the radius so the lobe count is the same at any brim width.
  const k = 3.6 / radius;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dist = Math.hypot(x, z);
    if (dist <= radius * BRIM_FLAT_RATIO) continue;
    // Eased in from the flat crown outward, so the ripple grows toward the edge
    // instead of starting with a step at the boundary.
    const reach = (dist - radius * BRIM_FLAT_RATIO) / (radius * (1 - BRIM_FLAT_RATIO));
    const wave = Math.sin(x * k) * 0.55 + Math.cos(z * k * 0.8) * 0.45;
    pos.setY(i, pos.getY(i) + wave * amplitude * reach);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The cone with the curled tip.
 *
 * The curl leans along -X and drifts toward +Z. +X is the mage's forward (see
 * `coords.ts`), so bending that way would fold the point down over the eyes the
 * player aims by.
 *
 * Six height segments: fewer and the point shears into a straight diagonal
 * instead of curving.
 */
export function hatConeGeometry(height: number, baseRadius: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(baseRadius * 0.04, baseRadius, height, 16, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y <= 0) continue;
    // Quadratic in the *upper half* of the cone: the base stays planted on the
    // head and the curl accelerates toward the tip.
    //
    // Normalized over `height / 2` rather than over the full height, which is
    // what the two ported copies did: measuring from the base while skipping
    // everything below the midpoint left the bend at zero up to y = 0 and then
    // jumping straight to a third of the total lean in the first segment above
    // it — a visible crease at mid-cone instead of a curve.
    const factor = (y / (height / 2)) ** 2;
    pos.setX(i, pos.getX(i) - factor * height * 0.5);
    pos.setZ(i, pos.getZ(i) + factor * height * 0.16);
  }
  geo.computeVertexNormals();
  return geo;
}
