import * as THREE from 'three';
import { CameraController } from './CameraController';
import type { Arena } from '../game/types';
import { NO_INSETS, type ViewInsets } from '../ui/hudInsets';

/**
 * Owns the Three.js scene, WebGL renderer, camera and lighting (design §8).
 * Renderers add their meshes to {@link scene}; the simulation never touches
 * anything here.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly cameraController = new CameraController();
  readonly webgl: THREE.WebGLRenderer;

  /** Optional provider for the follow-camera target (local hero, gameplay coords). */
  private followTarget: (() => { x: number; y: number } | null) | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  /** HUD bands in CSS pixels; kept here so a resize can re-derive fractions. */
  private hudInsets: ViewInsets = NO_INSETS;

  constructor(private readonly container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xbfe6ff);
    this.scene.fog = new THREE.Fog(0xbfe6ff, 120, 260);

    this.setupLights();
    container.appendChild(this.webgl.domElement);
    this.webgl.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get camera(): THREE.OrthographicCamera {
    return this.cameraController.camera;
  }

  get domElement(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  /** Frames the camera on the arena once it is loaded. */
  frameArena(arena: Arena): void {
    this.cameraController.fit(arena, this.aspect());
    this.applyHudInsets();
  }

  /**
   * Tells the camera how much of the canvas the HUD has taken, in CSS pixels
   * per edge, so the arena is framed in the hole rather than behind the panels.
   * Pixels rather than fractions because that is what the HUD can measure, and
   * because they have to be re-divided by the canvas on every resize.
   */
  setHudInsets(insets: ViewInsets): void {
    this.hudInsets = insets;
    this.applyHudInsets();
  }

  private applyHudInsets(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.cameraController.setInsets({
      top: this.hudInsets.top / h,
      right: this.hudInsets.right / w,
      bottom: this.hudInsets.bottom / h,
      left: this.hudInsets.left / w,
    });
  }

  /** Sets the follow-camera target provider (returns gameplay coords or null). */
  setFollowTarget(fn: () => { x: number; y: number } | null): void {
    this.followTarget = fn;
  }

  render(): void {
    this.cameraController.update(this.followTarget ? this.followTarget() : null);
    this.webgl.render(this.scene, this.camera);
  }

  private setupLights(): void {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x8aa6c6, 0.95);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff1d0, 1.65);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 30;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.radius = 2;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // Dim cool back/rim light for a bright cartoon edge on characters.
    const rim = new THREE.DirectionalLight(0xbfe0ff, 0.5);
    rim.position.set(-24, 26, -30);
    this.scene.add(rim);
  }

  private aspect(): number {
    return this.container.clientWidth / Math.max(this.container.clientHeight, 1);
  }

  private readonly resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.webgl.setSize(w, h);
    this.cameraController.resize(this.aspect());
    this.applyHudInsets();
  };

  /**
   * The gameplay point under a pointer event, by raycasting the ground plane —
   * the same technique InputManager uses, kept here because the wheel handler
   * lives here and needs it to zoom toward the cursor.
   */
  groundPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
    return point ? { x: point.x, y: point.z } : null;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Anchored on the cursor, so the ground under the pointer stays put as the
    // view tightens — the gesture people already know from map apps.
    this.cameraController.zoom(event.deltaY, this.groundPointAt(event.clientX, event.clientY));
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.webgl.domElement.removeEventListener('wheel', this.onWheel);
    this.webgl.dispose();
  }
}
