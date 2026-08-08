/**
 * The client<->server wire contract (JSON over WebSocket).
 *
 * This file is *the* definition, imported by both sides: the client through
 * `src/net/protocol.ts` and the server through `server/src/App.ts`. It used to
 * be a TypeScript file that mirrored `server/internal/protocol/protocol.go` by
 * hand — the two are now one file, so a message can no longer change shape on
 * one side only.
 */

export type Vec2DTO = { x: number; y: number };

export type CreateRoomMsg = {
  type: 'create_room';
  teamSize: number;
  fillBots?: boolean;
  botDifficulty?: string;
};

export type JoinRoomMsg = { type: 'join_room'; roomId: string; name: string };
export type ListRoomsMsg = { type: 'list_rooms' };
export type SelectTeamMsg = { type: 'select_team'; team: number };
export type SelectElementMsg = { type: 'select_element'; element: string };
export type AddBotMsg = { type: 'add_bot'; team: number; difficulty: string };
export type RemoveBotMsg = { type: 'remove_bot'; slotId: string };
export type ClaimSlotMsg = { type: 'claim_slot'; slotId: string };
export type SetReadyMsg = { type: 'set_ready'; ready: boolean };
export type StartMatchMsg = { type: 'start_match' };

/**
 * Matchmaking (Clash Royale-style): the player presses Battle, waits in a
 * queue, and the server builds the 1v1 room. This is the primary way into a
 * match; `create_room`/`join_room` survive for private/custom games.
 */
export type JoinQueueMsg = { type: 'join_queue'; name: string; deck?: string[] };
export type LeaveQueueMsg = { type: 'leave_queue' };

/**
 * The only in-match message a player sends since the pivot: spend mana to cast
 * a spell — a buff on your own squad or a curse on the enemy's — at a chosen
 * point (GDD §9, §13). It replaces the old ~60 Hz `InputMsg` — no more move,
 * aim, charge or release, because nobody steers a mage any more, and (since
 * the v1.1 squad pivot) `cardId` names a spell rather than a unit to summon.
 */
export type CastMsg = { type: 'cast'; cardId: string; position: Vec2DTO };

export type ClientMsg =
  | CreateRoomMsg
  | JoinRoomMsg
  | ListRoomsMsg
  | SelectTeamMsg
  | SelectElementMsg
  | AddBotMsg
  | RemoveBotMsg
  | ClaimSlotMsg
  | SetReadyMsg
  | StartMatchMsg
  | JoinQueueMsg
  | LeaveQueueMsg
  | CastMsg;

export type PlayerSlotDTO = {
  slotId: string;
  team: number;
  playerId?: string;
  name?: string;
  isBot: boolean;
  element?: string;
  ready: boolean;
  pendingClaimPlayerId?: string;
};

export type SpectatorDTO = {
  playerId: string;
  name: string;
  claimedSlotId?: string;
};

export type RoomStateMsg = {
  type: 'room_state';
  roomId: string;
  teamSize: number;
  state: string;
  fillBots?: boolean;
  slots: PlayerSlotDTO[];
  spectators?: SpectatorDTO[];
  youRole?: string;
};

export type RoomSummaryDTO = {
  roomId: string;
  teamSize: number;
  state: string;
  filled: number;
  capacity: number;
  openBotSlots: number;
  acceptsSpectators: boolean;
};

export type RoomListMsg = { type: 'room_list'; rooms: RoomSummaryDTO[] };

export type MageSnapshotDTO = {
  id: string;
  team: number;
  position: Vec2DTO;
  facing: Vec2DTO;
  health: number;
  /** Per-unit since the pivot — a Golem and an Archer do not share a max. */
  maxHealth: number;
  charging: boolean;
  charge: number;
  element: string;
  /** Identity: 'tank' | 'damage' | 'support' (GDD §8). */
  role: string;
  /** Which roster entry this mage is, omitted for legacy/bare mages. */
  rosterId?: string;
  /** True while Escudo Arcano still has damage to absorb (GDD §9), for a minimal client indicator. */
  shielded: boolean;
  /** Bênção de Ímpeto is running on this mage (GDD §9) — drives its aura VFX. */
  hasted: boolean;
  /** Slowed by Maldição da Lentidão or an ice hit (GDD §8.3, §9). */
  slowed: boolean;
  /**
   * Enemy mages this one has personally put down (GDD §4). A team's total is
   * *not* the sum of these — see `World.kill` — it is the opposing team's
   * `deaths`, which is what the squad panel adds up.
   */
  kills: number;
  /** Times this mage has been put down; survives respawn. */
  deaths: number;
  /** Seconds until this mage returns. Omitted while it is alive. */
  respawnRemaining?: number;
  /** Post-respawn damage immunity is running. Omitted when false. */
  immune?: boolean;
};

export type StructureSnapshotDTO = {
  id: string;
  team: number;
  /** 'core' | 'tower' */
  kind: string;
  position: Vec2DTO;
  radius: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** A Core reads as immune while its Towers stand (GDD §5). */
  invulnerable: boolean;
};

export type ProjectileSnapshotDTO = {
  id: string;
  element: string;
  position: Vec2DTO;
  velocity: Vec2DTO;
  /**
   * Height above the ground plane. Without it the client drew every spell
   * sliding at y=0, half-buried in the ground and casting no shadow — the arc
   * a charged throw actually flies only exists here.
   */
  height: number;
  /** The projectile's real collision radius, so a boulder reads bigger than a bolt. */
  radius: number;
};

/**
 * A spell that was just cast, for VFX only (GDD §17). Buffs and curses land
 * instantly on the mages in range, so without this the wire would show no
 * trace of three of the four spells in the deck.
 */
export type SpellCastDTO = {
  id: string;
  /** 'blessing' | 'slow_curse' | 'arcane_shield' | 'plague'. */
  spellId: string;
  team: number;
  position: Vec2DTO;
  radius: number;
};

export type PuddleSnapshotDTO = {
  id: string;
  position: Vec2DTO;
  radius: number;
  remaining: number;
};

export type SnapshotMsg = {
  type: 'snapshot';
  tick: number;
  mages: MageSnapshotDTO[];
  projectiles: ProjectileSnapshotDTO[];
  puddles: PuddleSnapshotDTO[];
  structures: StructureSnapshotDTO[];
  /** Casts still inside their VFX window; a client fires each one once, by id. */
  spells: SpellCastDTO[];
  /** Seconds of match time elapsed, for the countdown (GDD §4). */
  elapsed: number;
  suddenDeath: boolean;
  /** The receiving player's own mana, 0..MANA_MAX (GDD §6). */
  mana: number;
  /**
   * The receiving player's own hand, in slot order (GDD §7). The server owns the
   * deck and its cycle, so the client cannot derive this — it is sent every
   * snapshot rather than as a separate event, which also makes a rejected cast
   * self-correcting. Empty for a spectator.
   */
  hand: string[];
  /** The card entering the hand next; omitted when the deck cannot say yet. */
  next?: string;
};

export type MatchStartMsg = { type: 'match_start' };
/** `winnerTeam` is -1 on a draw (GDD §4 — sudden death can expire level). */
export type RoundEndMsg = { type: 'round_end'; winnerTeam: number };
export type ErrorMsg = { type: 'error'; message: string };

/** Queue feedback: how long you have waited and how many are searching. */
export type QueueStatusMsg = {
  type: 'queue_status';
  waiting: number;
  position: number;
  elapsedSeconds: number;
};

/** Sent to both players the instant the server pairs them. */
export type MatchFoundMsg = {
  type: 'match_found';
  roomId: string;
  opponentName: string;
  yourTeam: number;
  /** True when the opponent is a bot because the queue timed out. */
  againstBot: boolean;
};

export type ServerMsg =
  | RoomStateMsg
  | RoomListMsg
  | MatchStartMsg
  | SnapshotMsg
  | RoundEndMsg
  | QueueStatusMsg
  | MatchFoundMsg
  | ErrorMsg;

export function peekType(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}
