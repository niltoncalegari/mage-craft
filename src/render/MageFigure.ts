import * as THREE from 'three';
import { buildSpiralStaffHead, buildVoidFace, hatBrimGeometry, hatConeGeometry } from './mageParts';

export interface MageFigureParts {
  readonly root: THREE.Group;
  readonly figure: THREE.Group;
  readonly leftArm: THREE.Mesh;
  readonly rightArm: THREE.Mesh;
  readonly staff: THREE.Group;
  /**
   * Named rather than reached through `staff.children[1]`, which is how the
   * idle used to find it — adding any child to the staff silently animated the
   * wrong mesh, and the staff now carries its carved head as well.
   */
  readonly gem: THREE.Mesh;
  /**
   * The two lights in the hood. Exposed so a caller can dim or tint them; the
   * idle leaves them alone.
   */
  readonly eyes: readonly THREE.Mesh[];
}

/** Radius of the void head, which everything above the collar is sized from. */
const HEAD_RADIUS = 0.22;
/** Where the head sits, and with it the hat and the collar's opening. */
const HEAD_Y = 1.28;
/** Height of the staff crystal; the idle bobs around it. */
const GEM_REST_Y = 1.75;

/**
 * Lightweight procedural mage for menu / portal scenes (not tied to World).
 *
 * Deliberately the same build as the arena fighter ({@link PlayerRenderer}) down
 * to the shared parts in {@link mageParts}: a shadowed face with two lit eyes
 * under a floppy brim, a flared collar, and a carved staff. The mage on the
 * title screen is the one that walks into the match, so the two cannot drift.
 *
 * What differs is only what the menu can afford: a taller hat and a longer staff
 * than the arena camera tolerates, because here the figure is the hero shot
 * rather than one of eight in a scrum.
 */
export function createMageFigure(color: number, options?: { scale?: number }): MageFigureParts {
  const scale = options?.scale ?? 1;
  const root = new THREE.Group();
  const figure = new THREE.Group();

  const bodyMat = mat(color);
  // The collar is an open tube, so the cloth material has to render both faces.
  // The robe and shoulders sharing it are closed solids, which do not care.
  bodyMat.side = THREE.DoubleSide;
  const accentMat = mat(darken(color, 0.35));
  // Not pure black: a face with zero albedo takes no light at all and turns
  // into a hole in the frame rather than a shadow with a shape.
  const faceMat = mat(0x0b0b12);
  faceMat.roughness = 1;
  const eyeMat = mat(0xffea00);
  eyeMat.emissive = new THREE.Color(0xffd500);
  eyeMat.emissiveIntensity = 2.4;
  const leatherMat = mat(0x8d5524);
  const bootMat = mat(0x1c2430);
  const staffMat = mat(0x6b4f2a);
  const gemMat = mat(lighten(color, 0.25));
  const bandMat = mat(0xd4af37);
  const buckleMat = mat(0xe5e5e5);
  buckleMat.metalness = 0.9;
  buckleMat.roughness = 0.2;

  const robe = mesh(new THREE.CylinderGeometry(0.3, 0.55, 0.78, 14), bodyMat);
  robe.position.y = 0.47;
  figure.add(robe);

  // The hem, weighted with a rolled edge. Gives the robe a bottom the eye can
  // find — a bare cylinder cut reads as the figure sinking into the floor.
  const hem = mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 24), accentMat);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.1;
  figure.add(hem);

  const belt = mesh(new THREE.TorusGeometry(0.42, 0.038, 8, 24), accentMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.44;
  figure.add(belt);

  const shoulders = mesh(new THREE.SphereGeometry(0.3, 12, 10), bodyMat);
  shoulders.scale.y = 0.8;
  shoulders.position.y = 0.88;
  figure.add(shoulders);

  // The flared collar, open at both ends so it reads as cloth standing up around
  // the face rather than as a funnel bolted to the shoulders. This is what puts
  // the head in shadow, and the shadow is the whole silhouette.
  const collar = mesh(new THREE.CylinderGeometry(0.4, 0.27, 0.26, 20, 1, true), bodyMat);
  collar.position.y = 1.03;
  figure.add(collar);

  const face = buildVoidFace(HEAD_RADIUS, faceMat, eyeMat);
  face.group.position.y = HEAD_Y;
  figure.add(face.group);

  const hatGroup = new THREE.Group();
  hatGroup.position.y = HEAD_Y + 0.14;
  figure.add(hatGroup);

  const hatBrim = mesh(hatBrimGeometry(0.46, 0.03), accentMat);
  hatGroup.add(hatBrim);

  const hatHeight = 0.86;
  const hatCone = mesh(hatConeGeometry(hatHeight, 0.28), accentMat);
  hatCone.position.y = hatHeight / 2;
  hatGroup.add(hatCone);

  // Radius follows the cone's own taper at the band's height, so the band grips
  // the felt instead of floating around it.
  const bandY = 0.06;
  const bandRadius = 0.28 * (1 - bandY / hatHeight) + 0.005;
  const hatBand = mesh(
    new THREE.CylinderGeometry(bandRadius, bandRadius, 0.055, 20, 1, true),
    bandMat,
  );
  hatBand.position.y = bandY;
  hatGroup.add(hatBand);

  const hatBuckle = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), buckleMat);
  hatBuckle.position.set(bandRadius, bandY, 0);
  hatBuckle.rotation.y = Math.PI / 2;
  hatGroup.add(hatBuckle);

  const leftArm = buildArm(bodyMat, leatherMat, -0.36, -0.35);
  const rightArm = buildArm(bodyMat, leatherMat, 0.36, 0.2);
  figure.add(leftArm, rightArm);

  // Rounded and pointing forward (+X): capsules on their side, so the toe is a
  // curve rather than the flat end of a box.
  const leftBoot = buildBoot(bootMat, -0.15);
  const rightBoot = buildBoot(bootMat, 0.15);
  figure.add(leftBoot, rightBoot);

  const staff = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.7, 8), staffMat);
  pole.position.y = 0.85;
  staff.add(pole);
  const staffHead = buildSpiralStaffHead(0.17, staffMat);
  staffHead.position.y = GEM_REST_Y;
  staff.add(staffHead);
  const gem = mesh(new THREE.IcosahedronGeometry(0.12, 0), gemMat);
  gem.position.y = GEM_REST_Y;
  staff.add(gem);
  staff.position.set(0.15, 0.1, 0.42);
  staff.rotation.z = -0.15;
  figure.add(staff);

  root.add(figure);
  root.scale.setScalar(scale);
  return { root, figure, leftArm, rightArm, staff, gem, eyes: face.eyes };
}

/** Sleeve plus the glove at the end of it, which swings with the arm for free. */
function buildArm(
  sleeveMat: THREE.Material,
  gloveMat: THREE.Material,
  z: number,
  tilt: number,
): THREE.Mesh {
  const arm = mesh(new THREE.CapsuleGeometry(0.06, 0.28, 4, 8), sleeveMat);
  arm.position.set(0.05, 0.95, z);
  arm.rotation.z = tilt;

  const glove = mesh(new THREE.SphereGeometry(0.095, 10, 8), gloveMat);
  glove.position.y = -0.22;
  arm.add(glove);

  return arm;
}

function buildBoot(bootMat: THREE.Material, z: number): THREE.Mesh {
  const boot = mesh(new THREE.CapsuleGeometry(0.1, 0.16, 4, 8), bootMat);
  // Axis to +X: the mage's forward, so the toes point where it walks.
  boot.rotation.z = Math.PI / 2;
  boot.position.set(0.06, 0.1, z);
  return boot;
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
  parts.gem.rotation.y = t * 1.4;
  parts.gem.position.y = GEM_REST_Y + Math.sin(t * 3) * 0.02;
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
