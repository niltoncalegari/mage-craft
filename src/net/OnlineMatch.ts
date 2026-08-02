import * as THREE from 'three';
import type { NetworkClient } from './NetworkClient';
import type { MageSnapshotDTO, SnapshotMsg } from './protocol';

const TEAM_COLOR = [0x3b82f6, 0xef4444] as const;

/**
 * Minimal render-only online match: applies server snapshots into a Three.js
 * scene and forwards local input when the player is not spectating.
 */
export class OnlineMatch {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly mageMeshes = new Map<string, THREE.Mesh>();
  private readonly projMeshes = new Map<string, THREE.Mesh>();
  private raf = 0;
  private disposed = false;
  private spectating: boolean;
  private localPlayerId: string;
  private keys = new Set<string>();
  private pointerDown = false;
  private aim = { x: 1, y: 0 };
  private releaseQueued = false;
  private overlay: HTMLDivElement;
  private statusEl: HTMLParagraphElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly net: NetworkClient,
    opts: { spectating: boolean; localPlayerId: string },
  ) {
    this.spectating = opts.spectating;
    this.localPlayerId = opts.localPlayerId;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 28, 22);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = new THREE.Color(0x0b1220);
    const hemi = new THREE.HemisphereLight(0xb1c7ff, 0x1a1520, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(8, 16, 6);
    this.scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(40, 20, 0x334155, 0x1e293b);
    this.scene.add(grid);

    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;padding:18px;font-family:Georgia,serif;color:#e2e8f0;';
    this.statusEl = document.createElement('p');
    this.statusEl.style.cssText =
      'margin:0;padding:8px 14px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:6px;font-size:14px;';
    this.overlay.append(this.statusEl);
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.append(this.overlay);
    this.updateStatus();

    this.onResize = this.onResize.bind(this);
    this.onKey = this.onKey.bind(this);
    this.onPointer = this.onPointer.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer);
    this.renderer.domElement.addEventListener('pointerup', this.onPointer);
    this.renderer.domElement.addEventListener('pointermove', this.onPointer);
    this.onResize();

    const tick = (): void => {
      if (this.disposed) return;
      this.pumpInput();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setSpectating(spectating: boolean): void {
    this.spectating = spectating;
    this.updateStatus();
  }

  applySnapshot(snap: SnapshotMsg): void {
    const seenMages = new Set<string>();
    for (const m of snap.mages) {
      seenMages.add(m.id);
      this.upsertMage(m);
    }
    for (const [id, mesh] of this.mageMeshes) {
      if (!seenMages.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.mageMeshes.delete(id);
      }
    }

    const seenProj = new Set<string>();
    for (const p of snap.projectiles) {
      seenProj.add(p.id);
      let mesh = this.projMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.25, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309 }),
        );
        this.projMeshes.set(p.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.position.x, 0.4, p.position.y);
    }
    for (const [id, mesh] of this.projMeshes) {
      if (!seenProj.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.projMeshes.delete(id);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointer);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointer);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointer);
    this.overlay.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private upsertMage(m: MageSnapshotDTO): void {
    let mesh = this.mageMeshes.get(m.id);
    if (!mesh) {
      const color = TEAM_COLOR[m.team === 1 ? 1 : 0];
      mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45, 0.9, 4, 8),
        new THREE.MeshStandardMaterial({ color }),
      );
      this.mageMeshes.set(m.id, mesh);
      this.scene.add(mesh);
    }
    mesh.position.set(m.position.x, 0.9, m.position.y);
    mesh.visible = m.health > 0 || m.lives > 0;
    if (m.id === this.localPlayerId || (!this.spectating && m.id === this.net.id)) {
      this.camera.position.set(m.position.x, 28, m.position.y + 22);
      this.camera.lookAt(m.position.x, 0, m.position.y);
    }
  }

  private updateStatus(): void {
    this.statusEl.textContent = this.spectating
      ? 'Spectating — you join next round (claim a bot in the lobby overlay)'
      : 'Online duel — WASD move · hold click to charge · release to throw';
  }

  private pumpInput(): void {
    if (this.spectating || !this.net.connected) return;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    const release = this.releaseQueued;
    this.releaseQueued = false;
    try {
      this.net.sendInput({
        move: { x, y },
        aim: this.aim,
        charging: this.pointerDown,
        release,
      });
    } catch {
      // disconnected mid-frame
    }
  }

  private onResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.type === 'keydown') this.keys.add(ev.code);
    else this.keys.delete(ev.code);
  }

  private onPointer(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    // Approximate aim on XZ plane from NDC.
    this.aim = { x: nx, y: -ny };
    const len = Math.hypot(this.aim.x, this.aim.y) || 1;
    this.aim.x /= len;
    this.aim.y /= len;
    if (ev.type === 'pointerdown') {
      this.pointerDown = true;
      this.renderer.domElement.setPointerCapture(ev.pointerId);
    } else if (ev.type === 'pointerup') {
      if (this.pointerDown) this.releaseQueued = true;
      this.pointerDown = false;
    }
  }
}
