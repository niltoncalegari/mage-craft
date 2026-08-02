import * as THREE from 'three';

export interface MageFigureParts {
  readonly root: THREE.Group;
  readonly figure: THREE.Group;
  readonly leftArm: THREE.Mesh;
  readonly rightArm: THREE.Mesh;
  readonly staff: THREE.Group;
}

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

  const hatBrim = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16), accentMat);
  hatBrim.position.y = 1.5;
  figure.add(hatBrim);

  const hat = mesh(new THREE.ConeGeometry(0.2, 0.55, 12), accentMat);
  hat.position.y = 1.78;
  hat.rotation.z = 0.12;
  figure.add(hat);

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
  gem.position.y = 1.75;
  staff.add(gem);
  staff.position.set(0.15, 0.1, 0.42);
  staff.rotation.z = -0.15;
  figure.add(staff);

  root.add(figure);
  root.scale.setScalar(scale);
  return { root, figure, leftArm, rightArm, staff };
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
