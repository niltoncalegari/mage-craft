import { ALL_ROSTER, type RosterId } from '../../sim/cards';
import { Arena } from '../../sim/Arena';
import { CHARGE_TIME, RECOVERY, SIM_DT, THROW_COOLDOWN } from '../../sim/config';
import { emptyInput, TEAM_A } from '../../sim/entities';
import { FIRING_LINE_Y, laneX, rangeMap, WALL_Y } from '../../sim/rangeMap';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, toSnapshotMsg } from '../../sim/snapshot';
import { Vec2 } from '../../sim/Vec2';
import { World } from '../../sim/World';
import type { SnapshotMsg } from '../net/protocol';

/**
 * Drives the firing range (see `sim/rangeMap.ts`): the whole roster in a row,
 * every mage charging and releasing at the wall in front of it, forever.
 *
 * Deliberately *not* a `LocalSession` variant. A practice match runs the bot
 * `Brain`, which would have these mages advance, take cover and pick targets —
 * all of which is exactly what you do not want when the question is what a
 * spell looks like. Inputs here are scripted instead, so every element fires
 * from the same spot, at the same charge, on the same beat.
 *
 * Satisfies the same shape `OnlineMatch` consumes as a transport, so the range
 * renders through the real renderers and the real snapshot path.
 */

/** Seconds between volleys, on top of the throw's own cooldown and recovery. */
const VOLLEY_GAP = 0.5;
/** One full cycle: wind up, release, recover, pause. */
const CYCLE = CHARGE_TIME + THROW_COOLDOWN + RECOVERY + VOLLEY_GAP;

/**
 * Health the sparring dummy is pinned near, so the Cleric next to it never runs
 * out of something to heal. Without this the range would show every attack and
 * none of the support work, since nothing on a firing range takes damage.
 */
const DUMMY_HEALTH_FRACTION = 0.45;
const DUMMY_DRAIN_PER_SECOND = 14;

/** Seconds of match clock the range loops over; see `holdTheClock`. */
const CLOCK_LOOP = 60;

export interface RangeSessionOptions {
  onSnapshot(msg: SnapshotMsg): void;
  /** Fire all lanes together (easy to compare) or stagger them (easy to watch one). */
  synchronized?: boolean;
}

export class RangeSession {
  private readonly world: World;
  private readonly lanes: { id: string; rosterId: RosterId; aim: Vec2; phase: number }[] = [];
  /** The ally the Cleric keeps topping up; see `DUMMY_HEALTH_FRACTION`. */
  private dummyId: string | null = null;

  private accumulator = 0;
  private tickCount = 0;
  private clock = 0;
  private disposed = false;

  constructor(private readonly opts: RangeSessionOptions) {
    this.world = new World(Arena.parse(rangeMap()));

    ALL_ROSTER.forEach((rosterId, i) => {
      const x = laneX(i);
      const mage = this.world.summon(TEAM_A, rosterId, new Vec2(x, FIRING_LINE_Y));
      this.lanes.push({
        id: mage.id,
        rosterId,
        // Straight down its own lane, at the block in front of it.
        aim: new Vec2(x, WALL_Y),
        phase: opts.synchronized === false ? (i / ALL_ROSTER.length) * CYCLE : 0,
      });
    });

    // The dummy is whoever stands next to the Cleric, so the heal beam has a
    // short, legible span rather than crossing the whole range.
    const clericLane = this.lanes.findIndex((l) => l.rosterId === 'cleric');
    const dummyLane = this.lanes[clericLane - 1] ?? this.lanes[clericLane + 1];
    this.dummyId = dummyLane?.id ?? null;
  }

  /** Satisfies `MatchTransport`; the range is never disconnected. */
  get connected(): boolean {
    return !this.disposed;
  }

  /** The range has no mana and no hand — a cast here would mean nothing. */
  sendCast(): void {
    /* intentionally empty */
  }

  tick(dtSeconds: number): void {
    if (this.disposed) return;

    this.accumulator += dtSeconds;
    // Same catch-up guard as LocalSession: a backgrounded tab must not try to
    // replay a minute of simulation in one frame.
    let budget = 5;
    while (this.accumulator >= SIM_DT && budget-- > 0) {
      this.accumulator -= SIM_DT;
      this.step();
    }
    if (this.accumulator > SIM_DT * 5) this.accumulator = 0;
  }

  private step(): void {
    this.clock += SIM_DT;
    this.driveLanes();
    this.drainDummy();
    this.holdTheClock();

    this.world.step(SIM_DT);
    this.tickCount++;

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      const snap = buildSnapshot(this.world, this.tickCount);
      this.opts.onSnapshot(toSnapshotMsg(snap, { mana: 0, hand: [], next: null }));
    }
  }

  /**
   * The script: hold the charge to full, release on the frame it completes,
   * then stand down for the rest of the cycle. Every mage gets a *full* charge
   * so what you are comparing is the spell, not the wind-up.
   */
  private driveLanes(): void {
    for (const lane of this.lanes) {
      const t = (this.clock + lane.phase) % CYCLE;
      const charging = t < CHARGE_TIME;
      const release = !charging && t < CHARGE_TIME + SIM_DT;

      this.world.setInput(lane.id, { ...emptyInput(), aim: lane.aim, charging, release });
    }
  }

  /**
   * Rewinds the match clock before it can expire.
   *
   * The range map has no Core, so `World.checkMatchEnd` cannot resolve a
   * winner — it just runs down regulation, enters sudden death, and then ends
   * in a draw, at which point `World.step` returns early and the whole range
   * freezes. A tool you have to restart every four minutes to keep looking at a
   * projectile is not a tool, so the clock is looped instead.
   */
  private holdTheClock(): void {
    if (this.world.elapsed >= CLOCK_LOOP) this.world.elapsed = 0;
  }

  /** Keeps the sparring dummy hurt enough for the Cleric to have work to do. */
  private drainDummy(): void {
    if (!this.dummyId) return;
    const dummy = this.world.mage(this.dummyId);
    if (!dummy?.alive) return;

    const floor = dummy.maxHealth * DUMMY_HEALTH_FRACTION;
    if (dummy.health > floor) {
      dummy.health = Math.max(floor, dummy.health - DUMMY_DRAIN_PER_SECOND * SIM_DT);
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
