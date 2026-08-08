import * as THREE from 'three';

export interface MageFigureParts {
  readonly root: THREE.Group;
  readonly figure: THREE.Group;
  readonly leftArm: THREE.Mesh;
  readonly rightArm: THREE.Mesh;
  readonly staff: THREE.Group;
  /**
   * Named rather than reached through `staff.children[1]`, which is how the
   * idle used to find it — adding any child to the staff silently animated the
   * wrong mesh.
   */
  readonly gem: THREE.Mesh;
}

/** Resting height of the staff crystal; the idle bobs around it. */
const GEM_REST_Y = 1.75;

/**
 * Lightweight procedural mage for menu / portal scenes (not tied to World).
 * Tuned toward a staff-wielding silhouette rather than the in-match fighter.
 */
export function createMageFigure(color: number, options?: { scale?: number }): MageFigureParts {
  const scale = options?.scale ?? 1;
  const root = new THREE.Group();
  const figure = new THREE.Group();

  const bodyMat = mat(color);
  const accentMat = mat(darken(color, 0.35));
  const skinMat = mat(0xffd6a5);
  const bootMat = mat(0x1c2430);
  const staffMat = mat(0x6b4f2a);
  const gemMat = mat(lighten(color, 0.25));
  const bandMat = mat(0xd4af37);
  const buckleMat = mat(0xe5e5e5);
  buckleMat.metalness = 0.9;
  buckleMat.roughness = 0.2;

  const robe = mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.95, 12), bodyMat);
  robe.position.y = 0.55;
  figure.add(robe);

  const chest = mesh(new THREE.SphereGeometry(0.32, 12, 10), bodyMat);
  chest.scale.y = 0.85;
  chest.position.y = 0.95;
  figure.add(chest);

  const head = mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat);
  head.position.y = 1.35;
  figure.add(head);

  // Same hat the in-match mage wears (see PlayerRenderer.buildHat), scaled to
  // this taller figure — menu and arena used to show two different wizards.
  const hatGroup = new THREE.Group();
  hatGroup.position.y = 1.48;
  figure.add(hatGroup);

  const hatBrim = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 20), accentMat);
  hatBrim.position.y = 0.015;
  hatGroup.add(hatBrim);

  const hatCone = mesh(bentCone(0.6), accentMat);
  hatCone.position.y = 0.3;
  hatGroup.add(hatCone);

  const hatBand = mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.055, 20, 1, true), bandMat);
  hatBand.position.y = 0.05;
  hatGroup.add(hatBand);

  const hatBuckle = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), buckleMat);
  hatBuckle.position.set(0.275, 0.05, 0);
  hatBuckle.rotation.y = Math.PI / 2;
  hatGroup.add(hatBuckle);

  const leftArm = mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.45, 8), bodyMat);
  leftArm.position.set(0.05, 0.95, -0.34);
  leftArm.rotation.z = -0.35;
  figure.add(leftArm);

  const rightArm = mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.45, 8), bodyMat);
  rightArm.position.set(0.05, 0.95, 0.34);
  rightArm.rotation.z = 0.2;
  figure.add(rightArm);

  const leftBoot = mesh(new THREE.SphereGeometry(0.11, 8, 8), bootMat);
  leftBoot.scale.set(1.2, 0.55, 0.9);
  leftBoot.position.set(0.08, 0.08, -0.14);
  figure.add(leftBoot);

  const rightBoot = mesh(new THREE.SphereGeometry(0.11, 8, 8), bootMat);
  rightBoot.scale.set(1.2, 0.55, 0.9);
  rightBoot.position.set(0.08, 0.08, 0.14);
  figure.add(rightBoot);

  const staff = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.7, 8), staffMat);
  pole.position.y = 0.85;
  staff.add(pole);
  const gem = mesh(new THREE.IcosahedronGeometry(0.12, 0), gemMat);
  gem.position.y = GEM_REST_Y;
  staff.add(gem);
  staff.position.set(0.15, 0.1, 0.42);
  staff.rotation.z = -0.15;
  figure.add(staff);

  root.add(figure);
  root.scale.setScalar(scale);
  return { root, figure, leftArm, rightArm, staff, gem };
}

/**
 * Cone with a curled tip — the vertex pass from the `sim/test.html` study, and
 * the same bend {@link PlayerRenderer.hatConeGeometry} applies in the arena.
 * Six height segments so the point curves rather than shearing straight.
 */
function bentCone(height: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.012, 0.26, height, 16, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y <= 0) continue;
    const factor = ((y + height / 2) / height) ** 2;
    pos.setX(i, pos.getX(i) - factor * height * 0.5);
    pos.setZ(i, pos.getZ(i) + factor * height * 0.16);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Gentle breathing idle for portal / character-select staging. */
export function animateMageIdle(parts: MageFigureParts, time: number, phaseOffset = 0): void {
  const t = time + phaseOffset;
  const breath = Math.sin(t * 2.4) * 0.012;
  parts.figure.position.y = breath;
  parts.figure.scale.set(1 + breath * 0.8, 1 - breath * 0.5, 1 + breath * 0.8);
  parts.leftArm.rotation.x = Math.sin(t * 1.6) * 0.08;
  parts.rightArm.rotation.x = Math.sin(t * 1.6 + 1.2) * 0.1;
  parts.staff.rotation.z = -0.15 + Math.sin(t * 1.8) * 0.04;
  const gem = parts.staff.children[1];
  if (gem) {
    gem.rotation.y = t * 1.4;
    gem.position.y = 1.75 + Math.sin(t * 3) * 0.02;
  }
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.82,
    metalness: 0.08,
  });
}

function darken(color: number, amount: number): number {
  const r = ((color >> 16) & 255) * (1 - amount);
  const g = ((color >> 8) & 255) * (1 - amount);
  const b = (color & 255) * (1 - amount);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function lighten(color: number, amount: number): number {
  const r = ((color >> 16) & 255) + (255 - ((color >> 16) & 255)) * amount;
  const g = ((color >> 8) & 255) + (255 - ((color >> 8) & 255)) * amount;
  const b = (color & 255) + (255 - (color & 255)) * amount;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
