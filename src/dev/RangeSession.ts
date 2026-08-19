import { ALL_ROSTER, type RosterId } from '../../sim/cards';
import { Arena } from '../../sim/Arena';
import { CHARGE_TIME, MAGE_RADIUS, RECOVERY, SIM_DT, THROW_COOLDOWN } from '../../sim/config';
import { emptyInput, TEAM_A, TEAM_B } from '../../sim/entities';
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

/**
 * Where each lane's target stands: in front of the wall, not on it.
 *
 * The range was built to show what a projectile *looks* like, and a wall was
 * enough for that. Status effects are about what a projectile *does*, and none
 * of them — the frost wash, the flames, the stun motes — exist without a mage
 * to land on. Projectile-vs-mage collision is 2D, so the target intercepts the
 * shot wherever it is in its arc; it sits a body's width clear of the blocks so
 * the impact reads against open ground rather than against masonry.
 */
const TARGET_Y = WALL_Y + MAGE_RADIUS * 2 + 0.8;
/**
 * The dummies are all Golems: the tankiest entry in the roster, so a lane can
 * be watched for minutes without the target falling over, and identical across
 * lanes so the only difference on screen is the element hitting them.
 */
const TARGET_ROSTER: RosterId = 'stone_golem';
/**
 * Health per second the targets claw back. Deliberately below a burn's damage
 * (4 per stack every 0.5s) so a burning target still visibly loses ground —
 * a dummy that outheals the effect being demonstrated is worse than no dummy.
 */
const TARGET_REGEN_PER_SECOND = 5;
/** Below this the target is topped straight back up rather than left to die. */
const TARGET_RESET_FRACTION = 0.2;
/**
 * How far knockback may shove a target before it walks home. Generous, because
 * being shoved *is* the stone and wind demonstration — this only stops a lane's
 * target ending up in the next lane after a few minutes.
 */
const TARGET_LEASH = 2.0;
const TARGET_RETURN_SPEED = 1.5;

export interface RangeSessionOptions {
  onSnapshot(msg: SnapshotMsg): void;
  /** Fire all lanes together (easy to compare) or stagger them (easy to watch one). */
  synchronized?: boolean;
}

export class RangeSession {
  private readonly world: World;
  private readonly lanes: { id: string; rosterId: RosterId; aim: Vec2; phase: number }[] = [];
  /** One standing target per lane, with the spot it belongs on. */
  private readonly targets: { id: string; home: Vec2 }[] = [];
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
        // Straight down its own lane, at the target standing in front of the block.
        aim: new Vec2(x, TARGET_Y),
        phase: opts.synchronized === false ? (i / ALL_ROSTER.length) * CYCLE : 0,
      });

      const home = new Vec2(x, TARGET_Y);
      const target = this.world.summon(TEAM_B, TARGET_ROSTER, home);
      this.targets.push({ id: target.id, home });
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
    this.keepTargetsStanding();
    this.holdTheClock();

    this.world.step(SIM_DT);
    this.tickCount++;

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      const snap = buildSnapshot(this.world, this.tickCount);
      this.opts.onSnapshot(toSnapshotMsg(snap, {}));
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

  /**
   * Keeps every lane's target alive and roughly where it belongs.
   *
   * Neither half is cheating: the regen is slower than any effect's damage, so
   * what you see is still the effect winning, and the leash only pulls a target
   * back once knockback has already carried it clear of its lane.
   */
  private keepTargetsStanding(): void {
    for (const target of this.targets) {
      const mage = this.world.mage(target.id);
      if (!mage) continue;

      if (!mage.alive || mage.health <= mage.maxHealth * TARGET_RESET_FRACTION) {
        mage.alive = true;
        mage.state = 'idle';
        mage.respawnTimer = 0;
        mage.health = mage.maxHealth;
        mage.position = target.home;
      } else if (mage.health < mage.maxHealth) {
        mage.health = Math.min(mage.maxHealth, mage.health + TARGET_REGEN_PER_SECOND * SIM_DT);
      }

      // Walk home rather than teleport, so a shove still reads as a shove.
      if (mage.position.distanceTo(target.home) > TARGET_LEASH) {
        mage.position = mage.position.moveTowards(target.home, TARGET_RETURN_SPEED * SIM_DT);
      }
    }
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
