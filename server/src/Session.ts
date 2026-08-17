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

import { Brain, type Difficulty } from '../../sim/bot/Brain';
import { Commander, type CastIntent } from '../../sim/bot/Commander';
import type { SquadPlan } from '../../sim/bot/Squad';
import { Tactician } from '../../sim/bot/Tactician';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { Deck, defaultDeck } from '../../sim/Deck';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { summarize, type MatchSummary } from '../../sim/matchStats';
import type { FiredRuleDTO } from '../../sim/protocol';
import { Rng } from '../../sim/rng';
import { buildSnapshot, SNAPSHOT_EVERY_N_TICKS, type Snapshot } from '../../sim/snapshot';
import type { CardId } from '../../sim/spells';
import { defaultStrategy, type Strategy, type StrategyDecision } from '../../sim/strategy';
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

/**
 * Whatever plays a team's hand.
 *
 * The idle pivot is cheap precisely because this shape already existed: a bot
 * seat's `Commander` and a player's `Tactician` answer the same question — which
 * card, and where — and neither touches the world. Session drives one map of
 * these rather than branching on who is seated.
 *
 * `plan` is passed to everyone and read by whoever cares; `lastDecision` is only
 * a Tactician's, which is why it is optional rather than a second interface.
 */
interface Caster {
  step(w: World, team: Team, deck: Deck, dt: number, plan?: SquadPlan): CastIntent | null;
  readonly lastDecision?: StrategyDecision | null;
}

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

  /** One deck per team; a 1v1 match has exactly two (GDD §7). */
  private decks = new Map<Team, Deck>();
  /**
   * Who plays each team's hand: a `Tactician` running a player's program, or a
   * `Commander` on a bot or empty seat (GDD §10). Every team has one since the
   * idle pivot — there is no longer a seat that waits for a human to click.
   */
  private casters = new Map<Team, Caster>();
  /** The rule that last actually cast, per team; feeds that player's snapshot. */
  private lastRuleByTeam = new Map<Team, FiredRuleDTO>();
  private playerDecks = new Map<string, CardId[]>();
  private playerSquads = new Map<string, RosterId[]>();
  private playerStrategies = new Map<string, Strategy>();
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

    this.decks = new Map();
    this.casters = new Map();
    this.lastRuleByTeam = new Map();

    // One seat per team in a 1v1. Every part of a seat's loadout comes from the
    // player who registered it, falling back to the defaults for a bot seat or
    // a player who never opened the builders.
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const slot = this.room.slots().find((s) => s.team === team);
      const cards = (slot?.playerId ? this.playerDecks.get(slot.playerId) : null) ?? defaultDeck();
      this.decks.set(team, new Deck(cards, this.rng));

      if (!slot || slot.isBot || !slot.playerId) {
        // An empty or bot seat still gets an AI commander, so the match is
        // always contested.
        this.casters.set(team, new Commander(this.rng, (slot?.difficulty as Difficulty) ?? 'normal'));
      } else {
        // A human seat is played by the program its player wrote. Somebody who
        // never opened the editor gets the heuristics written out as rules —
        // which is a real program they can then go and edit, not a stub.
        const strategy = this.playerStrategies.get(slot.playerId) ?? defaultStrategy(cards);
        this.casters.set(team, new Tactician(strategy));
      }

      const squad = (slot?.playerId ? this.playerSquads.get(slot.playerId) : null) ?? defaultSquad();
      world.initSquad(team, squad);
    }

    // Every mage on the board is permanent from tick one — Brain drives all
    // of them, since nobody steers a mage by hand (GDD §1).
    for (const id of world.mages.keys()) this.registerUnit(id);
  }

  /** Registers the deck a player brought, used on the next `startMatch`. */
  setDeck(playerId: string, cards: CardId[]): void {
    this.playerDecks.set(playerId, cards);
  }

  /** Registers the squad a player brought, used on the next `startMatch`. */
  setSquad(playerId: string, squad: RosterId[]): void {
    this.playerSquads.set(playerId, squad);
  }

  /**
   * Registers the strategy program a player brought, used on the next
   * `startMatch`. Already validated by the caller — `App.resolveStrategy` — for
   * the same reason `setDeck` trusts `resolveDeck`.
   */
  setStrategy(playerId: string, strategy: Strategy): void {
    this.playerStrategies.set(playerId, strategy);
  }

  deckFor(team: Team): Deck | null {
    return this.decks.get(team) ?? null;
  }

  /**
   * The rule that last put a spell down for a team, for that player's snapshot.
   * Null until one has — an empty program never sets it.
   */
  firedRuleFor(team: Team): FiredRuleDTO | null {
    return this.lastRuleByTeam.get(team) ?? null;
  }

  manaFor(team: Team): number {
    return this.world?.manaOf(team) ?? 0;
  }

  /** The team a player occupies, or null for a spectator. */
  teamOf(playerId: string): Team | null {
    const slot = this.room.slots().find((s) => s.playerId === playerId);
    return slot ? (slot.team as Team) : null;
  }

  /**
   * Spends mana to cast a spell on an area, returning the rejection reason so a
   * caller can say why.
   *
   * No longer reachable from the wire: since the idle pivot `App` refuses the
   * `cast` message, and a seat is played by its `Tactician`. It survives as the
   * seam every by-hand caster would go through — the tests exercise the world's
   * cast rules through it, and an override mode would arrive here rather than
   * inventing a second path into `castSpell`.
   */
  submitCast(
    playerId: string,
    cardId: string,
    position: Vec2,
  ): { ok: true } | { ok: false; reason: CastRejection | 'not_in_hand' | 'not_a_player' } {
    if (!this.world) throw new Error('match: not started yet');

    const team = this.teamOf(playerId);
    if (team === null) return { ok: false, reason: 'not_a_player' };

    const deck = this.decks.get(team);
    if (!deck || !deck.holds(cardId)) return { ok: false, reason: 'not_in_hand' };

    const result = this.world.castSpell(team, cardId, position);
    if (!result.ok) return { ok: false, reason: result.reason };

    // Only cycle the deck once the world actually accepted and charged for it.
    deck.play(cardId);
    return { ok: true };
  }

  private registerUnit(mageId: string): void {
    this.bots.set(mageId, this.unitDifficulty);
  }

  /**
   * Runs every team's caster and applies whatever it asked for. This is the one
   * place a spell is cast during a match now that no seat waits for a click.
   *
   * The squad plan is handed over because a Tactician's `posture` condition and
   * its squad-relative selectors read it. Passing `Brain`'s own planner rather
   * than building a second one is what keeps "defend" meaning the same thing to
   * the program and to the mages carrying it out.
   */
  private stepCasters(dt: number): void {
    const world = this.world;
    if (!world) return;

    for (const [team, caster] of this.casters) {
      const deck = this.decks.get(team);
      if (!deck) continue;

      const intent = caster.step(world, team, deck, dt, this.brain?.planner.planFor(team));
      if (!intent) continue;

      // Read before casting: `castSpell` cannot change the decision, but taking
      // it here keeps the rule and the cast that came from it in one statement.
      const decision = caster.lastDecision ?? null;

      const result = world.castSpell(team, intent.cardId, intent.position);
      // A refused cast leaves the last *successful* rule standing rather than
      // clearing it. The global cooldown refuses most of what a Tactician asks
      // for — it thinks four times a second and may cast once every 0.75s — so
      // clearing here would blink the HUD's trace on and off all match, and
      // would drop true information to prevent an announcement that a rejection
      // never makes in the first place.
      if (!result.ok) continue;

      deck.play(intent.cardId);
      if (decision) {
        this.lastRuleByTeam.set(team, {
          ruleId: decision.ruleId,
          index: decision.ruleIndex,
          cardId: decision.cardId,
          at: decision.at,
        });
      }
    }
  }

  /** Advances the simulation by one fixed step, if a match is running. */
  tick(): void {
    if (!this.world || !this.brain || this.matchEnded) return;

    this.stepCasters(SIM_DT);
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
