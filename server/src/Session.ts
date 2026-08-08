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
import { Commander } from '../../sim/bot/Commander';
import { defaultSquad, type RosterId } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
import { Deck, defaultDeck } from '../../sim/Deck';
import type { ElementId } from '../../sim/elements';
import { TEAM_A, TEAM_B, type Team } from '../../sim/entities';
import { Rng } from '../../sim/rng';
import type { CardId } from '../../sim/spells';
import { Vec2 } from '../../sim/Vec2';
import type { CastRejection, World } from '../../sim/World';
import type { Room, RoomState, RoomSummary, Slot, Spectator } from './Room';

/** 60/3 = 20Hz, within the project plan's ~20-30Hz snapshot target. */
export const SNAPSHOT_EVERY_N_TICKS = 3;

/** A plain-data view of one simulation tick, independent of the wire protocol. */
export interface Snapshot {
  tick: number;
  mages: MageSnapshotState[];
  projectiles: ProjectileSnapshotState[];
  puddles: PuddleSnapshotState[];
  structures: StructureSnapshotState[];
  /** Casts inside their VFX window (GDD §17) — cosmetic, never gameplay. */
  spells: SpellCastSnapshotState[];
  elapsed: number;
  suddenDeath: boolean;
  /** Mana per team, indexed by team number — the App picks the receiver's. */
  mana: Record<number, number>;
}

export interface MageSnapshotState {
  id: string;
  team: number;
  position: Vec2;
  facing: Vec2;
  health: number;
  maxHealth: number;
  charging: boolean;
  charge: number;
  element: ElementId;
  role: string;
  rosterId: RosterId | null;
  alive: boolean;
  /** True while Escudo Arcano still has damage to absorb (GDD §9) — for a client shield indicator. */
  shielded: boolean;
  /** Bênção de Ímpeto running (GDD §9) — for the client's haste aura. */
  hasted: boolean;
  /** Slowed by an ice hit or Maldição da Lentidão (GDD §8.3, §9). */
  slowed: boolean;
  /** Enemy mages this one put down (GDD §4); see `World.kill` for who gets credited. */
  kills: number;
  /** Times this mage was put down. A team's kill total is the enemy's sum of these. */
  deaths: number;
  /** Seconds until it returns; 0 while alive. The wire omits it when 0. */
  respawnRemaining: number;
  /** Post-respawn damage immunity is running. The wire omits it when false. */
  immune: boolean;
}

export interface StructureSnapshotState {
  id: string;
  team: number;
  kind: string;
  position: Vec2;
  radius: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  invulnerable: boolean;
}

export interface ProjectileSnapshotState {
  id: string;
  element: ElementId;
  position: Vec2;
  velocity: Vec2;
  /** Above the ground plane; the client draws (and shadows) the arc with it. */
  height: number;
  radius: number;
}

export interface SpellCastSnapshotState {
  id: string;
  spellId: string;
  team: number;
  position: Vec2;
  radius: number;
}

export interface PuddleSnapshotState {
  id: string;
  position: Vec2;
  radius: number;
  remaining: number;
}

export interface SessionCallbacks {
  onSnapshot?: (snap: Snapshot) => void;
  onRoundEnd?: (winnerTeam: number) => void;
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
  /** Teams played by the AI commander — the queue's bot fallback (GDD §10). */
  private commanders = new Map<Team, Commander>();
  private playerDecks = new Map<string, CardId[]>();
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
    this.commanders = new Map();

    // One seat per team in a 1v1; an empty or bot seat gets an AI commander so
    // the match is always contested. There is no squad-builder yet (GDD §16),
    // so every team fields the same default squad.
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const slot = this.room.slots().find((s) => s.team === team);
      const cards = (slot?.playerId ? this.playerDecks.get(slot.playerId) : null) ?? defaultDeck();
      this.decks.set(team, new Deck(cards, this.rng));

      if (!slot || slot.isBot || !slot.playerId) {
        this.commanders.set(team, new Commander(this.rng, (slot?.difficulty as Difficulty) ?? 'normal'));
      }

      world.initSquad(team, defaultSquad());
    }

    // Every mage on the board is permanent from tick one — Brain drives all
    // of them, since nobody steers a mage by hand (GDD §1).
    for (const id of world.mages.keys()) this.registerUnit(id);
  }

  /** Registers the deck a player brought, used on the next `startMatch`. */
  setDeck(playerId: string, cards: CardId[]): void {
    this.playerDecks.set(playerId, cards);
  }

  deckFor(team: Team): Deck | null {
    return this.decks.get(team) ?? null;
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
   * The one in-match action a player can take (GDD §13): spend mana to cast a
   * spell on an area. Returns the rejection reason so the client can say why.
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

  /** Runs the AI commanders for any team not held by a human. */
  private stepCommanders(dt: number): void {
    if (!this.world) return;
    for (const [team, commander] of this.commanders) {
      const deck = this.decks.get(team);
      if (!deck) continue;

      const intent = commander.step(this.world, team, deck, dt);
      if (!intent) continue;

      const result = this.world.castSpell(team, intent.cardId, intent.position);
      if (!result.ok) continue;
      deck.play(intent.cardId);
    }
  }

  /** Advances the simulation by one fixed step, if a match is running. */
  tick(): void {
    if (!this.world || !this.brain || this.matchEnded) return;

    this.stepCommanders(SIM_DT);
    this.brain.step(this.world, this.bots, SIM_DT);
    this.world.step(SIM_DT);
    this.tickCount++;

    const snap =
      this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0 ? this.buildSnapshot(this.world) : null;

    let roundEndWinner: number | null = null;
    if (this.world.roundOver) {
      // A null winner is a draw (GDD §4), reported as -1 on the wire.
      roundEndWinner = this.world.winner ?? -1;
      this.beginRematch();
    }

    if (snap) this.cb.onSnapshot?.(snap);
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

  private buildSnapshot(world: World): Snapshot {
    return {
      tick: this.tickCount,
      elapsed: world.elapsed,
      suddenDeath: world.suddenDeath,
      mana: { [TEAM_A]: world.manaOf(TEAM_A), [TEAM_B]: world.manaOf(TEAM_B) },
      structures: [...world.structures.values()].map((s) => ({
        id: s.id,
        team: s.team,
        kind: s.kind,
        position: s.position,
        radius: s.radius,
        health: s.health,
        maxHealth: s.maxHealth,
        alive: s.alive,
        invulnerable: s.invulnerable,
      })),
      mages: [...world.mages.values()].map((m) => ({
        id: m.id,
        team: m.team,
        position: m.position,
        facing: m.facing,
        health: m.health,
        maxHealth: m.maxHealth,
        charging: m.charging,
        charge: m.charge,
        element: m.element,
        role: m.role,
        rosterId: m.rosterId,
        alive: m.alive,
        shielded: m.shieldAmount > 0,
        hasted: m.speedBuffTimer > 0,
        slowed: m.slowTimer > 0,
        kills: m.kills,
        deaths: m.deaths,
        respawnRemaining: m.respawnTimer,
        immune: m.immunityTimer > 0,
      })),
      projectiles: [...world.projectiles.values()].map((p) => ({
        id: p.id,
        element: p.element,
        position: p.position,
        velocity: p.velocity,
        height: p.height,
        radius: p.radius,
      })),
      puddles: [...world.puddles.values()].map((pu) => ({
        id: pu.id,
        position: pu.position,
        radius: pu.radius,
        remaining: pu.duration - pu.elapsed,
      })),
      spells: [...world.spellCasts.values()].map((fx) => ({
        id: fx.id,
        spellId: fx.spellId,
        team: fx.team,
        position: fx.position,
        radius: fx.radius,
      })),
    };
  }
}
