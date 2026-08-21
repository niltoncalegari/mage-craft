import * as THREE from 'three';
import type { Arena } from '../game/types';
import { NO_INSETS, type ViewInsets } from '../ui/hudInsets';
import { ShakeRig } from './ShakeRig';

/**
 * Fixed render step, matching `PlayerRenderer` and `ParticleRenderer`. This
 * class has never taken a delta — its follow and zoom are per-frame lerps — and
 * introducing one only for the shake would put two clocks in one update.
 */
const RENDER_DT = 1 / 60;

/** The visible ground region (gameplay coords), used by the minimap. */
export interface CameraView {
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

/**
 * Orthographic camera with a cartoon 3/4 tilt that gently follows the local hero
 * (design §4). The zoom is adjustable with the mouse wheel between the whole
 * arena (min) and a close follow view (max); the view scrolls with the target
 * and is clamped so it never shows beyond the arena edges.
 *
 * Since the siege pivot there is no hero to follow in an online match, so the
 * view is steered by hand instead: {@link panBy} drags it around like a map.
 */
export class CameraController {
  readonly camera: THREE.OrthographicCamera;

  /** Elevation of the view above the horizon, in radians (lower = more oblique). */
  private readonly tilt = (52 * Math.PI) / 180;
  private readonly distance = 120;
  /** Visible ground width at MAX zoom, in world units (the close follow view). */
  private readonly maxZoomWidth = 25;
  /** Padding so the whole-arena (min-zoom) view leaves a small border. */
  private readonly fitMargin = 1.06;
  /** Per-frame smoothing factor for the follow (0..1; higher = snappier). */
  private readonly followLerp = 0.14;
  /** How much one wheel notch changes the zoom. */
  private readonly zoomStep = 0.12;
  /** Per-frame smoothing for the zoom easing (0..1; higher = snappier). */
  private readonly zoomLerp = 0.18;

  /** 0 = min zoom (whole arena), 1 = max zoom (close follow). */
  private zoomT = 0;
  /** Zoom level the wheel is steering toward; {@link zoomT} eases to meet it. */
  private zoomTarget = 0;
  private aspect = 1;
  private arena: Arena | null = null;
  /**
   * The share of the canvas the HUD has taken, per edge, as a fraction of the
   * canvas. Set by {@link setInsets}; zero everywhere until something asks.
   */
  private insets: ViewInsets = NO_INSETS;
  /**
   * Where the framed arena sits relative to the canvas centre, in gameplay
   * coords. Derived from {@link insets} in {@link applyFrustum} and applied in
   * {@link applyPosition} — deliberately *not* folded into `focus`, which is
   * the gameplay point the view is following and what `getView` and the arena
   * clamps are written against.
   */
  private offsetX = 0;
  private offsetZ = 0;
  private halfW = 10;
  private halfH = 10;
  private readonly focus = new THREE.Vector3(0, 0, 0);
  private readonly desired = new THREE.Vector3(0, 0, 0);
  /**
   * Hand-steered offset from the follow target (gameplay coords). Kept apart
   * from `focus` so it survives the per-frame lerp in {@link update}, which
   * would otherwise drag a panned view back to the target every frame.
   */
  private readonly panOffset = new THREE.Vector2(0, 0);
  /** Set by {@link panBy}: the next update lands the view instead of easing to it. */
  private panSnap = false;
  /** Gameplay point the current wheel gesture is zooming toward, if any. */
  private zoomAnchor: { x: number; y: number } | null = null;
  /**
   * Camera shake. Lives here because this is the one place that writes the
   * camera's transform — anywhere else would be fighting {@link applyPosition}
   * for it every frame.
   */
  private readonly shake = new ShakeRig();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.applyPosition();
  }

  /** Sizes the frustum for the current zoom and recentres on the arena (design §4). */
  fit(arena: Arena, aspect: number): void {
    this.arena = arena;
    this.aspect = aspect;
    this.focus.set(0, 0, 0);
    this.desired.set(0, 0, 0);
    this.panOffset.set(0, 0);
    this.applyFrustum();
    this.applyPosition();
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    if (this.arena) this.applyFrustum();
  }

  /**
   * Reserves part of the canvas for the HUD, as a fraction of the canvas on
   * each edge, so the arena is framed in what is left rather than under it.
   *
   * The canvas itself is untouched — it still fills the viewport and still
   * draws sky to the corners. Only the board moves, which is the point: glass
   * panels over sky look like glass panels, and glass panels over a Tower look
   * like a bug.
   */
  setInsets(insets: ViewInsets): void {
    this.insets = insets;
    if (!this.arena) return;
    this.applyFrustum();
    this.applyPosition();
  }

  /**
   * Steers zoom from a wheel event (scroll up = zoom in); eased in {@link update}.
   *
   * `anchor` is the gameplay point under the cursor. Given one, the zoom pulls
   * toward it instead of toward the middle of the screen, which is what makes
   * zooming feel like a map rather than a slider.
   */
  zoom(deltaY: number, anchor: { x: number; y: number } | null = null): void {
    const next = this.zoomTarget + (deltaY < 0 ? this.zoomStep : -this.zoomStep);
    this.zoomTarget = THREE.MathUtils.clamp(next, 0, 1);
    this.zoomAnchor = anchor;
  }

  /**
   * Drags the view by a ground-plane delta, the way you pull a map around.
   *
   * Marks the next {@link update} to snap instead of easing: the whole point of
   * a grab is that the ground tracks the cursor exactly, and `followLerp` would
   * turn that into elastic. Zoomed all the way out the arena is already on
   * screen in full, so `clampPan` reduces this to a no-op — panning only means
   * anything once there is something off screen.
   */
  panBy(dx: number, dy: number): void {
    this.panOffset.set(this.panOffset.x + dx, this.panOffset.y + dy);
    this.clampPan();
    this.panSnap = true;
  }

  /** Recentres the view, discarding a hand-steered pan. */
  resetPan(): void {
    this.panOffset.set(0, 0);
    this.panSnap = true;
  }

  /**
   * Advances the follow camera one frame toward `target` (gameplay coords), or
   * eases back to the arena centre when there is no target. Clamped to the arena.
   */
  /**
   * Adds camera shake for an event that just happened. See {@link ShakeRig} for
   * why the numbers are small; the rig refuses trauma outright under reduced
   * motion, so callers never have to ask.
   */
  addTrauma(amount: number): void {
    this.shake.addTrauma(amount);
  }

  update(target: { x: number; y: number } | null): void {
    this.animateZoom();
    this.shake.update(RENDER_DT);
    this.desired.set((target?.x ?? 0) + this.panOffset.x, 0, (target?.y ?? 0) + this.panOffset.y);
    this.clampToArena(this.desired);

    if (this.panSnap) {
      this.panSnap = false;
      this.focus.x = this.desired.x;
      this.focus.z = this.desired.z;
    } else {
      this.focus.x += (this.desired.x - this.focus.x) * this.followLerp;
      this.focus.z += (this.desired.z - this.focus.z) * this.followLerp;
    }
    this.applyPosition();
  }

  /** Eases the applied zoom toward the wheel target, reframing only on change. */
  private animateZoom(): void {
    if (this.zoomT === this.zoomTarget) {
      this.zoomAnchor = null;
      return;
    }

    const beforeX = this.halfW;
    const beforeZ = this.halfH / Math.sin(this.tilt);

    const diff = this.zoomTarget - this.zoomT;
    this.zoomT = Math.abs(diff) < 1e-4 ? this.zoomTarget : this.zoomT + diff * this.zoomLerp;
    this.applyFrustum();

    this.holdAnchorUnderCursor(beforeX, beforeZ);
    // Zooming out shrinks how far the view may stray; without this the stored
    // pan would survive at its old size and the next zoom-in would jump.
    this.clampPan();
  }

  /**
   * Shifts the pan so the point the wheel was aimed at keeps the same place on
   * screen across a zoom step. Applied per frame against the frustum change
   * that actually happened, rather than once against the target zoom, because
   * the zoom itself eases in over several frames.
   */
  private holdAnchorUnderCursor(beforeHalfX: number, beforeHalfZ: number): void {
    const anchor = this.zoomAnchor;
    if (!anchor || beforeHalfX <= 0 || beforeHalfZ <= 0) return;

    const afterHalfX = this.halfW;
    const afterHalfZ = this.halfH / Math.sin(this.tilt);
    // Where the anchor sat in the old frustum, as a fraction of it, is where it
    // has to sit in the new one.
    const u = (anchor.x - this.focus.x) / beforeHalfX;
    const v = (anchor.y - this.focus.z) / beforeHalfZ;

    this.panOffset.x += anchor.x - u * afterHalfX - this.focus.x;
    this.panOffset.y += anchor.y - v * afterHalfZ - this.focus.z;
    this.panSnap = true;
  }

  /** The visible ground rectangle in gameplay coords (for the minimap viewport). */
  getView(): CameraView {
    return {
      x: this.focus.x + this.offsetX,
      y: this.focus.z + this.offsetZ,
      halfX: this.halfW,
      halfY: this.halfH / Math.sin(this.tilt),
    };
  }

  /**
   * Positions the camera at a fixed offset above/behind the focus point.
   *
   * The shake is added on top of the *derived* position and never accumulates,
   * because this recomputes from `focus` every frame. `lookAt` is aimed at the
   * unshaken focus on purpose: aiming at the offset point would swing the view
   * instead of nudging it, and at this tilt a swing reads as the arena moving.
   * `getView` reads `focus` too, so the minimap viewport does not jitter along.
   */
  private applyPosition(): void {
    const offY = Math.sin(this.tilt) * this.distance;
    const offZ = Math.cos(this.tilt) * this.distance;
    // The HUD offset moves the eye and its aim by the same amount, so it pans
    // the view without tilting it — unlike the shake, which moves only the eye.
    const x = this.focus.x + this.offsetX;
    const z = this.focus.z + this.offsetZ;
    this.camera.position.set(x + this.shake.offsetX, offY + this.shake.offsetY, z + offZ);
    this.camera.lookAt(x, 0, z);
  }

  /**
   * Sizes the frustum, and offsets it by whatever the HUD has reserved.
   *
   * With no insets this is the plain fit it always was. With them, the arena is
   * fitted to the *free* rectangle — hence `freeAspect`, which is the canvas
   * aspect skewed by how much of each dimension survives — and then the frustum
   * is scaled back up by `1 / freeW` so that free rectangle occupies its real
   * share of a canvas that still spans the whole viewport. Dividing by `freeW`
   * on the width alone is enough for both axes: the ortho frustum's own aspect
   * has to stay the canvas aspect, so the height follows from it.
   */
  private applyFrustum(): void {
    const arena = this.arena;
    if (!arena) return;
    const aspect = this.aspect;

    const freeW = Math.max(0.1, 1 - this.insets.left - this.insets.right);
    const freeH = Math.max(0.1, 1 - this.insets.top - this.insets.bottom);
    const freeAspect = aspect * (freeW / freeH);

    // Min zoom: the half-width that fits the whole arena for this aspect (depth
    // is foreshortened by the tilt). Max zoom: the close follow width.
    const fitHalfW =
      Math.max(arena.width / 2, (arena.height / 2) * Math.sin(this.tilt) * freeAspect) *
      this.fitMargin;
    const tightHalfW = Math.min(this.maxZoomWidth / 2, fitHalfW);

    const halfW = THREE.MathUtils.lerp(fitHalfW, tightHalfW, this.zoomT) / freeW;
    const halfH = halfW / aspect;

    this.halfW = halfW;
    this.halfH = halfH;

    /*
     * Slide the board into the middle of the free rectangle. A HUD band on the
     * left pushes the board right, which means the camera moves left — hence
     * the negation. The vertical one is divided by sin(tilt) because a step
     * across the ground is foreshortened by the tilt before it reaches the
     * screen, and what has to end up centred is the screen distance.
     */
    this.offsetX = -(this.insets.left - this.insets.right) * halfW;
    this.offsetZ = -((this.insets.top - this.insets.bottom) * halfH) / Math.sin(this.tilt);

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Keeps the visible ground rectangle inside the arena (mutates `point`). */
  private clampToArena(point: THREE.Vector3): void {
    const arena = this.arena;
    if (!arena) return;
    const limitX = arena.width / 2 - this.halfW;
    const limitZ = arena.height / 2 - this.halfH / Math.sin(this.tilt);
    point.x = limitX > 0 ? THREE.MathUtils.clamp(point.x, -limitX, limitX) : 0;
    point.z = limitZ > 0 ? THREE.MathUtils.clamp(point.z, -limitZ, limitZ) : 0;
  }

  /**
   * Bounds the stored pan by the same arena limits. Clamping the offset itself
   * rather than only the resulting focus is what keeps a drag from going sticky:
   * an offset allowed to run past the edge would have to be dragged all the way
   * back before the view moved again.
   */
  private clampPan(): void {
    const arena = this.arena;
    if (!arena) return;
    const limitX = arena.width / 2 - this.halfW;
    const limitZ = arena.height / 2 - this.halfH / Math.sin(this.tilt);
    this.panOffset.x = limitX > 0 ? THREE.MathUtils.clamp(this.panOffset.x, -limitX, limitX) : 0;
    this.panOffset.y = limitZ > 0 ? THREE.MathUtils.clamp(this.panOffset.y, -limitZ, limitZ) : 0;
  }
}
