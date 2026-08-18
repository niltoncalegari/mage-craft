import { SIM_DT } from '../../sim/config';
import { emptyInput, TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { Arena } from '../../sim/Arena';
import { ALL_ROSTER, rosterFor, type RosterId } from '../../sim/cards';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, toSnapshotMsg } from '../../sim/snapshot';
import type { SpellId } from '../../sim/spells';
import { Vec2 } from '../../sim/Vec2';
import { World } from '../../sim/World';
import type { SnapshotMsg } from '../net/protocol';
import { spellRangeMap, STAGE_X, STAGE_Y } from './spellRangeMap';

/**
 * The card range: every spell in the catalog landing on the same spot, one
 * after another, forever.
 *
 * Sibling of {@link RangeSession}, and different in the one way that matters.
 * Projectiles are small and simultaneous, so that range compares them *across
 * space* — nine lanes, one beat. A spell covers a radius of three to five, and
 * seven of those side by side would need a map twice the width of the arena. So
 * this one compares *across time*: one stage, one cast at a time, back to back,
 * against the same dummies under the same light. Which is the better comparison
 * anyway — the question a cast beat has to answer is "which card was that", and
 * you answer it by seeing two of them land in the same place a few seconds
 * apart, not by hunting for the difference between two distant patches.
 *
 * Everything here goes through the real `World.castSpell`: the real effects,
 * the real snapshot path. Nothing is faked, so what you are looking at is what
 * a match will show you.
 *
 * The running order is **by mage, kit by kit**, not the flat catalog. Since the
 * pivot a spell is not a card a player holds but a thing a particular body
 * does, so the useful comparison is "here is everything the Pyromancer brings",
 * landing back to back — and the sharpest contrast in the whole catalog is
 * between two kits, not between two spells picked out of a list.
 */

/**
 * Every spell in the catalog, grouped under the mage whose kit holds it.
 *
 * A permutation of `ALL_SPELLS` rather than a subset — kits are disjoint and
 * cover the catalog, which `sim/kits.test.ts` holds, so grouping loses nothing
 * and repeats nothing. The lap length therefore stays odd (25), which is what
 * lets the caster flip after every cast and give each spell the opposite side
 * on the next lap without a control to toggle.
 */
const RUNNING_ORDER: readonly { rosterId: RosterId; spellId: SpellId }[] = ALL_ROSTER.flatMap(
  (rosterId) => (rosterFor(rosterId)?.abilities ?? []).map((spellId) => ({ rosterId, spellId })),
);

/** Where the cards land; the map is built around this point. */
const STAGE = new Vec2(STAGE_X, STAGE_Y);
/**
 * How the dummies stand around the stage: tight enough that the smallest card
 * (radius 3.5) still catches every one of them, so no card ever looks like it
 * missed.
 */
const HUDDLE_RADIUS = 1.9;
/** Bodies per side. Four is a squad, and enough for a cluster to read as one. */
const PER_SIDE = 4;
/**
 * All Golems: the tankiest entry in the roster, so the stage can be watched for
 * minutes without a body falling over, and identical on both sides so the only
 * difference on screen is what the card did to them.
 */
const DUMMY_ROSTER: RosterId = 'stone_golem';

/** Health per second the dummies claw back, and the floor that resets them. */
const REGEN_PER_SECOND = 9;
const RESET_FRACTION = 0.25;
/** How far a shove may carry a dummy before it walks home. */
const LEASH = 1.6;
const RETURN_SPEED = 1.5;

/** Seconds of match clock the range loops over; same reason as `RangeSession`. */
const CLOCK_LOOP = 60;

/** What the screen shows about the cast that just landed. */
export interface SpellRangeNowPlaying {
  readonly spellId: SpellId;
  /** The body whose kit this spell belongs to — the range's unit of grouping. */
  readonly rosterId: RosterId;
  readonly team: Team;
  /** Index in {@link RUNNING_ORDER}, for the screen's running order. */
  readonly index: number;
}

export interface SpellRangeSessionOptions {
  onSnapshot(msg: SnapshotMsg): void;
  /** Called each time a card actually lands, for the overlay. */
  onCast?(now: SpellRangeNowPlaying): void;
}

export { RUNNING_ORDER };

export class SpellRangeSession {
  private readonly world: World;
  private readonly dummies: { id: string; home: Vec2 }[] = [];

  /** Which card the carousel is trying to land next. */
  private next = 0;
  /**
   * Which side casts it. Flipped after every card, and the lap length is odd,
   * so each card alternates sides from one lap to the next for free — a
   * lap tells you what your own cast looks like, the next tells you what
   * theirs does, without a control to toggle.
   */
  private caster: Team = TEAM_A;

  private accumulator = 0;
  private tickCount = 0;
  private disposed = false;

  constructor(private readonly opts: SpellRangeSessionOptions) {
    this.world = new World(Arena.parse(spellRangeMap()));
    /*
     * Left on from when it doubled mana regen and drove the carousel's cadence.
     * With the bar gone `castSpell` charges nothing, so the carousel now paces
     * itself; this survives only because sudden death still accelerates kit
     * recharge, and nothing here would notice either way — the range map has no
     * Core, so there is no match to end early.
     */
    this.world.suddenDeath = true;

    for (let i = 0; i < PER_SIDE; i++) {
      // Two arcs facing each other across the stage, so a card aimed at allies
      // and one aimed at enemies both land on a legible clump rather than on a
      // scatter you have to count.
      const spread = (i / Math.max(1, PER_SIDE - 1) - 0.5) * Math.PI * 0.7;
      this.stand(TEAM_A, spread, 1);
      this.stand(TEAM_B, spread, -1);
    }
  }

  private stand(team: Team, spread: number, side: number): void {
    const angle = spread + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const home = new Vec2(
      STAGE.x + Math.cos(angle) * HUDDLE_RADIUS,
      STAGE.y + Math.sin(angle) * HUDDLE_RADIUS * 0.8,
    );
    const mage = this.world.summon(team, DUMMY_ROSTER, home);
    this.dummies.push({ id: mage.id, home });
  }

  /** Satisfies `MatchTransport`; the range is never disconnected. */
  get connected(): boolean {
    return !this.disposed;
  }

  /** The range casts on its own schedule; a click here would mean nothing. */
  sendCast(): void {
    /* intentionally empty */
  }

  tick(dtSeconds: number): void {
    if (this.disposed) return;

    this.accumulator += dtSeconds;
    // Same catch-up guard as RangeSession: a backgrounded tab must not try to
    // replay a minute of simulation in one frame.
    let budget = 5;
    while (this.accumulator >= SIM_DT && budget-- > 0) {
      this.accumulator -= SIM_DT;
      this.step();
    }
    if (this.accumulator > SIM_DT * 5) this.accumulator = 0;
  }

  private step(): void {
    this.holdStill();
    this.advanceCarousel();
    this.keepDummiesStanding();
    if (this.world.elapsed >= CLOCK_LOOP) this.world.elapsed = 0;

    this.world.step(SIM_DT);
    this.tickCount++;

    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      const snap = buildSnapshot(this.world, this.tickCount);
      this.opts.onSnapshot(toSnapshotMsg(snap, {}));
    }
  }

  /**
   * Tries to land the next card, and moves on only when it actually does.
   *
   * Pacing the carousel on the rejection rather than on a timer is what keeps
   * it honest: the gap between two casts is exactly the mana and the global
   * cooldown, which is the same thing that paces a real match. A card is never
   * skipped for being expensive — Chuva de Meteoros costs five and simply
   * takes longer to come round.
   */
  private advanceCarousel(): void {
    const { spellId, rosterId } = RUNNING_ORDER[this.next];
    if (this.world.castSpell(this.caster, spellId, STAGE).ok !== true) return;

    this.opts.onCast?.({ spellId, rosterId, team: this.caster, index: this.next });
    this.next = (this.next + 1) % RUNNING_ORDER.length;
    this.caster = this.caster === TEAM_A ? TEAM_B : TEAM_A;
  }

  /**
   * The dummies are here to be cast *at*, not to fight. Feeding them an empty
   * input every tick is what keeps them standing there: nothing else drives
   * them, since the range runs no `Brain`.
   */
  private holdStill(): void {
    for (const dummy of this.dummies) {
      this.world.setInput(dummy.id, emptyInput());
    }
  }

  /**
   * Keeps the stage populated. The regen is deliberately slower than a Praga
   * tick, so a card that is killing them still visibly wins — a dummy that
   * outheals the card being demonstrated is worse than no dummy.
   */
  private keepDummiesStanding(): void {
    for (const dummy of this.dummies) {
      const mage = this.world.mage(dummy.id);
      if (!mage) continue;

      if (!mage.alive || mage.health <= mage.maxHealth * RESET_FRACTION) {
        mage.alive = true;
        mage.state = 'idle';
        mage.respawnTimer = 0;
        mage.health = mage.maxHealth;
        mage.position = dummy.home;
      } else if (mage.health < mage.maxHealth) {
        mage.health = Math.min(mage.maxHealth, mage.health + REGEN_PER_SECOND * SIM_DT);
      }

      // Walk home rather than teleport, so a shove still reads as a shove.
      if (mage.position.distanceTo(dummy.home) > LEASH) {
        mage.position = mage.position.moveTowards(dummy.home, RETURN_SPEED * SIM_DT);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
