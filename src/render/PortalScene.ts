import * as THREE from 'three';
import { animateMageIdle, createMageFigure, type MageFigureParts } from './MageFigure';

/**
 * Full-bleed character-select style scene: stone courtyard, swirling portal,
 * and two idle mages waiting to enter. Inspired by classic MMO login staging
 * without copying any specific IP art.
 */
export class PortalScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly mages: MageFigureParts[] = [];
  private readonly portalGroup = new THREE.Group();
  private readonly portalRing: THREE.Mesh;
  private readonly portalInner: THREE.Mesh;
  private readonly swirlMats: THREE.MeshBasicMaterial[] = [];
  private readonly sparks: THREE.Points;
  private readonly sparkVel: Float32Array;
  private raf = 0;
  private disposed = false;
  private reducedMotion = false;

  constructor(private readonly host: HTMLElement) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    host.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 120);
    this.camera.position.set(0, 3.2, 9.2);
    this.camera.lookAt(0, 1.6, -1.5);

    this.scene.background = new THREE.Color(0x0a0e14);
    this.scene.fog = new THREE.Fog(0x0a0e14, 14, 38);

    this.buildLights();
    this.buildGround();
    this.buildArch();
    this.portalRing = this.buildPortal();
    this.portalInner = this.portalGroup.children.find(
      (c) => c instanceof THREE.Mesh && c.name === 'portal-inner',
    ) as THREE.Mesh;
    const sparkData = this.buildSparks();
    this.sparks = sparkData.points;
    this.sparkVel = sparkData.velocities;
    this.spawnMages();

    window.addEventListener('resize', this.onResize);
    this.tick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (!this.reducedMotion) {
      this.portalGroup.rotation.z = t * 0.15;
      this.portalRing.rotation.z = -t * 0.35;
      if (this.portalInner.material instanceof THREE.MeshBasicMaterial) {
        this.portalInner.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.12;
      }
      for (let i = 0; i < this.swirlMats.length; i++) {
        this.swirlMats[i].opacity = 0.25 + (Math.sin(t * 1.8 + i) + 1) * 0.15;
      }
      this.updateSparks(dt);
      for (let i = 0; i < this.mages.length; i++) {
        animateMageIdle(this.mages[i], t, i * 1.7);
      }
      this.camera.position.x = Math.sin(t * 0.12) * 0.35;
      this.camera.lookAt(0, 1.55, -1.5);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const w = this.host.clientWidth;
    const h = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private buildLights(): void {
    const ambient = new THREE.AmbientLight(0x6a7a8c, 0.55);
    this.scene.add(ambient);

    const moon = new THREE.DirectionalLight(0xb8c7d9, 0.65);
    moon.position.set(-6, 10, 4);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    this.scene.add(moon);

    const portalLight = new THREE.PointLight(0x3ecfbf, 2.4, 18, 2);
    portalLight.position.set(0, 2.4, -2.2);
    this.scene.add(portalLight);

    const ember = new THREE.PointLight(0xe89b3c, 0.9, 12, 2);
    ember.position.set(2.5, 1.8, 2);
    this.scene.add(ember);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(22, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.45, 48),
      new THREE.MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.8, metalness: 0.2 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Scattered rune stones
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = 4.2 + (i % 3) * 0.35;
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.55 + (i % 3) * 0.15, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x2a3542, flatShading: true, roughness: 0.9 }),
      );
      stone.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r - 0.5);
      stone.rotation.y = a;
      stone.castShadow = true;
      this.scene.add(stone);
    }
  }

  private buildArch(): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x2c3848,
      flatShading: true,
      roughness: 0.88,
      metalness: 0.12,
    });
    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xb87333,
      flatShading: true,
      roughness: 0.45,
      metalness: 0.65,
    });

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.7), stoneMat);
    left.position.set(-2.35, 2.1, -2.4);
    left.castShadow = true;
    this.scene.add(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.7), stoneMat);
    right.position.set(2.35, 2.1, -2.4);
    right.castShadow = true;
    this.scene.add(right);

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.55, 0.75), stoneMat);
    lintel.position.set(0, 4.2, -2.4);
    lintel.castShadow = true;
    this.scene.add(lintel);

    const capL = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 0.85), copperMat);
    capL.position.set(-2.35, 4.55, -2.4);
    this.scene.add(capL);
    const capR = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 0.85), copperMat);
    capR.position.set(2.35, 4.55, -2.4);
    this.scene.add(capR);
  }

  private buildPortal(): THREE.Mesh {
    this.portalGroup.position.set(0, 2.15, -2.35);
    this.scene.add(this.portalGroup);

    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.12, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0xb87333,
        roughness: 0.35,
        metalness: 0.75,
        emissive: 0x3a2410,
        emissiveIntensity: 0.4,
      }),
    );
    outer.name = 'portal-ring';
    this.portalGroup.add(outer);

    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(1.42, 48),
      new THREE.MeshBasicMaterial({
        color: 0x1ce0c8,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    inner.name = 'portal-inner';
    this.portalGroup.add(inner);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 1 ? 0xe89b3c : 0x5eead4,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.swirlMats.push(mat);
      const swirl = new THREE.Mesh(new THREE.RingGeometry(0.45 + i * 0.28, 0.55 + i * 0.28, 40), mat);
      swirl.rotation.z = i * 0.7;
      this.portalGroup.add(swirl);
    }

    return outer;
  }

  private buildSparks(): { points: THREE.Points; velocities: Float32Array } {
    const count = 80;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.resetSpark(positions, velocities, i, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9ef0e4,
        size: 0.06,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    points.position.set(0, 2.15, -2.2);
    this.scene.add(points);
    return { points, velocities };
  }

  private resetSpark(pos: Float32Array, vel: Float32Array, i: number, initial: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const r = initial ? Math.random() * 1.3 : 0.2 + Math.random() * 0.3;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    vel[i * 3] = Math.cos(a) * (0.4 + Math.random() * 0.5);
    vel[i * 3 + 1] = Math.sin(a) * (0.4 + Math.random() * 0.5);
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
  }

  private updateSparks(dt: number): void {
    if (!this.sparkVel) return;
    const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3] += this.sparkVel[i * 3] * dt;
      arr[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      const dist = Math.hypot(arr[i * 3], arr[i * 3 + 1]);
      if (dist > 1.6) this.resetSpark(arr, this.sparkVel, i, false);
    }
    pos.needsUpdate = true;
  }

  private spawnMages(): void {
    const left = createMageFigure(0x3d8bfd, { scale: 1.15 });
    left.root.position.set(-1.55, 0, 1.1);
    left.root.rotation.y = 0.35;
    this.scene.add(left.root);
    this.mages.push(left);

    const right = createMageFigure(0xd64545, { scale: 1.15 });
    right.root.position.set(1.55, 0, 1.1);
    right.root.rotation.y = -0.35;
    this.scene.add(right.root);
    this.mages.push(right);

    const waiting = createMageFigure(0x80b918, { scale: 0.95 });
    waiting.root.position.set(-3.2, 0, 2.4);
    waiting.root.rotation.y = 0.9;
    this.scene.add(waiting.root);
    this.mages.push(waiting);
  }
}
