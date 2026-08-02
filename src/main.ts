import './style.css';
import * as THREE from 'three';
import { mountApp } from './app/App';
import { getSession } from './app/auth';
import { Game } from './core/Game';
import { AudioManager } from './engine/AudioManager';
import { Settings, sanitizeName, PLAYER_NAME_MAX, type AiDifficulty, type BuffTarget } from './engine/Settings';
import { SNOWBALL } from './game/config';
import type { ElementId } from './game/elements';
import { computeScore } from './game/score';
import { Team } from './game/types';
import { ApiClient } from './net/ApiClient';
import { MatchReporter } from './net/MatchReporter';
import { ArenaRenderer } from './render/ArenaRenderer';
import { PlayerRenderer } from './render/PlayerRenderer';
import { NavIndicatorRenderer } from './render/NavIndicatorRenderer';
import { AimIndicatorRenderer } from './render/AimIndicatorRenderer';
import { PickupRenderer } from './render/PickupRenderer';
import { ParticleRenderer } from './render/ParticleRenderer';
import { SelectionSystem } from './systems/SelectionSystem';
import { AISystem } from './systems/AISystem';
import { MovementSystem } from './systems/MovementSystem';
import { PickupSystem } from './systems/PickupSystem';
import { ThrowSystem } from './systems/ThrowSystem';
import { ProjectileSystem } from './systems/ProjectileSystem';
import { CollisionSystem } from './systems/CollisionSystem';
import { DamageSystem } from './systems/DamageSystem';
import { RespawnSystem } from './systems/RespawnSystem';
import { AutoSelectSystem } from './systems/AutoSelectSystem';
import { RoundSystem } from './systems/RoundSystem';
import { AnimationSystem } from './systems/AnimationSystem';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { Menus } from './ui/Menus';
import { DebugOverlay } from './ui/DebugOverlay';

const rootEl = document.getElementById('app');
if (!rootEl) {
  throw new Error('Missing #app container');
}
const container: HTMLElement = rootEl;

const MAPS = [
  { label: 'Ruined Courtyard', value: 'arena1.json' },
  { label: 'Mirror Pool', value: 'arena2.json' },
  { label: 'Village Ruins', value: 'arena3.json' },
  { label: 'Totem Grove', value: 'arena4.json' },
  { label: 'Training Yard', value: 'arena5.json' },
] as const;

const DIFFICULTIES = [
  { label: 'Easy', value: 'easy' },
  { label: 'Normal', value: 'normal' },
  { label: 'Hard', value: 'hard' },
] as const;

const OPPONENT_OPTIONS = [1, 2, 3].map((n) => ({ label: String(n), value: String(n) }));
const LIVES_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n) }));
const PLAYER_LIVES_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n) }));
const BUFF_OPTIONS = [
  { label: 'Off', value: 'off' },
  { label: 'You only', value: 'player' },
  { label: 'Both teams', value: 'both' },
] as const;

const settings = new Settings();

// Sync shell session name into settings when present.
const session = getSession();
if (session?.name) settings.set('playerName', session.name);

let appHandle: { dispose(): void } | null = null;
let practiceBooting = false;

const startPractice = (): void => {
  if (practiceBooting) return;
  practiceBooting = true;
  appHandle?.dispose();
  appHandle = null;
  void bootOfflineMatch();
};

appHandle = mountApp(container, {
  actions: { startPractice },
  stats: { wins: settings.get('wins'), losses: settings.get('losses') },
  selectedElement: settings.get('selectedElement'),
  onSelectElement: (element: ElementId) => {
    settings.set('selectedElement', element);
  },
});

async function bootOfflineMatch(): Promise<void> {
  const knownMap = MAPS.some((m) => m.value === settings.get('selectedMap'));
  const selectedMap = knownMap ? settings.get('selectedMap') : MAPS[0].value;
  const mapUrl = `${import.meta.env.BASE_URL}maps/${selectedMap}`;

  const game = new Game(container);
  await game.init(mapUrl, undefined, {
    maxEnemies: settings.get('enemyCount'),
    enemyMaxHealth: settings.get('enemyLives') * SNOWBALL.damage,
    maxPlayers: 1,
    playerLives: settings.get('playerLives'),
  });

  // Hold at the match options menu until Start Duel.
  game.setRunning(false);

  const matchReporter = new MatchReporter(
    game.events,
    (id) => game.world.players.find((p) => p.id === id),
    settings.get('selectedElement'),
  );

  let playing = false;
  let showFps = settings.get('showFps');
  game.events.on('GamePaused', ({ paused }) => {
    playing = !paused;
  });

  const audio = new AudioManager(game.events);
  audio.setMuted(settings.get('muted'));
  const resumeAudioOnce = (): void => {
    audio.resume();
    window.removeEventListener('pointerdown', resumeAudioOnce);
  };
  window.addEventListener('pointerdown', resumeAudioOnce);

  const setPaused = (paused: boolean): void => {
    if (game.world.paused === paused) return;
    game.world.paused = paused;
    game.events.emit('GamePaused', { paused });
  };

  const menus = new Menus(container, game.events, {
    start: () => {
      game.setRunning(true);
      playing = true;
      audio.resume();
    },
    togglePause: () => setPaused(!game.world.paused),
    restart: () => window.location.reload(),
    maps: MAPS.map((m) => ({ label: m.label, value: m.value })),
    selectedMap,
    onSelectMap: (value) => {
      settings.set('selectedMap', value);
      window.location.reload();
    },
    muted: settings.get('muted'),
    onToggleMute: (muted) => {
      settings.set('muted', muted);
      audio.setMuted(muted);
    },
    difficulties: DIFFICULTIES.map((d) => ({ label: d.label, value: d.value })),
    selectedDifficulty: settings.get('difficulty'),
    onSelectDifficulty: (value) => {
      settings.set('difficulty', value as AiDifficulty);
      window.location.reload();
    },
    opponents: OPPONENT_OPTIONS,
    selectedOpponents: String(settings.get('enemyCount')),
    onSelectOpponents: (value) => {
      settings.set('enemyCount', Number(value));
      window.location.reload();
    },
    lives: LIVES_OPTIONS,
    selectedLives: String(settings.get('enemyLives')),
    onSelectLives: (value) => {
      settings.set('enemyLives', Number(value));
      window.location.reload();
    },
    playerLives: PLAYER_LIVES_OPTIONS,
    selectedPlayerLives: String(settings.get('playerLives')),
    onSelectPlayerLives: (value) => {
      settings.set('playerLives', Number(value));
      window.location.reload();
    },
    buffOptions: BUFF_OPTIONS.map((b) => ({ label: b.label, value: b.value })),
    selectedBuffs: settings.get('buffs'),
    onSelectBuffs: (value) => {
      settings.set('buffs', value as BuffTarget);
      window.location.reload();
    },
    scores: { wins: settings.get('wins'), losses: settings.get('losses') },
    leaderboard: settings.get('leaderboard'),
    onClearLeaderboard: () => {
      settings.clearLeaderboard();
      window.location.reload();
    },
    playerName: settings.get('playerName'),
    playerNameMax: PLAYER_NAME_MAX,
    onSetName: (name) => {
      settings.set('playerName', name);
    },
    selectedElement: settings.get('selectedElement'),
    onSelectElement: (element: ElementId) => {
      settings.set('selectedElement', element);
    },
    showFps: settings.get('showFps'),
    onToggleFps: (show) => {
      showFps = show;
      settings.set('showFps', show);
    },
  });

  game.events.on('RoundEnded', ({ winner }) => {
    const won = winner === Team.Player;
    playing = false;
    settings.recordResult(won);

    const timeSeconds = game.world.time;
    const livesSpent = Math.max(0, game.world.playerLivesMax - game.world.playerLives);
    const difficulty = settings.get('difficulty');
    let score = 0;
    let rank = -1;
    if (won) {
      score = computeScore({ difficulty, opponents: settings.get('enemyCount'), timeSeconds, livesSpent });
      rank = settings.addScore({
        name: sanitizeName(settings.get('playerName')),
        score,
        difficulty,
        timeSeconds,
        livesSpent,
        map: selectedMap,
        date: Date.now(),
      });
    }
    menus.showResult({ won, score, rank, timeSeconds, livesSpent, difficulty });

    const token = getSession()?.token;
    if (token) {
      const report = matchReporter.buildReport({ won, score, difficulty, timeSeconds, livesSpent, map: selectedMap });
      ApiClient.reportMatch(token, report).catch((err) => {
        console.warn('mage-craft: failed to report match to the accounts API', err);
      });
    }
    matchReporter.dispose();
  });

  const autoSelect = new AutoSelectSystem(game.world);
  const throwSystem = new ThrowSystem(game.world, game.events);
  const ai = new AISystem(game.world, game.events, throwSystem, settings.get('difficulty'));
  const movement = new MovementSystem(game.world);
  const pickups = new PickupSystem(game.world, game.events, settings.get('buffs'));
  const projectile = new ProjectileSystem(game.world, game.events);
  const collision = new CollisionSystem(game.world, game.events);
  const damage = new DamageSystem(game.world, game.events);
  const respawn = new RespawnSystem(game.world, game.events);
  const round = new RoundSystem(game.world, game.events);
  const animation = new AnimationSystem(game.world, game.events);
  game.registerSystem(autoSelect);
  game.registerSystem(ai);
  game.registerSystem(movement);
  game.registerSystem(pickups);
  game.registerSystem(throwSystem);
  game.registerSystem(projectile);
  game.registerSystem(collision);
  game.registerSystem(damage);
  game.registerSystem(respawn);
  game.registerSystem(round);
  game.registerSystem(animation);

  const selection = new SelectionSystem(game.world, game.events);
  game.onCommand((command) => {
    selection.handleCommand(command);
    movement.handleCommand(command);
    throwSystem.handleCommand(command);
  });

  const arenaRenderer = new ArenaRenderer(game.renderer.scene, game.assets, game.world.arena);
  const playerRenderer = new PlayerRenderer(game.renderer.scene, game.assets, game.world);
  const navIndicators = new NavIndicatorRenderer(game.renderer.scene, game.assets, game.world);
  const aimIndicators = new AimIndicatorRenderer(game.renderer.scene, game.assets, game.world);
  const pickupRenderer = new PickupRenderer(game.renderer.scene, game.assets, game.world, game.events);
  const particles = new ParticleRenderer(game.renderer.scene, game.assets, game.world, game.events);
  const hud = new HUD(container, game.world, () => game.loopStats, () => playing, () => showFps);
  const minimap = new Minimap(container, game.world, () => game.renderer.cameraController.getView(), () => playing);
  const debug = new DebugOverlay(game.renderer.scene, game.world, container, () => game.loopStats);
  game.addRenderer(playerRenderer);
  game.addRenderer(navIndicators);
  game.addRenderer(aimIndicators);
  game.addRenderer(pickupRenderer);
  game.addRenderer(particles);
  game.addRenderer(hud);
  game.addRenderer(minimap);
  game.addRenderer(debug);
  game.addRenderer({ sync: () => {}, dispose: () => arenaRenderer.dispose() });

  game.renderer.setFollowTarget(() => {
    const hero = game.world.players.find((p) => p.team === Team.Player && p.alive);
    return hero ? { x: hero.position.x, y: hero.position.y } : null;
  });

  (window as unknown as { game: Game; THREE: typeof THREE }).game = game;
  (window as unknown as { game: Game; THREE: typeof THREE }).THREE = THREE;
}
