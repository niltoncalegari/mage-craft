import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetManager } from '../engine/AssetManager';
import { projectileGeometry, runeRingGeometry, type ProjectileShape } from './projectileGeometry';

/**
 * The point of these shapes is that no two elements read the same at match
 * zoom (GDD §17), so what is worth testing is that they are actually
 * *different solids* — not that any one of them has a particular vertex count.
 * Every element used to share one sphere, and nothing failed when it did.
 */

const SHAPES: ProjectileShape[] = [
  'orb',
  'bolt',
  'rock',
  'shard',
  'glob',
  'runeOrb',
  'blade',
  'sigil',
  'wave',
];

/** Bounding-box proportions, which is roughly what a silhouette is. */
function proportions(geometry: THREE.BufferGeometry): string {
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  return [size.x / longest, size.y / longest, size.z / longest]
    .map((v) => v.toFixed(2))
    .join(':');
}

describe('projectile geometry', () => {
  it('builds every shape with finite vertices', () => {
    const assets = new AssetManager();
    for (const shape of SHAPES) {
      const position = projectileGeometry(assets, shape).getAttribute('position');
      expect(position.count, shape).toBeGreaterThan(0);
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i)), `${shape} vertex ${i}`).toBe(true);
        expect(Number.isFinite(position.getY(i)), `${shape} vertex ${i}`).toBe(true);
        expect(Number.isFinite(position.getZ(i)), `${shape} vertex ${i}`).toBe(true);
      }
    }
  });

  /**
   * `sigil` and `wave` are merged from several primitives, and a merge with
   * mismatched attributes fails by returning null — which would only show up
   * in game as a projectile that is not there.
   */
  it('merges the composite shapes into a single solid', () => {
    const assets = new AssetManager();
    for (const shape of ['sigil', 'wave'] as const) {
      const geometry = projectileGeometry(assets, shape);
      expect(geometry.getAttribute('position').count, shape).toBeGreaterThan(50);
      expect(geometry.getAttribute('normal'), shape).toBeDefined();
    }
  });

  it('gives the elements that share the orb a distinct silhouette', () => {
    const assets = new AssetManager();
    // 'orb', 'bolt' and 'runeOrb' are the same ball on purpose: fire keeps its
    // look, a bolt draws no body, and the Archer's orb is told apart by the
    // rune band the renderer hangs around it.
    const distinct = ['rock', 'shard', 'glob', 'blade', 'sigil', 'wave'] as const;
    const seen = new Set<string>();
    for (const shape of distinct) {
      seen.add(proportions(projectileGeometry(assets, shape)));
    }
    expect(seen.size).toBe(distinct.length);
  });

  it('makes the Golem’s rock irregular rather than a tinted ball', () => {
    const assets = new AssetManager();
    const position = projectileGeometry(assets, 'rock').getAttribute('position');

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    // A sphere would come out at a ratio of 1.00.
    expect(max / min).toBeGreaterThan(1.2);
  });

  it('builds each shape once and hands back the cached instance', () => {
    const assets = new AssetManager();
    for (const shape of SHAPES) {
      expect(projectileGeometry(assets, shape)).toBe(projectileGeometry(assets, shape));
    }
    expect(runeRingGeometry(assets)).toBe(runeRingGeometry(assets));
  });

  /**
   * The rock is jittered by a seeded PRNG, not `Math.random`: a boulder whose
   * facets rearranged between sessions would read as a rendering bug.
   */
  it('builds the same rock every time', () => {
    const first = projectileGeometry(new AssetManager(), 'rock').getAttribute('position');
    const second = projectileGeometry(new AssetManager(), 'rock').getAttribute('position');

    expect(second.count).toBe(first.count);
    for (let i = 0; i < first.count; i++) {
      expect(second.getX(i)).toBe(first.getX(i));
    }
  });
});
