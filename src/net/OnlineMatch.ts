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
import { SupportRenderer } from '../render/SupportRenderer';
import { SquadHighlightRenderer } from '../render/SquadHighlightRenderer';
import { StructureRenderer } from '../render/StructureRenderer';
import { IdAllocator } from '../ecs/Entity';
import { MapLoader } from '../game/MapLoader';
import { Team, type Arena, type MapData } from '../game/types';
import { World } from '../game/World';
import { EmoteBar } from '../ui/EmoteBar';
import { MatchHUD } from '../ui/MatchHUD';
import { Menus } from '../ui/Menus';
import { SquadPanel } from '../ui/SquadPanel';
import { SnapshotSync } from './SnapshotSync';
import type { SnapshotMsg } from './protocol';

/** Why the player left the online match view — decides where the app navigates back to. */
export type LeaveMatchReason = 'quit' | 'roundEnd';

/**
 * Everything this view needs from whatever is running the match: a match that
 * renders server snapshots and a match simulated in this very tab differ only
 * in where the snapshots come from, so both satisfy this and the view cannot
 * tell them apart. `NetworkClient` satisfies it structurally; see
 * `LocalSession`.
 */
export interface MatchTransport {
  readonly connected: boolean;
  /**
   * @deprecated Nothing in this view calls it since the idle pivot — a hand is
   * played by its owner's program. Kept on the interface, rather than deleted
   * from both implementations, because this is the seam an override mode would
   * come back through, and `CastMsg` is still on the wire behind it.
   */
  sendCast(cardId?: string, position?: { x: number; y: number }): void;
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

/** How far a press must travel before it counts as dragging the view, not clicking. */
const DRAG_THRESHOLD_PX = 5;

/** Swapped in over the arena's default open-hand cursor (src/style.css) while panning the camera. */
const GRAB_CURSOR = `url(${import.meta.env.BASE_URL}cursors/hand-grab.png) 8 8, grabbing`;

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

  /** Wire id of the mage picked out of the squad panel, marked in the arena. */
  private highlightedMageId: string | null = null;

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

  /** Which wire team the player commands; null while spectating. See {@link teamName}. */
  private readonly localTeam: number | null;
  private readonly getTeamName: ((wireTeam: number) => string | null) | null;
  private readonly localPlayerId: string;
  private emoteBar: EmoteBar | null = null;

  constructor(
    container: HTMLElement,
    /**
     * Whatever is running this match. The view no longer reads it: since the
     * idle pivot the flow is one-directional — snapshots arrive through
     * `applySnapshot` and nothing goes back out. It stays on the signature
     * because it is what ties a view to its session for the caller, and
     * because an override mode would send through it again.
     */
    _net: MatchTransport,
    opts: {
      spectating: boolean;
      localPlayerId: string;
      /** Which wire team the player commands; null while spectating. */
      localTeam: number | null;
      mapData: MapData;
      onLeaveMatch: (reason: LeaveMatchReason) => void;
      onTick?: (dt: number) => void;
      /** Draw the match HUD and squad panels. Defaults to true; false gives a bare arena. */
      chrome?: boolean;
      /**
       * Who is commanding a *wire* team (0/1), for the HUD's side boxes. Omitted
       * by callers that have nobody to name — the firing range, and practice
       * against a local bot — and the HUD falls back to "You"/"Opponent".
       */
      getTeamName?: (wireTeam: number) => string | null;
      /**
       * Sends a quick-react to the opponent. Omitted by callers with nobody to
       * send one to (practice, the firing range) — the emote button never
       * appears in that case rather than sending into the void.
       */
      onSendEmote?: (emoteId: string) => void;
    },
  ) {
    this.spectating = opts.spectating;
    this.onTick = opts.onTick ?? null;
    this.localTeam = opts.localTeam;
    this.getTeamName = opts.getTeamName ?? null;
    this.localPlayerId = opts.localPlayerId;

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
      new SupportRenderer(this.renderer.scene, this.assets, this.world, this.events),
      new SquadHighlightRenderer(this.renderer.scene, this.world, () =>
        this.sync.entityIdFor(this.highlightedMageId),
      ),
    ];

    /*
     * The card bar, clock and squad panels are the *match*, not the view. The
     * firing range (`RangeScreen`) has no mana, no hand and no opponent, and
     * its outer lanes sit exactly where the two squad panels float — so it
     * opts out and gets the bare arena.
     */
    if (opts.chrome !== false) {
      this.renderers.push(
        new MatchHUD(container, this.world, {
          getState: () => this.sync.matchState,
          isVisible: () => !this.paused,
          isSpectating: () => this.spectating,
          getMySide: () => this.sync.mySide,
          getSideName: (team) => this.teamName(team),
        }),
        new SquadPanel(container, {
          getSquad: () => this.sync.squad,
          getHighlighted: () => this.highlightedMageId,
          getMySide: () => this.sync.mySide,
          onSelect: (wireId) => this.watchMage(wireId),
          isVisible: () => !this.paused,
          getSideName: (team) => this.teamName(team),
        }),
      );
      if (opts.onSendEmote) {
        this.emoteBar = new EmoteBar(container, opts.onSendEmote);
      }
    }

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

  /** Shows a quick-react bubble over whichever side sent it — including the local player's own. */
  showEmote(playerId: string, emoteId: string): void {
    const side = playerId === this.localPlayerId ? this.sync.mySide : this.sync.mySide === 'left' ? 'right' : 'left';
    this.emoteBar?.showBubble(side, emoteId);
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
    this.emoteBar?.dispose();
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

  /**
   * The nick on a POV team, or null when the match never named it.
   *
   * Teams are mirrored by POV — yours is always `Team.Player` — but names are
   * keyed by wire team, so this undoes the mirror. A spectator has no team of
   * their own, and `SnapshotSync.teamOf` resolves `Team.Player` to wire team 0
   * for them; the `?? 0` here is that same convention, so both sides agree on
   * which box belongs to which roster.
   */
  private teamName(team: Team): string | null {
    if (!this.getTeamName) return null;
    const mine = this.localTeam ?? 0;
    return this.getTeamName(team === Team.Player ? mine : 1 - mine);
  }

  /** Marks a mage in the arena, or clears the mark when it is already the one. */
  watchMage(wireId: string): void {
    this.highlightedMageId = this.highlightedMageId === wireId ? null : wireId;
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.type !== 'keydown') return;

    if ((ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') && !this.roundEnded) {
      this.setPaused(!this.paused);
    }
  }

  /**
   * The left button drags the view around like a map. That is all it does since
   * the idle pivot — a press used to double as a cast, which is why the
   * {@link DRAG_THRESHOLD_PX} test exists at all, and the threshold stays
   * because a drag that starts on the spot should not jitter the camera.
   *
   * The ground-plane raycast that used to run here went with the cast: it
   * existed to turn the cursor into a world point to place a card at, and
   * nothing reads that point now. `dragView` derives its delta analytically
   * from pixels rather than raycasting, so it never needed it.
   */
  private onPointer(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();

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

    if (ev.type === 'pointerup' && ev.button === 0) this.endDrag(ev);
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
      this.renderer.domElement.style.cursor = GRAB_CURSOR;
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
