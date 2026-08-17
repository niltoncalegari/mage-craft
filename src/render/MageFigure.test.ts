import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animateMageIdle, createMageFigure } from './MageFigure';

/**
 * The figure the title screen stages behind the portal. Two things about it are
 * worth holding: it wears the same face the arena mage does (the mage you pick
 * has to be the mage that walks out), and its idle animates the parts it says
 * it animates.
 */

describe('createMageFigure', () => {
  it('faces the same way the arena mage does', () => {
    // +X is forward everywhere in this game (see coords.ts), and PortalScene
    // turns these figures by that assumption to make them look at the portal.
    const { eyes } = createMageFigure(0x3d8bfd);

    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      const world = eye.getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeGreaterThan(0);
    }
  });

  it('scales the whole figure, staff included', () => {
    const small = createMageFigure(0x3d8bfd, { scale: 0.5 });
    const big = createMageFigure(0x3d8bfd, { scale: 1.5 });

    const height = (fig: { root: THREE.Object3D }): number =>
      new THREE.Box3().setFromObject(fig.root).max.y;

    expect(height(big)).toBeGreaterThan(height(small) * 2.5);
  });
});

describe('animateMageIdle', () => {
  it('bobs the crystal the parts name, not whatever hangs off the staff', () => {
    // The idle used to reach for `staff.children[1]`, which is why `gem` is a
    // named part: the staff carries its carved head as well now, and index 1 is
    // no longer the crystal.
    const parts = createMageFigure(0x3d8bfd);
    const rest = parts.gem.position.y;

    animateMageIdle(parts, 0.4);

    expect(parts.gem.position.y).not.toBeCloseTo(rest, 6);
    expect(parts.gem.rotation.y).toBeGreaterThan(0);
  });

  it('bobs around where the crystal was built, not a hardcoded height', () => {
    // The rest height used to be written out again inside the animation. Move
    // the staff or the crystal and the gem would teleport on the first frame.
    const parts = createMageFigure(0x3d8bfd);
    const rest = parts.gem.position.y;

    animateMageIdle(parts, 0);

    expect(parts.gem.position.y).toBeCloseTo(rest, 6);
  });

  it('leaves the figure standing where it started', () => {
    // A breathing idle: it may squash and lift a little, but a figure that
    // drifts off its mark over time is a figure that walks out of frame.
    const parts = createMageFigure(0x3d8bfd);

    for (const t of [0, 1.3, 7.7, 41.2]) {
      animateMageIdle(parts, t);
      expect(Math.abs(parts.figure.position.y)).toBeLessThan(0.05);
    }
  });
});
