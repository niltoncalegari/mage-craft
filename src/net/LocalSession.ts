/**
 * A whole siege, simulated in this tab.
 *
 * Practice used to be a different game: `bootOfflineMatch` ran the pre-v1.1
 * SnowCraft loop with a controllable hero and lives, teaching mechanics the
 * siege no longer has. This runs the real `sim/` instead — the same `World`,
 * the same `Brain` driving every mage, the same `Tactician` playing the
 * player's program and the same `Commander` playing the opponent's hand — and
 * emits the same snapshot messages the server sends, so `OnlineMatch` renders
 * it without knowing the difference.
 *
 * Because `sim/defaultMap.ts` imports the arena directly, the map here is the
 * exact one the server plays on, with no fetch and nothing that could drift.
 */

import { Brain, type Difficulty } from '../../sim/bot/Brain';
import { Commander, type CastIntent } from '../../sim/bot/Commander';
import { Tactician } from '../../sim/bot/Tactician';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { Deck, defaultDeck } from '../../sim/Deck';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { summarize, type MatchSummary } from '../../sim/matchStats';
import type { FiredRuleDTO } from '../../sim/protocol';
import { Rng } from '../../sim/rng';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, toSnapshotMsg } from '../../sim/snapshot';
import type { CardId } from '../../sim/spells';
import { defaultStrategy, type Strategy } from '../../sim/strategy';
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
  /**
   * The program that plays the player's hand. Omitted falls back to
   * `defaultStrategy(deck)` — practice against a bot with a seat that casts
   * nothing would teach the wrong lesson about the deck being tried out.
   */
  strategy?: Strategy;
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
  private readonly tactician: Tactician;
  private readonly opts: LocalSessionOptions;

  private tickCount = 0;
  private accumulator = 0;
  private ended = false;
  /** The player's last rule to actually cast; their only in-match feedback. */
  private firedRule: FiredRuleDTO | null = null;

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
    // No `rng` on purpose, exactly as on the server: a caster that drew from
    // the shared stream would make editing a rule list change how the mages
    // fight, and a practice match would stop being reproducible from its seed.
    this.tactician = new Tactician(opts.strategy ?? defaultStrategy(opts.deck));
  }

  /** Satisfies `MatchTransport` — a local match is never disconnected. */
  get connected(): boolean {
    return !this.ended;
  }

  /**
   * Satisfies `MatchTransport`, and does nothing.
   *
   * Since the idle pivot a hand is played by its owner's program, so there is
   * no by-hand cast to apply — the server answers the same message with
   * `idle_mode`. Kept rather than removed from the interface because that is
   * the seam a future override mode would come back through.
   */
  sendCast(): void {}

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

    this.stepCasters(world);
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

  /**
   * Runs both hands. Practice is the same idle match the server runs: the
   * player's side is played by the program they wrote and the AI's by its
   * commander, and neither of them waits for a click.
   *
   * The Tactician gets Brain's own squad plan, so a rule guarded on "defend"
   * and the mages actually defending mean the same thing.
   */
  private stepCasters(world: World): void {
    const player = this.decks.get(PLAYER_TEAM);
    if (player) {
      const plan = this.brain.planner.planFor(PLAYER_TEAM);
      const intent = this.tactician.step(world, PLAYER_TEAM, player, SIM_DT, plan);
      if (this.apply(world, PLAYER_TEAM, player, intent)) {
        const d = this.tactician.lastDecision;
        // Only a cast the world accepted is announced; a refusal leaves the
        // last real one standing rather than blanking the HUD's trace.
        if (d) this.firedRule = { ruleId: d.ruleId, index: d.ruleIndex, cardId: d.cardId, at: d.at };
      }
    }

    const bot = this.decks.get(BOT_TEAM);
    if (bot) this.apply(world, BOT_TEAM, bot, this.commander.step(world, BOT_TEAM, bot, SIM_DT));
  }

  /** Casts an intent and cycles the deck, reporting whether the world took it. */
  private apply(world: World, team: Team, deck: Deck, intent: CastIntent | null): boolean {
    if (!intent) return false;
    if (!world.castSpell(team, intent.cardId, intent.position).ok) return false;
    deck.play(intent.cardId);
    return true;
  }

  private emitSnapshot(world: World): void {
    const deck = this.decks.get(PLAYER_TEAM);
    const snap = buildSnapshot(world, this.tickCount);
    this.opts.onSnapshot(
      toSnapshotMsg(snap, {
        mana: snap.mana[PLAYER_TEAM] ?? 0,
        hand: deck?.hand() ?? [],
        next: deck?.next() ?? null,
        firedRule: this.firedRule,
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
