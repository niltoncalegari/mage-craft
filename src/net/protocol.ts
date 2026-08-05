/**
 * Re-export of the shared wire contract in `sim/protocol.ts`, kept at this path
 * so client imports don't have to care where the definition lives.
 */

export type {
  AddBotMsg,
  ClaimSlotMsg,
  ClientMsg,
  CreateRoomMsg,
  ErrorMsg,
  CastMsg,
  JoinRoomMsg,
  ListRoomsMsg,
  MageSnapshotDTO,
  MatchFoundMsg,
  MatchStartMsg,
  PlayerSlotDTO,
  ProjectileSnapshotDTO,
  PuddleSnapshotDTO,
  RemoveBotMsg,
  RoomListMsg,
  RoomStateMsg,
  RoomSummaryDTO,
  QueueStatusMsg,
  RoundEndMsg,
  SelectElementMsg,
  SelectTeamMsg,
  ServerMsg,
  SetReadyMsg,
  SnapshotMsg,
  SpectatorDTO,
  StructureSnapshotDTO,
  StartMatchMsg,
  Vec2DTO,
} from '../../sim/protocol';

export { peekType } from '../../sim/protocol';
