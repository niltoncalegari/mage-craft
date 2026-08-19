/**
 * Ties a lobby Room to a live simulation and its bots — the one place that
 * needs all three, so Room stays lobby-only and the sim package stays
 * transport-free.
 *
 * The Go original also owned a mutex here, serialising lobby mutations against
 * the room's own 60Hz tick goroutine. Node's event loop gives that for free: a
 * tick and a WebSocket message can never interleave mid-operation, so the
 * locking is simply gone rather than translated.
 */

import { abilityPolicyFor, type Stance } from '../../sim/abilityPolicy';
import { Brain, type Difficulty } from '../../sim/bot/Brain';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { summarize, type MatchSummary } from '../../sim/matchStats';
import type { FiredAbilityDTO } from '../../sim/protocol';
import { Rng } from '../../sim/rng';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, type Snapshot } from '../../sim/snapshot';
import { Vec2 } from '../../sim/Vec2';
import type { CastRejection, World } from '../../sim/World';
import type { Room, RoomState, RoomSummary, Slot, Spectator } from './Room';

// The snapshot shape moved to `sim/snapshot.ts` so a client running a match
// locally can build the same bytes; re-exported here because the server and its
// tests have always reached for it through Session.
export { SNAPSHOT_EVERY_N_TICKS };
export type {
  MageSnapshotState,
  ProjectileSnapshotState,
  PuddleSnapshotState,
  Snapshot,
  SpellCastSnapshotState,
  StructureSnapshotState,
} from '../../sim/snapshot';

export interface SessionCallbacks {
  onSnapshot?: (snap: Snapshot) => void;
  onRoundEnd?: (winnerTeam: number) => void;
  /** The finished match's own numbers, captured before the world is dropped. */
  onMatchResult?: (summary: MatchSummary) => void;
}

export class Session {
  private world: World | null = null;
  /**
   * Every unit in the world, not just "the bot seats": since the pivot nobody
   * steers a mage by hand, so Brain drives all of them (GDD §1).
   */
  private bots = new Map<string, Difficulty>();
  private brain: Brain | null = null;
  private tickCount = 0;
  private matchEnded = false;
  private loop: ReturnType<typeof setInterval> | null = null;

  /** The ability that last actually cast, per team; feeds that player's snapshot. */
  private lastAbilityByTeam = new Map<Team, FiredAbilityDTO>();
  private playerSquads = new Map<string, RosterId[]>();
  private playerStances = new Map<string, Partial<Record<RosterId, Stance>>>();
  private unitDifficulty: Difficulty = 'normal';

  constructor(
    readonly room: Room,
    private readonly cb: SessionCallbacks = {},
    private readonly rng: Rng = new Rng((Math.random() * 0xffffffff) >>> 0),
  ) {}

  /* ---- lobby passthrough ------------------------------------------------ */

  /** Registers a player in the lobby, or as a spectator when the match is live. */
  join(playerId: string, name: string): void {
    switch (this.room.state) {
      case 'in_progress':
        this.room.joinAsSpectator(playerId, name);
        return;
      case 'lobby':
        this.room.join(playerId, name);
        return;
      default:
        throw new Error(`match: cannot join, room is ${this.room.state}`);
    }
  }

  leave(playerId: string): void {
    this.room.leave(playerId);
  }

  selectTeam(playerId: string, team: Team): void {
    this.room.selectTeam(playerId, team);
  }

  selectElement(playerId: string, element: string): void {
    this.room.selectElement(playerId, element);
  }

  addBot(team: Team, difficulty: string): Slot {
    return this.room.addBot(team, difficulty);
  }

  removeBot(slotId: string): void {
    this.room.removeBot(slotId);
  }

  fillEmptyWithBots(difficulty: string): void {
    this.room.fillEmptyWithBots(difficulty);
  }

  claimSlot(playerId: string, slotId: string): void {
    this.room.claimSlot(playerId, slotId);
  }

  setReady(playerId: string, ready: boolean): void {
    this.room.setReady(playerId, ready);
  }

  slots(): Slot[] {
    return this.room.slots();
  }

  spectators(): Spectator[] {
    return this.room.spectators();
  }

  roleOf(playerId: string): string {
    return this.room.roleOf(playerId);
  }

  memberIds(): string[] {
    return this.room.memberIds();
  }

  get state(): RoomState {
    return this.room.state;
  }

  summary(): RoomSummary {
    return this.room.summary();
  }

  /** Whether the current match loop has finished (a rematch lobby may still be open). */
  get ended(): boolean {
    return this.matchEnded;
  }

  /** Exposed for tests that need to inspect the live simulation. */
  get liveWorld(): World | null {
    return this.world;
  }

  /** Exposed for tests asserting the bot roster was armed from the room's slots. */
  get botRoster(): ReadonlyMap<string, Difficulty> {
    return this.bots;
  }

  /* ---- match ------------------------------------------------------------ */

  /**
   * Validates and builds the world (delegating to Room), gives each team its
   * permanent squad (GDD §4, §7), then arms this session's bot roster so
   * ticking can drive every mage without Room needing to know the AI exists.
   */
  startMatch(): void {
    const world = this.room.startMatch();

    this.world = world;
    this.bots = new Map();
    // Fresh brain per match: the AI keeps per-bot decision/dodge timers that
    // must not carry over from the previous round.
    this.brain = new Brain(this.rng);
    this.tickCount = 0;
    this.matchEnded = false;

    this.lastAbilityByTeam = new Map();

    // One seat per team in a 1v1. A seat's loadout comes from the player who
    // registered it, falling back to the defaults for a bot seat or a player
    // who never opened the builder. There is no longer a branch on *who* is
    // seated: both sides are four mages spending their own kits, and a bot seat
    // differs from a human one only in whether anybody chose the postures.
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const slot = this.room.slots().find((s) => s.team === team);
      const playerId = slot?.isBot ? null : (slot?.playerId ?? null);

      const squad = (playerId ? this.playerSquads.get(playerId) : null) ?? defaultSquad();
      const stances = (playerId ? this.playerStances.get(playerId) : null) ?? {};
      world.initSquad(team, squad, stances);
    }

    // The one place a spell becomes visible above the sim: it leaves a kit deep
    // inside `Brain.step`, so the world announces it rather than the session
    // catching it on the way past.
    world.onAbilityCast = (mageId, team, spellId) => {
      this.lastAbilityByTeam.set(team, {
        mageId,
        spellId,
        at: abilityPolicyFor(spellId)?.at ?? 'enemy_cluster',
      });
    };

    // Every mage on the board is permanent from tick one — Brain drives all
    // of them, since nobody steers a mage by hand (GDD §1).
    for (const id of world.mages.keys()) this.registerUnit(id);
  }

  /** Registers the squad a player brought, used on the next `startMatch`. */
  setSquad(playerId: string, squad: RosterId[]): void {
    this.playerSquads.set(playerId, squad);
  }

  /**
   * Registers the postures a player assigned their squad, used on the next
   * `startMatch`. Already validated by the caller — `App.resolveStances` — for
   * the same reason `setSquad` trusts `resolveSquad`.
   */
  setStances(playerId: string, stances: Partial<Record<RosterId, Stance>>): void {
    this.playerStances.set(playerId, stances);
  }

  /**
   * The ability that last put a spell down for a team, for that player's
   * snapshot. Null until one has — a squad that has not cast never sets it.
   */
  firedAbilityFor(team: Team): FiredAbilityDTO | null {
    return this.lastAbilityByTeam.get(team) ?? null;
  }

  /** The team a player occupies, or null for a spectator. */
  teamOf(playerId: string): Team | null {
    const slot = this.room.slots().find((s) => s.playerId === playerId);
    return slot ? (slot.team as Team) : null;
  }

  /**
   * Casts a spell on an area for a player's whole side, returning the rejection
   * reason so a caller can say why.
   *
   * Not reachable from the wire: `App` refuses the `cast` message, and since
   * v1.3 a spell belongs to the mage carrying it. It survives as the seam a
   * by-hand caster would go through — an override mode would arrive here rather
   * than inventing a second path into the world.
   */
  submitCast(
    playerId: string,
    cardId: string,
    position: Vec2,
  ): { ok: true } | { ok: false; reason: CastRejection | 'not_a_player' } {
    if (!this.world) throw new Error('match: not started yet');

    const team = this.teamOf(playerId);
    if (team === null) return { ok: false, reason: 'not_a_player' };

    const result = this.world.castSpell(team, cardId, position);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true };
  }

  private registerUnit(mageId: string): void {
    this.bots.set(mageId, this.unitDifficulty);
  }

  /** Advances the simulation by one fixed step, if a match is running. */
  tick(): void {
    if (!this.world || !this.brain || this.matchEnded) return;

    this.brain.step(this.world, this.bots, SIM_DT);
    this.world.step(SIM_DT);
    this.tickCount++;

    const snap =
      this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0 ? buildSnapshot(this.world, this.tickCount) : null;

    let roundEndWinner: number | null = null;
    let summary: MatchSummary | null = null;
    if (this.world.roundOver) {
      // A null winner is a draw (GDD §4), reported as -1 on the wire.
      roundEndWinner = this.world.winner ?? -1;
      // Read the match before `beginRematch` drops the world — this is the only
      // instant its own numbers still exist.
      summary = summarize(this.world);
      this.beginRematch();
    }

    if (snap) this.cb.onSnapshot?.(snap);
    if (summary) this.cb.onMatchResult?.(summary);
    if (roundEndWinner !== null) this.cb.onRoundEnd?.(roundEndWinner);
  }

  /**
   * Drives tick() at the fixed simulation rate until the match ends or stop()
   * is called.
   *
   * A plain `setInterval(1000/60)` would silently drop ticks whenever the event
   * loop runs late, making the match play slower under load. This accumulates
   * real elapsed time instead and catches up, capped so a long stall can't
   * trigger a spiral of death.
   */
  runLoop(now: () => number = () => performance.now()): void {
    this.stop();

    const stepMs = SIM_DT * 1000;
    const maxCatchUpTicks = 5;
    let last = now();

    this.loop = setInterval(() => {
      const current = now();
      let elapsed = current - last;
      last = current;

      let budget = maxCatchUpTicks;
      while (elapsed >= stepMs && budget-- > 0) {
        elapsed -= stepMs;
        this.tick();
        if (this.matchEnded) {
          this.stop();
          return;
        }
      }
      // Carry the unconsumed remainder into the next interval.
      last -= elapsed;
    }, stepMs);
  }

  /** Stops the tick loop, if one is running. */
  stop(): void {
    if (this.loop !== null) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  /** Applies spectator claims, resets the room to lobby, and ends the loop. */
  private beginRematch(): void {
    this.room.applyClaims();
    this.room.resetToLobby();
    this.world = null;
    this.brain = null;
    this.bots = new Map();
    this.matchEnded = true;
  }

}
