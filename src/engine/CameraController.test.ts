import { describe, expect, it } from 'vitest';
import { createEmptyArena } from '../game/Arena';
import { CameraController } from './CameraController';

const ASPECT = 1280 / 800;

/** Zoom in a lot so the target clamps to max zoom, giving a clear travel range. */
function zoomInHard(controller: CameraController): void {
  for (let i = 0; i < 20; i++) controller.zoom(-100);
}

describe('CameraController zoom smoothing', () => {
  it('does not change the view on the wheel event alone (no instant snap)', () => {
    const controller = new CameraController();
    controller.fit(createEmptyArena(), ASPECT);

    const before = controller.getView().halfX;
    zoomInHard(controller);

    expect(controller.getView().halfX).toBe(before);
  });

  it('eases toward the target over several frames rather than jumping', () => {
    const controller = new CameraController();
    controller.fit(createEmptyArena(), ASPECT);

    const start = controller.getView().halfX;
    zoomInHard(controller);

    controller.update(null);
    const afterOne = controller.getView().halfX;

    // Moved after one frame, but only part of the way.
    expect(afterOne).toBeLessThan(start);

    for (let i = 0; i < 500; i++) controller.update(null);
    const settled = controller.getView().halfX;

    // The first frame did not reach the final zoom (it was gradual)...
    expect(afterOne).toBeGreaterThan(settled);
    // ...and zooming in shrinks the visible width overall.
    expect(settled).toBeLessThan(start);
  });

  it('settles exactly at the target and then stops moving', () => {
    const controller = new CameraController();
    controller.fit(createEmptyArena(), ASPECT);

    zoomInHard(controller);
    for (let i = 0; i < 500; i++) controller.update(null);

    const settled = controller.getView().halfX;
    controller.update(null);
    controller.update(null);

    expect(controller.getView().halfX).toBe(settled);
  });
});

/*
 * Since the pivot an online match has no hero to follow, so the view is steered
 * by hand: the player grabs the ground and pulls, the way a map app works.
 */
describe('CameraController panning', () => {
  /** Zoomed in and settled, which is the only state where panning can do anything. */
  function zoomedIn(): CameraController {
    const controller = new CameraController();
    controller.fit(createEmptyArena(), ASPECT);
    zoomInHard(controller);
    for (let i = 0; i < 500; i++) controller.update(null);
    return controller;
  }

  it('lands the view on the drag instead of easing into it', () => {
    const controller = zoomedIn();

    controller.panBy(3, 0);
    controller.update(null);

    // A grab has to track the cursor exactly; any smoothing here reads as the
    // ground sliding out from under the pointer.
    expect(controller.getView().x).toBeCloseTo(3, 5);
  });

  it('accumulates successive drags', () => {
    const controller = zoomedIn();

    controller.panBy(2, 1);
    controller.update(null);
    controller.panBy(1, 2);
    controller.update(null);

    expect(controller.getView().x).toBeCloseTo(3, 5);
    expect(controller.getView().y).toBeCloseTo(3, 5);
  });

  it('holds the view inside the arena however far the drag goes', () => {
    const controller = zoomedIn();
    const arena = createEmptyArena();

    controller.panBy(9999, 9999);
    controller.update(null);

    const view = controller.getView();
    expect(view.x + view.halfX).toBeLessThanOrEqual(arena.width / 2 + 1e-6);
    expect(view.y + view.halfY).toBeLessThanOrEqual(arena.height / 2 + 1e-6);
  });

  /*
   * The stickiness this guards against: an offset allowed to run past the edge
   * would have to be dragged all the way back before the view moved at all.
   */
  it('answers the very next drag back, with no dead travel', () => {
    const controller = zoomedIn();

    controller.panBy(9999, 0);
    controller.update(null);
    const atEdge = controller.getView().x;

    controller.panBy(-1, 0);
    controller.update(null);

    expect(controller.getView().x).toBeCloseTo(atEdge - 1, 5);
  });

  it('recentres when zoomed back out, and does not jump on the way back in', () => {
    const controller = zoomedIn();
    controller.panBy(9999, 9999);
    controller.update(null);

    for (let i = 0; i < 20; i++) controller.zoom(100);
    for (let i = 0; i < 500; i++) controller.update(null);

    // The whole arena fits, so there is nowhere to pan to.
    expect(controller.getView().x).toBeCloseTo(0, 5);
    expect(controller.getView().y).toBeCloseTo(0, 5);

    zoomInHard(controller);
    controller.update(null);
    expect(controller.getView().x).toBeCloseTo(0, 5);
  });

  /*
   * Not asserted as "exactly put": the view is still clamped to the arena, so
   * near an edge the anchor has to give. What must hold is that aiming the
   * wheel at a point pulls the view there instead of tightening on the middle.
   */
  it('zooms toward the point under the cursor, not the middle of the screen', () => {
    const anchor = { x: 8, y: -4 };

    /** How far the anchor slid across the screen over a zoom, 0 = not at all. */
    const drift = (anchored: boolean): number => {
      const controller = new CameraController();
      controller.fit(createEmptyArena(), ASPECT);
      const at = (): { u: number; v: number } => {
        const view = controller.getView();
        return { u: (anchor.x - view.x) / view.halfX, v: (anchor.y - view.y) / view.halfY };
      };

      const before = at();
      for (let i = 0; i < 6; i++) {
        controller.zoom(-100, anchored ? anchor : null);
        controller.update(null);
      }
      const after = at();
      return Math.hypot(after.u - before.u, after.v - before.v);
    };

    expect(drift(true)).toBeLessThan(drift(false) / 2);
  });
});
