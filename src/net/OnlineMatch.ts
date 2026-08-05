import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import type { GameRenderer } from '../core/Game';
import { AssetManager } from '../engine/AssetManager';
import { AudioManager } from '../engine/AudioManager';
import { Renderer } from '../engine/Renderer';
import { Settings } from '../engine/Settings';
import { AimIndicatorRenderer } from '../render/AimIndicatorRenderer';
import { ArenaRenderer } from '../render/ArenaRenderer';
import { NavIndicatorRenderer } from '../render/NavIndicatorRenderer';
import { ParticleRenderer } from '../render/ParticleRenderer';
import { PickupRenderer } from '../render/PickupRenderer';
import { PlayerRenderer } from '../render/PlayerRenderer';
import { PuddleRenderer } from '../render/PuddleRenderer';
import { IdAllocator } from '../ecs/Entity';
import { MapLoader } from '../game/MapLoader';
import { Team, type Arena, type MapData, type Player } from '../game/types';
import { World } from '../game/World';
import { StructureRenderer } from '../render/StructureRenderer';
import { MatchHUD } from '../ui/MatchHUD';
import { Menus } from '../ui/Menus';
import { Minimap } from '../ui/Minimap';
import type { NetworkClient } from './NetworkClient';
import { SnapshotSync } from './SnapshotSync';
import type { SnapshotMsg } from './protocol';

/** Why the player left the online match view — decides where the app navigates back to. */
export type LeaveMatchReason = 'quit' | 'roundEnd';

/**
 * The map online matches are played on. The server loads this exact file too
 * (see `sim/defaultMap.ts`), so there is no second copy that could disagree
 * about arena size, obstacles or spawns — which is why this has to be the siege
 * map: `arena1.json` predates structures and is 44×30 against siege1's own
 * dimensions, so loading it here would render a different arena than the one
 * being played: a 40×30 arena with no structures instead of siege1's 44×30, so
 * even the deploy zones would sit in the wrong place.
 */
const ONLINE_MAP = 'siege1.json';

let mapDataPromise: Promise<MapData> | null = null;

/**
 * Fetches (once per page load) the map data online matches use. Cached because
 * every match and rematch rebuilds its arena from it.
 */
export function loadOnlineMapData(): Promise<MapData> {
  mapDataPromise ??= fetch(`${import.meta.env.BASE_URL}maps/${ONLINE_MAP}`).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load online map "${ONLINE_MAP}": ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as MapData;
  });
  return mapDataPromise;
}

/**
 * Online match view: renders server snapshots through the same rendering
 * pipeline solo/practice mode uses (World + ArenaRenderer/PlayerRenderer/
 * HUD/Minimap/Menus/AudioManager/etc., see src/main.ts's bootOfflineMatch),
 * instead of a bespoke scene. There is no local simulation — {@link
 * SnapshotSync} is the only "system," fed by the server instead of local
 * physics, and it emits the same {@link GameEvents} the offline systems do
 * (inferred from snapshot deltas) so audio/particles/menus work unmodified.
 */
export class OnlineMatch {
  private readonly assets = new AssetManager();
  private readonly arena: Arena;
  private readonly world: World;
  private readonly renderer: Renderer;
  private readonly events = new EventBus();
  private readonly sync: SnapshotSync;
  private readonly arenaRenderer: ArenaRenderer;
  private readonly renderers: GameRenderer[];
  private readonly settings = new Settings();
  private readonly audio: AudioManager;
  private readonly menus: Menus;

  private raf = 0;
  private disposed = false;
  private spectating: boolean;
  private paused = false;
  private roundEnded = false;
  private lastFrameTime = performance.now();

  private readonly overlay: HTMLDivElement;
  private readonly statusEl: HTMLParagraphElement;

  private readonly keys = new Set<string>();
  /** World point under the cursor — where a selected card would be summoned. */
  private groundPoint = { x: 0, y: 0 };
  /** Set by the card-hand UI; the next click on the arena spends it. */
  private selectedCardId: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private readonly net: NetworkClient,
    opts: {
      spectating: boolean;
      localPlayerId: string;
      /** Which wire team the player commands; null while spectating. */
      localTeam: number | null;
      mapData: MapData;
      onLeaveMatch: (reason: LeaveMatchReason) => void;
    },
  ) {
    this.spectating = opts.spectating;

    // Same construction order as Game.init: obstacles share the world's id
    // space so nothing collides with mage/projectile ids.
    const ids = new IdAllocator();
    this.arena = new MapLoader(ids).build(opts.mapData);
    this.world = new World(this.arena, 0, ids);
    this.sync = new SnapshotSync(this.world, opts.localPlayerId, this.events, opts.localTeam);

    this.renderer = new Renderer(container);
    // No follow target: a commander watches the whole board, and since the pivot
    // there is no local mage to follow anyway.
    this.renderer.frameArena(this.arena);

    this.arenaRenderer = new ArenaRenderer(this.renderer.scene, this.assets, this.arena);
    this.renderers = [
      new StructureRenderer(this.renderer.scene, this.assets, this.world),
      new PlayerRenderer(this.renderer.scene, this.assets, this.world),
      new NavIndicatorRenderer(this.renderer.scene, this.assets, this.world),
      new AimIndicatorRenderer(this.renderer.scene, this.assets, this.world),
      new ParticleRenderer(this.renderer.scene, this.assets, this.world, this.events),
      new PickupRenderer(this.renderer.scene, this.assets, this.world, this.events),
      new PuddleRenderer(this.renderer.scene, this.assets, this.world),
      new MatchHUD(container, this.world, {
        getState: () => this.sync.matchState,
        getSelectedCard: () => this.selectedCardId,
        onSelectCard: (cardId) => this.selectCard(cardId),
        isVisible: () => !this.paused,
        isSpectating: () => this.spectating,
      }),
      new Minimap(container, this.world, () => this.renderer.cameraController.getView(), () => !this.paused),
    ];

    this.audio = new AudioManager(this.events);
    this.audio.setMuted(this.settings.get('muted'));
    const resumeAudioOnce = (): void => {
      this.audio.resume();
      window.removeEventListener('pointerdown', resumeAudioOnce);
    };
    window.addEventListener('pointerdown', resumeAudioOnce);
    this.events.emit('RoundStarted', { seed: 0 });

    this.menus = new Menus(
      container,
      this.events,
      {
        start: () => {},
        togglePause: () => this.setPaused(!this.paused),
        restart: () => opts.onLeaveMatch(this.roundEnded ? 'roundEnd' : 'quit'),
        restartLabel: 'Leave Match',
        playAgainLabel: 'Back to Lobby',
      },
      false,
    );

    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;padding:18px;font-family:Georgia,serif;color:#e2e8f0;';
    this.statusEl = document.createElement('p');
    this.statusEl.style.cssText =
      'margin:0;padding:8px 14px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:6px;font-size:14px;';
    this.overlay.append(this.statusEl);
    container.append(this.overlay);
    this.updateStatus();

    this.onKey = this.onKey.bind(this);
    this.onPointer = this.onPointer.bind(this);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer);
    this.renderer.domElement.addEventListener('pointerup', this.onPointer);
    this.renderer.domElement.addEventListener('pointermove', this.onPointer);

    const tick = (now: number): void => {
      if (this.disposed) return;
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;
      this.sync.tick(dt);
      this.pumpInput();
      for (const r of this.renderers) r.sync(0);
      this.renderer.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setSpectating(spectating: boolean): void {
    this.spectating = spectating;
    this.updateStatus();
  }

  applySnapshot(snap: SnapshotMsg): void {
    this.sync.applySnapshot(snap);
  }

  /** Shows the victory/defeat screen for the round that just ended (server-authoritative `winnerTeam`). */
  showRoundResult(winnerTeam: number): void {
    this.roundEnded = true;
    const won = this.sync.isMyTeam(winnerTeam);
    this.events.emit('RoundEnded', { winner: won ? Team.Player : Team.Enemy });
    this.menus.showResult({ won, score: 0, rank: -1, timeSeconds: this.world.time, livesSpent: 0, difficulty: '', showScore: false });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointer);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointer);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointer);
    this.overlay.remove();
    this.menus.dispose();
    this.audio.dispose();
    for (const r of this.renderers) r.dispose?.();
    this.arenaRenderer.dispose();
    this.renderer.dispose();
    this.assets.dispose();
    this.events.clear();
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.events.emit('GamePaused', { paused });
  }

  private localHero(): Player | undefined {
    const id = this.sync.localEntityId;
    return id !== null ? this.world.getPlayer(id) : undefined;
  }

  private updateStatus(): void {
    this.statusEl.textContent = this.spectating
      ? 'Spectating — you join next round (claim a bot in the lobby overlay)'
      : 'Online duel — WASD move · hold click to charge · release to throw';
  }

  /**
   * Intentionally inert since the product pivot.
   *
   * This used to sample WASD + mouse and push an `input` frame every tick. In
   * the summon model nobody steers a mage, so there is nothing per-frame to
   * send: the player's only action is `net.sendCast(cardId, position)`, driven
   * by the card-hand UI. That UI is the next block of work (GDD §13, step 6);
   * until it lands this view still renders live snapshots correctly, it just
   * has no way to spend mana.
   */
  private pumpInput(): void {
    // No per-frame input in the summon model — see the note above.
  }

  /** Arms a card; the next click on the arena summons it there. */
  selectCard(cardId: string | null): void {
    this.selectedCardId = cardId;
  }

  /** Spends mana to place a card at a world point (GDD §5). */
  castCard(cardId: string, position: { x: number; y: number }): void {
    if (this.spectating || !this.net.connected) return;
    try {
      this.net.sendCast(cardId, position);
    } catch {
      // disconnected mid-frame
    }
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.type === 'keydown' && (ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') && !this.roundEnded) {
      this.setPaused(!this.paused);
      return;
    }
    if (ev.type === 'keydown') this.keys.add(ev.code);
    else this.keys.delete(ev.code);
  }

  /**
   * Ground-plane raycast (same technique as engine/InputManager) so the cursor
   * maps to a world point under the tilted orthographic camera.
   *
   * This used to feed the aim of a charged throw. It now feeds deployment: the
   * point under the cursor is where a selected card will be summoned.
   */
  private onPointer(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.renderer.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
    if (point) this.groundPoint = { x: point.x, y: point.z };

    if (ev.type === 'pointerup' && this.selectedCardId) {
      this.castCard(this.selectedCardId, this.groundPoint);
      this.selectedCardId = null;
    }
  }
}
