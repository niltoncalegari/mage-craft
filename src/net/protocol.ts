/** Wire types mirroring server/internal/protocol (JSON over WebSocket). */

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
export type InputMsg = {
  type: 'input';
  move: Vec2DTO;
  aim: Vec2DTO;
  charging: boolean;
  release: boolean;
};

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
  | InputMsg;

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
  lives: number;
  charging: boolean;
  charge: number;
  element: string;
};

export type ProjectileSnapshotDTO = {
  id: string;
  element: string;
  position: Vec2DTO;
  velocity: Vec2DTO;
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
};

export type MatchStartMsg = { type: 'match_start' };
export type RoundEndMsg = { type: 'round_end'; winnerTeam: number };
export type ErrorMsg = { type: 'error'; message: string };

export type ServerMsg =
  | RoomStateMsg
  | RoomListMsg
  | MatchStartMsg
  | SnapshotMsg
  | RoundEndMsg
  | ErrorMsg;

export function peekType(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}
