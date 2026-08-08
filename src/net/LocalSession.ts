/**
 * A whole siege, simulated in this tab.
 *
 * Practice used to be a different game: `bootOfflineMatch` ran the pre-v1.1
 * SnowCraft loop with a controllable hero and lives, teaching mechanics the
 * siege no longer has. This runs the real `sim/` instead — the same `World`,
 * the same `Brain` driving every mage, the same `Commander` playing the
 * opponent's hand — and emits the same snapshot messages the server sends, so
 * `OnlineMatch` renders it without knowing the difference.
 *
 * Because `sim/defaultMap.ts` imports the arena directly, the map here is the
 * exact one the server plays on, with no fetch and nothing that could drift.
 */

import { Brain, type Difficulty } from '../../sim/bot/Brain';
import { Commander } from '../../sim/bot/Commander';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { Deck, defaultDeck } from '../../sim/Deck';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { summarize, type MatchSummary } from '../../sim/matchStats';
import { Rng } from '../../sim/rng';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, toSnapshotMsg } from '../../sim/snapshot';
import type { CardId } from '../../sim/spells';
import { Vec2 } from '../../sim/Vec2';
import { World } from '../../sim/World';
import type { SnapshotMsg } from './protocol';

/** The side the player commands. The AI always takes the other one. */
const PLAYER_TEAM: Team = TEAM_A;
const BOT_TEAM: Team = TEAM_B;

/**
 * Matches the server loop's guard: a tab that was backgrounded for a minute
 * must not try to catch up a minute of simulation in one frame.
 */
const MAX_CATCH_UP_TICKS = 5;

export interface LocalSessionOptions {
  squad: RosterId[];
  deck: CardId[];
  difficulty: Difficulty;
  /** Fixed seed makes a practice match reproducible; omit for a fresh one. */
  seed?: number;
  onSnapshot(msg: SnapshotMsg): void;
  onMatchResult(summary: MatchSummary): void;
}

export class LocalSession {
  private world: World | null;
  private readonly brain: Brain;
  private readonly units = new Map<string, Difficulty>();
  private readonly decks = new Map<Team, Deck>();
  private readonly commander: Commander;
  private readonly opts: LocalSessionOptions;

  private tickCount = 0;
  private accumulator = 0;
  private ended = false;

  constructor(opts: LocalSessionOptions) {
    this.opts = opts;
    const seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
    const rng = new Rng(seed);

    const world = new World();
    world.initSquad(PLAYER_TEAM, opts.squad);
    world.initSquad(BOT_TEAM, defaultSquad());
    this.world = world;

    this.brain = new Brain(rng);
    for (const id of world.mages.keys()) this.units.set(id, opts.difficulty);

    this.decks.set(PLAYER_TEAM, new Deck(opts.deck, rng));
    this.decks.set(BOT_TEAM, new Deck(defaultDeck(), rng));
    this.commander = new Commander(rng, opts.difficulty);
  }

  /** Satisfies `MatchTransport` — a local match is never disconnected. */
  get connected(): boolean {
    return !this.ended;
  }

  /** The player's cast, applied straight to the world instead of sent anywhere. */
  sendCast(cardId: string, position: { x: number; y: number }): void {
    const world = this.world;
    if (!world || this.ended) return;

    const deck = this.decks.get(PLAYER_TEAM);
    if (!deck?.holds(cardId)) return;

    if (!world.castSpell(PLAYER_TEAM, cardId, new Vec2(position.x, position.y)).ok) return;
    deck.play(cardId);
  }

  /**
   * Advances the match by real elapsed time, in fixed steps. Driven from the
   * render loop that draws it, so simulation and view share one clock.
   */
  tick(dtSeconds: number): void {
    if (!this.world || this.ended) return;

    this.accumulator += dtSeconds;
    let budget = MAX_CATCH_UP_TICKS;
    while (this.accumulator >= SIM_DT && budget-- > 0) {
      this.accumulator -= SIM_DT;
      this.step();
      if (this.ended) return;
    }
    // Drop whatever could not be consumed rather than banking it forever.
    if (this.accumulator > SIM_DT * MAX_CATCH_UP_TICKS) this.accumulator = 0;
  }

  private step(): void {
    const world = this.world;
    if (!world) return;

    this.stepCommander(world);
    this.brain.step(world, this.units, SIM_DT);
    world.step(SIM_DT);
    this.tickCount++;

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.emitSnapshot(world);

    if (world.roundOver) {
      // Read the world before letting go of it — this is the only moment the
      // match's own account of itself exists.
      const summary = summarize(world);
      this.ended = true;
      this.world = null;
      this.opts.onMatchResult(summary);
    }
  }

  private stepCommander(world: World): void {
    const deck = this.decks.get(BOT_TEAM);
    if (!deck) return;

    const intent = this.commander.step(world, BOT_TEAM, deck, SIM_DT);
    if (!intent) return;
    if (!world.castSpell(BOT_TEAM, intent.cardId, intent.position).ok) return;
    deck.play(intent.cardId);
  }

  private emitSnapshot(world: World): void {
    const deck = this.decks.get(PLAYER_TEAM);
    const snap = buildSnapshot(world, this.tickCount);
    this.opts.onSnapshot(
      toSnapshotMsg(snap, {
        mana: snap.mana[PLAYER_TEAM] ?? 0,
        hand: deck?.hand() ?? [],
        next: deck?.next() ?? null,
      }),
    );
  }

  dispose(): void {
    this.ended = true;
    this.world = null;
  }
}

/** The wire team a practice player commands, for the match view's POV. */
export const LOCAL_PLAYER_TEAM = PLAYER_TEAM;
