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
import { SquadHighlightRenderer } from '../render/SquadHighlightRenderer';
import { StructureRenderer } from '../render/StructureRenderer';
import { IdAllocator } from '../ecs/Entity';
import { MapLoader } from '../game/MapLoader';
import { Team, type Arena, type MapData } from '../game/types';
import { World } from '../game/World';
import { MatchHUD } from '../ui/MatchHUD';
import { Menus } from '../ui/Menus';
import { SquadPanel } from '../ui/SquadPanel';
import { SnapshotSync } from './SnapshotSync';
import type { SnapshotMsg } from './protocol';

/** Why the player left the online match view — decides where the app navigates back to. */
export type LeaveMatchReason = 'quit' | 'roundEnd';

/**
 * Everything this view needs from whatever is running the match. It is two
 * members wide on purpose: a match that renders server snapshots and a match
 * simulated in this very tab differ only in where the snapshots come from and
 * where a cast goes, so both satisfy this and the view cannot tell them apart.
 * `NetworkClient` satisfies it structurally; see `LocalSession`.
 */
export interface MatchTransport {
  readonly connected: boolean;
  sendCast(cardId: string, position: { x: number; y: number }): void;
}

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

/** Keyboard shortcuts for the four hand slots, in slot order. */
const HAND_KEYS = ['1', '2', '3', '4'];

/** How far a press must travel before it counts as dragging the view, not clicking. */
const DRAG_THRESHOLD_PX = 5;

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
 * HUD/Menus/AudioManager/etc., see src/main.ts's bootOfflineMatch), instead of a
 * bespoke scene. There is no local simulation — {@link SnapshotSync} is the only
 * "system," fed by the server instead of local physics, and it emits the same
 * {@link GameEvents} the offline systems do (inferred from snapshot deltas) so
 * audio/particles/menus work unmodified.
 *
 * No minimap here, unlike practice mode: it drew the same board the camera
 * already showed. Its corner went to the squad panels, which say the thing the
 * arena cannot — who is hurt, who is buffed, and who is scoring.
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

  /** World point under the cursor — where a selected card would be summoned. */
  private groundPoint = { x: 0, y: 0 };
  /** Set by the card-hand UI; the next click on the arena spends it. */
  private selectedCardId: string | null = null;
  /** Wire id of the mage picked out of the squad panel, marked in the arena. */
  private highlightedMageId: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();

  /** Screen position the current left-button press started at, or null when up. */
  private dragFrom: { x: number; y: number } | null = null;
  /** Whether that press has travelled far enough to be a drag rather than a click. */
  private dragging = false;

  /**
   * Pumped once per frame before the view syncs, so a locally simulated match
   * advances on the same clock that draws it. Null for a server match, where
   * the simulation runs elsewhere.
   */
  private readonly onTick: ((dt: number) => void) | null;

  constructor(
    container: HTMLElement,
    private readonly net: MatchTransport,
    opts: {
      spectating: boolean;
      localPlayerId: string;
      /** Which wire team the player commands; null while spectating. */
      localTeam: number | null;
      mapData: MapData;
      onLeaveMatch: (reason: LeaveMatchReason) => void;
      onTick?: (dt: number) => void;
    },
  ) {
    this.spectating = opts.spectating;
    this.onTick = opts.onTick ?? null;

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
      new SquadHighlightRenderer(this.renderer.scene, this.world, () =>
        this.sync.entityIdFor(this.highlightedMageId),
      ),
      new MatchHUD(container, this.world, {
        getState: () => this.sync.matchState,
        getSelectedCard: () => this.selectedCardId,
        onSelectCard: (cardId) => this.selectCard(cardId),
        isVisible: () => !this.paused,
        isSpectating: () => this.spectating,
        getMySide: () => this.sync.mySide,
      }),
      new SquadPanel(container, {
        getSquad: () => this.sync.squad,
        getHighlighted: () => this.highlightedMageId,
        getMySide: () => this.sync.mySide,
        onSelect: (wireId) => this.watchMage(wireId),
        isVisible: () => !this.paused,
        isCardArmed: () => this.selectedCardId !== null,
      }),
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
      // A local match steps here, before the view reads it — one clock for the
      // simulation and the render, so they cannot drift apart.
      if (!this.paused) this.onTick?.(dt);
      this.sync.tick(dt);
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

  /**
   * The overlay only speaks for spectators now: a player's instructions live in
   * the card bar, which explains itself as the hand changes.
   */
  private updateStatus(): void {
    this.statusEl.hidden = !this.spectating;
    this.statusEl.textContent = this.spectating
      ? 'Spectating — you play the next match'
      : '';
  }

  /** Arms a card; the next click on the arena summons it there. */
  selectCard(cardId: string | null): void {
    this.selectedCardId = cardId;
  }

  /** Marks a mage in the arena, or clears the mark when it is already the one. */
  watchMage(wireId: string): void {
    this.highlightedMageId = this.highlightedMageId === wireId ? null : wireId;
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
    if (ev.type !== 'keydown') return;

    // 1–4 arm a hand slot, mirroring the card bar's own labels.
    const slot = HAND_KEYS.indexOf(ev.key);
    if (slot !== -1) {
      const cardId = this.sync.matchState.hand[slot];
      if (cardId) this.selectCard(this.selectedCardId === cardId ? null : cardId);
      return;
    }

    if (ev.key === 'Escape' && this.selectedCardId) {
      // Escape disarms first; only an unarmed Escape opens the pause menu, so a
      // mis-picked card never costs you the match view.
      this.selectCard(null);
      return;
    }

    if ((ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') && !this.roundEnded) {
      this.setPaused(!this.paused);
    }
  }

  /**
   * Ground-plane raycast (same technique as engine/InputManager) so the cursor
   * maps to a world point under the tilted orthographic camera.
   *
   * This used to feed the aim of a charged throw. It now feeds deployment: the
   * point under the cursor is where a selected card will be summoned.
   *
   * The left button does double duty: held and moved it drags the view around
   * like a map, pressed and released on the spot it casts. A press only becomes
   * a drag past {@link DRAG_THRESHOLD_PX}, so the casting gesture is unchanged.
   */
  private onPointer(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.renderer.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
    if (point) this.groundPoint = { x: point.x, y: point.z };

    // Secondary button disarms instead of summoning, so a card can be taken back.
    if (ev.type === 'pointerdown' && ev.button !== 0) {
      this.selectCard(null);
      return;
    }

    if (ev.type === 'pointerdown' && ev.button === 0) {
      this.dragFrom = { x: ev.clientX, y: ev.clientY };
      this.dragging = false;
      this.renderer.domElement.setPointerCapture?.(ev.pointerId);
      return;
    }

    if (ev.type === 'pointermove') {
      this.dragView(ev, rect);
      return;
    }

    if (ev.type === 'pointerup' && ev.button === 0) {
      const wasDrag = this.dragging;
      this.endDrag(ev);
      // A drag is a camera move, never a cast — otherwise letting go after
      // looking around would fire the armed card wherever you stopped.
      if (!wasDrag && this.selectedCardId) {
        this.castCard(this.selectedCardId, this.groundPoint);
        this.selectCard(null);
      }
    }
  }

  /**
   * Pulls the ground under the cursor, one world unit per world unit.
   *
   * The delta is converted analytically from pixels rather than by raycasting
   * again: a second raycast would run against the camera this very move is
   * about to shift, so the correction would chase itself and the view would
   * shake. `getView()` already reports the visible ground rectangle with the
   * camera's tilt foreshortening applied, which is exactly the scale needed.
   */
  private dragView(ev: PointerEvent, rect: DOMRect): void {
    const from = this.dragFrom;
    if (!from) return;

    if (!this.dragging) {
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD_PX) return;
      this.dragging = true;
      this.renderer.domElement.style.cursor = 'grabbing';
    }

    const view = this.renderer.cameraController.getView();
    const dx = ev.clientX - from.x;
    const dy = ev.clientY - from.y;
    from.x = ev.clientX;
    from.y = ev.clientY;

    // Negated: dragging the ground right means looking further left.
    this.renderer.cameraController.panBy(
      -(dx / rect.width) * view.halfX * 2,
      -(dy / rect.height) * view.halfY * 2,
    );
  }

  private endDrag(ev: PointerEvent): void {
    this.dragFrom = null;
    this.dragging = false;
    this.renderer.domElement.style.cursor = '';
    this.renderer.domElement.releasePointerCapture?.(ev.pointerId);
  }
}
