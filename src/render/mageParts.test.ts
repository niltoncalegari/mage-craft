import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildSpiralStaffHead,
  buildVoidFace,
  hatBrimGeometry,
  hatConeGeometry,
} from './mageParts';

/**
 * These are the parts the arena mage and the menu mage now share, so what is
 * worth pinning is the handful of properties each shape has to keep for the
 * *camera* — the arena looks down at 52°, and both hats used to be built by
 * two separate copies of the same vertex pass that could drift apart.
 */

/** Every vertex of the geometry, as a list. */
function vertices(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.attributes.position;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return out;
}

describe('hatConeGeometry', () => {
  const HEIGHT = 0.76;
  const BASE = 0.3;

  it('keeps the base ring seated on the head', () => {
    // The bend must not drag the base off the crown: a cone whose base has
    // slid sideways reads as a hat falling off rather than as a curled tip.
    // The cap's own center vertex sits on the axis; the ring around it is what
    // has to stay put.
    const base = vertices(hatConeGeometry(HEIGHT, BASE)).filter(
      (v) => v.y <= -HEIGHT / 2 + 1e-6 && Math.hypot(v.x, v.z) > 1e-6,
    );

    expect(base.length).toBeGreaterThan(4);
    for (const v of base) {
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(BASE, 5);
    }
  });

  it('curls the tip away from the mage’s facing', () => {
    // +X is the mage's forward (see PlayerRenderer.buildHat). A tip bent that
    // way folds the point down over the eyes the player aims by.
    const verts = vertices(hatConeGeometry(HEIGHT, BASE));
    const tip = verts.reduce((a, b) => (b.y > a.y ? b : a));

    expect(tip.x).toBeLessThan(-HEIGHT * 0.3);
    expect(tip.z).toBeGreaterThan(0);
  });

  it('accelerates the curl toward the tip', () => {
    // A bend that is linear in height shears the whole cone into a diagonal
    // stick; the curve is what makes it read as felt with a point that flops.
    // The mean x of a height band is the bend alone: the cone's own ring is
    // symmetric about the axis, so it cancels out of the average.
    const bands = new Map<number, number[]>();
    for (const v of vertices(hatConeGeometry(HEIGHT, BASE))) {
      const y = Number(v.y.toFixed(4));
      const band = bands.get(y) ?? [];
      band.push(v.x);
      bands.set(y, band);
    }

    const rows = [...bands.entries()]
      .map(([y, xs]): [number, number] => [y, xs.reduce((a, b) => a + b, 0) / xs.length])
      .sort((a, b) => a[0] - b[0]);
    expect(rows.length).toBeGreaterThan(3);

    // Successive height bands lean further per unit of height than the last.
    const slopes: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const [y, x] = rows[i];
      const [prevY, prevX] = rows[i - 1];
      slopes.push((x - prevX) / (y - prevY));
    }
    for (let i = 1; i < slopes.length; i++) {
      expect(slopes[i]).toBeLessThanOrEqual(slopes[i - 1] + 1e-6);
    }
  });
});

describe('hatBrimGeometry', () => {
  const RADIUS = 0.4;
  const THICKNESS = 0.03;

  it('keeps the brim the width it was asked for', () => {
    // The arena camera looks down: the brim disc is the largest surface facing
    // the player, and a brim that grew past its radius is an umbrella hiding
    // the head, the eyes and therefore the facing.
    const verts = vertices(hatBrimGeometry(RADIUS, THICKNESS));
    const widest = Math.max(...verts.map((v) => Math.hypot(v.x, v.z)));

    expect(widest).toBeCloseTo(RADIUS, 5);
  });

  it('waves the outer edge', () => {
    const rim = vertices(hatBrimGeometry(RADIUS, THICKNESS)).filter(
      (v) => Math.hypot(v.x, v.z) > RADIUS * 0.9 && v.y > 0,
    );
    const heights = new Set(rim.map((v) => Number(v.y.toFixed(4))));

    expect(rim.length).toBeGreaterThan(8);
    expect(heights.size).toBeGreaterThan(3);
  });

  it('leaves the crown of the brim flat', () => {
    // Where the brim meets the head it has to stay seated — rippling there
    // opens a gap between brim and skull that the light shines through.
    const inner = vertices(hatBrimGeometry(RADIUS, THICKNESS)).filter(
      (v) => Math.hypot(v.x, v.z) < RADIUS * 0.5,
    );

    expect(inner.length).toBeGreaterThan(4);
    for (const v of inner) {
      expect(Math.abs(v.y)).toBeCloseTo(THICKNESS / 2, 5);
    }
  });

  it('keeps the ripple shallow enough to stay a brim', () => {
    const verts = vertices(hatBrimGeometry(RADIUS, THICKNESS));
    const droop = Math.max(...verts.map((v) => Math.abs(v.y))) - THICKNESS / 2;

    expect(droop).toBeGreaterThan(RADIUS * 0.02);
    expect(droop).toBeLessThan(RADIUS * 0.2);
  });
});

describe('buildVoidFace', () => {
  const RADIUS = 0.25;

  function face(): ReturnType<typeof buildVoidFace> {
    return buildVoidFace(RADIUS, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
  }

  it('puts both eyes on the side the mage faces', () => {
    // The eyes replaced the beard as the facing cue, and facing is what the
    // player reads the aim direction from. +X is forward (see coords.ts).
    const { eyes } = face();

    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      expect(eye.position.x).toBeGreaterThan(0);
      expect(Math.abs(eye.position.z)).toBeLessThan(eye.position.x);
    }
  });

  it('mirrors the pair across the centerline', () => {
    const [left, right] = face().eyes;

    expect(left.position.x).toBeCloseTo(right.position.x, 6);
    expect(left.position.y).toBeCloseTo(right.position.y, 6);
    expect(left.position.z).toBeCloseTo(-right.position.z, 6);
  });

  it('stands the eyes proud of the skull so they are not swallowed by it', () => {
    // The skull is a sphere: at an eye's own z the surface sits at
    // sqrt(r^2 - z^2), and an eye buried behind that line glows into the
    // inside of the head where nobody can see it.
    for (const eye of face().eyes) {
      const geo = eye.geometry;
      geo.computeBoundingBox();
      const front = eye.position.x + geo.boundingBox!.max.x * eye.scale.x;
      const skullAtThatZ = Math.sqrt(RADIUS ** 2 - eye.position.z ** 2);

      expect(front).toBeGreaterThan(skullAtThatZ);
      // ...but only just: eyes floating off the face read as googly rather
      // than as slits lit from inside a hood.
      expect(front).toBeLessThan(skullAtThatZ + RADIUS * 0.3);
    }
  });

  it('flattens the eyes against the face and stands them tall', () => {
    // Slits, not beads — the reference model's signature is a tall narrow
    // glow, and a sphere at this size reads as a bug eye.
    for (const eye of face().eyes) {
      expect(eye.scale.x).toBeLessThan(eye.scale.y);
      expect(eye.scale.y).toBeGreaterThan(eye.scale.z);
    }
  });
});

describe('buildSpiralStaffHead', () => {
  const RADIUS = 0.12;

  /** Width of a child mesh along x, in the parent's frame. */
  function span(mesh: THREE.Mesh): number {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone();
    box.applyMatrix4(new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale));
    return box.max.x - box.min.x;
  }

  it('builds curls, not rings', () => {
    // A closed torus is symmetric about the axis; the spiral reads as carved
    // wood precisely because each curl stops short of closing.
    const curls = buildSpiralStaffHead(RADIUS, new THREE.MeshStandardMaterial())
      .children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
      .filter((c) => c.geometry.type === 'TorusGeometry');

    expect(curls.length).toBeGreaterThanOrEqual(2);
    for (const curl of curls) {
      curl.geometry.computeBoundingBox();
      const box = curl.geometry.boundingBox!;
      // A closed ring is centered in both axes of its own plane; an arc has to
      // be off-center in at least one, whichever way it happens to be turned.
      const offCenter = Math.max(
        Math.abs(box.max.x + box.min.x),
        Math.abs(box.max.y + box.min.y),
      );
      expect(offCenter).toBeGreaterThan(RADIUS * 0.1);
    }
  });

  it('tightens the curls as they wind inward', () => {
    const curls = buildSpiralStaffHead(RADIUS, new THREE.MeshStandardMaterial())
      .children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
      .filter((c) => c.geometry.type === 'TorusGeometry')
      .map(span);

    for (let i = 1; i < curls.length; i++) {
      expect(curls[i]).toBeLessThan(curls[i - 1]);
    }
  });

  it('leaves the crystal at the origin room to breathe', () => {
    // The gem is the throw-charge readout and it swells while charging: the
    // curl frames it, so the wood must not close over the space it grows into.
    const head = buildSpiralStaffHead(RADIUS, new THREE.MeshStandardMaterial());
    const box = new THREE.Box3().setFromObject(head);

    expect(box.min.length()).toBeGreaterThan(0);
    for (const child of head.children) {
      expect(child.position.length()).toBeGreaterThan(RADIUS * 0.3);
    }
  });
});
