/**
 * A whole siege, simulated in this tab.
 *
 * Practice used to be a different game: `bootOfflineMatch` ran the pre-v1.1
 * SnowCraft loop with a controllable hero and lives, teaching mechanics the
 * siege no longer has. This runs the real `sim/` instead — the same `World` and
 * the same `Brain` driving every mage and spending every kit — and emits the
 * same snapshot messages the server sends, so `OnlineMatch` renders it without
 * knowing the difference.
 *
 * Because `sim/defaultMap.ts` imports the arena directly, the map here is the
 * exact one the server plays on, with no fetch and nothing that could drift.
 */

import { abilityPolicyFor, type Stance } from '../../sim/abilityPolicy';
import { Brain, type Difficulty } from '../../sim/bot/Brain';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { summarize, type MatchSummary } from '../../sim/matchStats';
import type { FiredAbilityDTO } from '../../sim/protocol';
import { Rng } from '../../sim/rng';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, toSnapshotMsg } from '../../sim/snapshot';
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
  /**
   * How eagerly each of those mages spends its kit. Omitted leaves every one of
   * them at `normal` — practice with a squad sitting on its kits would teach
   * the wrong lesson about the squad being tried out.
   */
  stances?: Partial<Record<RosterId, Stance>>;
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
  private readonly opts: LocalSessionOptions;

  private tickCount = 0;
  private accumulator = 0;
  private ended = false;
  /** The player's last mage to actually cast; their only in-match feedback. */
  private firedAbility: FiredAbilityDTO | null = null;

  constructor(opts: LocalSessionOptions) {
    this.opts = opts;
    const seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
    const rng = new Rng(seed);

    const world = new World();
    world.initSquad(PLAYER_TEAM, opts.squad, opts.stances);
    world.initSquad(BOT_TEAM, defaultSquad());
    this.world = world;

    // Exactly as on the server: the world announces a cast rather than this
    // loop catching it, because a spell leaves a kit inside `Brain.step`.
    // Only the player's own side is recorded — the HUD has nothing to say
    // about the opponent's cadence.
    world.onAbilityCast = (mageId, team, spellId) => {
      if (team !== PLAYER_TEAM) return;
      this.firedAbility = {
        mageId,
        spellId,
        at: abilityPolicyFor(spellId)?.at ?? 'enemy_cluster',
      };
    };

    this.brain = new Brain(rng);
    for (const id of world.mages.keys()) this.units.set(id, opts.difficulty);
  }

  /** Satisfies `MatchTransport` — a local match is never disconnected. */
  get connected(): boolean {
    return !this.ended;
  }

  /**
   * Satisfies `MatchTransport`, and does nothing.
   *
   * Since v1.3 a spell is spent by the mage carrying it, so there is no by-hand
   * cast to apply — the server answers the same message with `idle_mode`. Kept
   * rather than removed from the interface because that is the seam a future
   * override mode would come back through.
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

  private emitSnapshot(world: World): void {
    this.opts.onSnapshot(
      toSnapshotMsg(buildSnapshot(world, this.tickCount), { firedAbility: this.firedAbility }),
    );
  }

  dispose(): void {
    this.ended = true;
    this.world = null;
  }
}

/** The wire team a practice player commands, for the match view's POV. */
export const LOCAL_PLAYER_TEAM = PLAYER_TEAM;
