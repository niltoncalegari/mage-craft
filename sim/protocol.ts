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

/**
 * Strips a `Vec2` down to the wire shape. Lives here rather than beside the
 * sender because every producer of a snapshot needs it — the server, and any
 * client running a match locally.
 */
export function fromVec2(v: { x: number; y: number }): Vec2DTO {
  return { x: v.x, y: v.y };
}

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
export type JoinQueueMsg = {
  type: 'join_queue';
  name: string;
  /** @deprecated Send `set_loadout` instead — it also covers custom rooms. */
  deck?: string[];
  /** Current Elo, so a paired opponent can be told what they're facing. */
  rating?: number;
};
export type LeaveQueueMsg = { type: 'leave_queue' };

/**
 * What the player brings to their next match: the 8-card deck, the 4-mage
 * squad, and — since the idle pivot — the strategy program that plays the deck
 * for them (GDD §7). Sent once after connecting, before joining a queue or a
 * room, because it has to apply to both paths — a room seat is claimed long
 * after any queue message would have been sent.
 *
 * Any part may be omitted, in which case the server keeps its default.
 *
 * `strategy` is deliberately `unknown` rather than `Strategy`: it is a nested
 * program authored on an untrusted client, so the wire type promises nothing
 * and `validateStrategy` on the server is what decides whether it is one.
 */
export type SetLoadoutMsg = {
  type: 'set_loadout';
  deck?: string[];
  squad?: string[];
  strategy?: unknown;
};

/**
 * Spend mana to cast a spell at a chosen point.
 *
 * @deprecated Since the idle pivot nobody casts by hand — a seat is played by
 * the `Tactician` running the player's program, and the server rejects this
 * message. It is kept because `MatchTransport` implements it on both sides and
 * it is the natural hook for a future override mode; delete it only once
 * something has replaced that seam.
 */
export type CastMsg = { type: 'cast'; cardId: string; position: Vec2DTO };

/** A quick-react from the hand, GDD-adjacent but not in it — see EmoteId in src/app/emotes.ts. */
export type SendEmoteMsg = { type: 'send_emote'; emoteId: string };

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
  | SetLoadoutMsg
  | CastMsg
  | SendEmoteMsg;

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

/** One status effect on the wire: `k` is the {@link EffectKind}, `s` the stacks. */
export type MageFxDTO = { k: string; s?: number };

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
  /**
   * Status effects running on this mage (GDD §9), in `EFFECT_ORDER`. Omitted
   * entirely when there are none, which is the common case. `s` is the stack
   * count, omitted when 1.
   *
   * This replaced the `shielded`/`hasted`/`slowed` booleans. Those cost three
   * fields per mage per snapshot whether or not anything was happening, and
   * every new effect cost a protocol change; a list costs nothing when idle and
   * never needs another field.
   */
  fx?: MageFxDTO[];
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

/**
 * The rule that last put a spell down for the receiving player (GDD §7).
 *
 * This is the whole of an idle player's in-match feedback. They did not click,
 * so without being told *which of their own rules* caused what they are
 * watching, a match is something that happens near them rather than something
 * they wrote — which is the difference between this game and a screensaver.
 *
 * Sent on the per-recipient channel next to `mana`/`hand`, never broadcast: a
 * player's program is theirs, and leaking the opponent's would turn reading
 * the wire into a strategy dump.
 */
export type FiredRuleDTO = {
  ruleId: string;
  /** 0-based position in the program; the HUD says "Regra {index + 1}". */
  index: number;
  cardId: string;
  /** The `TargetSelector` the rule named — where it aimed, in the player's words. */
  at: string;
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
  /**
   * The receiving player's last rule to actually cast. Omitted until one has —
   * an empty program never sets it, which is exactly what an empty program
   * should look like on screen.
   */
  firedRule?: FiredRuleDTO;
};

export type MatchStartMsg = { type: 'match_start' };
/** `winnerTeam` is -1 on a draw (GDD §4 — sudden death can expire level). */
export type RoundEndMsg = { type: 'round_end'; winnerTeam: number };
export type ErrorMsg = { type: 'error'; message: string };

export type MageStatDTO = { rosterId?: string; role: string; kills: number; deaths: number };
export type CastStatDTO = { cardId: string; casts: number };
export type TeamSummaryDTO = {
  squad: string[];
  kills: number;
  deaths: number;
  structuresDestroyed: number;
  casts: CastStatDTO[];
  mages: MageStatDTO[];
};

/**
 * The match's account of itself, sent alongside `round_end`.
 *
 * Kept as its own message rather than fields on `RoundEndMsg` because
 * `round_end` drives the rematch-lobby handover on the client, and a consumer
 * that only wants the numbers (history, analytics, a future replay) should not
 * have to touch that path.
 */
export type MatchResultMsg = {
  type: 'match_result';
  winnerTeam: number;
  durationSeconds: number;
  suddenDeath: boolean;
  /** Keyed by wire team number. */
  perTeam: Record<number, TeamSummaryDTO>;
};

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
  /** Opponent's Elo at pairing time; null against a bot (bots aren't rated). */
  opponentRating: number | null;
};

/** Broadcast to both players in the room the instant one of them sends one — no ack, no history. */
export type EmoteMsg = { type: 'emote'; playerId: string; emoteId: string };

export type ServerMsg =
  | RoomStateMsg
  | RoomListMsg
  | MatchStartMsg
  | SnapshotMsg
  | RoundEndMsg
  | MatchResultMsg
  | QueueStatusMsg
  | MatchFoundMsg
  | EmoteMsg
  | ErrorMsg;

export function peekType(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}
