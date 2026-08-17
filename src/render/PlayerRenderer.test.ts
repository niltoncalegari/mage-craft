import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetManager } from '../engine/AssetManager';
import { createEmptyArena } from '../game/Arena';
import { PlayerState, Team, type Player } from '../game/types';
import { World } from '../game/World';
import { PlayerRenderer } from './PlayerRenderer';

/**
 * The arena mage's head is the part the whole read hangs off: a shadow under the
 * brim with two lit eyes in it, and the eyes are the only thing telling the
 * player which way a mage is pointing (the beard used to do that job).
 */

function setup(): {
  scene: THREE.Scene;
  world: World;
  player: Player;
  renderer: PlayerRenderer;
} {
  const scene = new THREE.Scene();
  const world = new World(createEmptyArena(), 1);
  const player = world.addPlayer(Team.Player, 0, 0);
  const renderer = new PlayerRenderer(scene, new AssetManager(), world);
  renderer.sync(0);
  return { scene, world, player, renderer };
}

function find(scene: THREE.Scene, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if (obj.name === name && (obj as THREE.Mesh).isMesh) out.push(obj as THREE.Mesh);
  });
  return out;
}

function material(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  return mesh.material as THREE.MeshStandardMaterial;
}

describe('PlayerRenderer', () => {
  it('lights a pair of eyes on the side the mage faces', () => {
    const { scene, renderer } = setup();
    const eyes = find(scene, 'mage-eye');

    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      // +X is forward (see coords.ts); the player is at the origin unrotated.
      expect(eye.getWorldPosition(new THREE.Vector3()).x).toBeGreaterThan(0);
      expect(material(eye).emissiveIntensity).toBeGreaterThan(0);
    }

    renderer.dispose();
  });

  it('keeps the face in shadow instead of giving it the team colour', () => {
    const { scene, renderer } = setup();
    const [face] = find(scene, 'mage-face');
    const hsl = { h: 0, s: 0, l: 0 };
    material(face).color.getHSL(hsl);

    expect(hsl.l).toBeLessThan(0.12);

    renderer.dispose();
  });

  it('dims the eyes along with the body when a mage falls', () => {
    // A corpse dissolves; two eyes left glowing over the spot where it fell
    // read as a live enemy standing there.
    const { scene, world, player, renderer } = setup();
    const [eye] = find(scene, 'mage-eye');

    player.alive = false;
    player.state = PlayerState.Defeated;
    player.animationTime = 5;
    renderer.sync(0);

    expect(material(eye).opacity).toBeLessThan(0.05);
    expect(world.players).toHaveLength(1);

    renderer.dispose();
  });
});

describe('PlayerRenderer petrify', () => {
  it('puts the eyes out while a mage is stone', () => {
    // The file already refuses to sway a statue's hat, for the same reason: a
    // statue that is still visibly alive somewhere is not a statue.
    const { scene, player, renderer } = setup();
    const [eye] = find(scene, 'mage-eye');
    const lit = material(eye).emissiveIntensity;

    player.fx = [{ kind: 'petrify', stacks: 1 }];
    renderer.sync(0);
    expect(material(eye).emissiveIntensity).toBe(0);

    player.fx = [];
    renderer.sync(0);
    expect(material(eye).emissiveIntensity).toBeCloseTo(lit, 6);

    renderer.dispose();
  });
});

describe('PlayerRenderer facing cue', () => {
  /**
   * The match camera sits 52° above the horizon looking down the -Z axis
   * (see CameraController.applyPosition), so this is the direction the player
   * actually sees a mage from.
   */
  const VIEW = new THREE.Vector3(0, Math.sin((52 * Math.PI) / 180), Math.cos((52 * Math.PI) / 180));

  /** Whether anything up the chain is switched off (three's raycaster ignores this). */
  function shown(object: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      if (!o.visible) return false;
    }
    return true;
  }

  /** Is `target` the first *drawn* thing the camera hits along the ray to it? */
  function visible(root: THREE.Object3D, target: THREE.Mesh): boolean {
    root.updateMatrixWorld(true);
    const at = target.getWorldPosition(new THREE.Vector3());
    const from = at.clone().addScaledVector(VIEW, 10);
    const ray = new THREE.Raycaster(from, VIEW.clone().negate());
    // The status shells (shield dome, vulnerability shell) are hemispheres parked
    // around every mage with `visible = false`; the raycaster hits them anyway.
    const hits = ray.intersectObject(root, true).filter((hit) => shown(hit.object));
    return hits.length > 0 && hits[0].object === target;
  }

  it('leaves the eyes in plain sight from the match camera', () => {
    // This is the whole reason the mage used to wear a beard: the head is a
    // sphere with nothing on it, so *something* has to say which way it points,
    // and a wide brim seen from above hides everything under it. The beard was
    // shaped to duck out from under the brim; the eyes have to clear it too, or
    // the facing cue is a cue nobody can see.
    const { scene, world, renderer } = setup();
    const eyes = find(scene, 'mage-eye');
    const root = scene.getObjectByName(`player-${world.players[0].id}`)!;

    // Square at the camera, both of them: one lit dot under a brim reads as a
    // specular highlight, and it takes the pair to read as a face.
    root.rotation.y = -Math.PI / 2;
    for (const eye of eyes) {
      expect(visible(root, eye), `eye at z=${eye.position.z.toFixed(2)}`).toBe(true);
    }

    // Turned three-quarters either way, at least one eye still carries it. A mage
    // with its back to the camera is *supposed* to hide them.
    for (const facing of [-Math.PI / 4, (-3 * Math.PI) / 4]) {
      root.rotation.y = facing;
      expect(eyes.some((eye) => visible(root, eye)), `facing ${facing.toFixed(2)}`).toBe(true);
    }

    renderer.dispose();
  });
});
