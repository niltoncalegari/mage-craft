import type { EntityId } from '../ecs/Entity';
import type { ElementId } from '../game/elements';
import type { BuffType, Team } from '../game/types';

/**
 * Strongly-typed event payloads for the {@link EventBus} (design §24). Systems
 * communicate through these instead of holding direct references.
 */
export interface GameEvents {
  SnowballThrown: { snowballId: EntityId; ownerId: EntityId; team: Team };
  /**
   * `element` is undefined for the legacy offline snowball (no elemental
   * catalog there) and set online so impact VFX can match the spell that hit.
   */
  SnowballImpact: {
    snowballId: EntityId;
    x: number;
    y: number;
    hitPlayerId: EntityId | null;
    element?: ElementId;
  };
  PlayerHit: {
    playerId: EntityId;
    attackerId: EntityId;
    damage: number;
    x: number;
    y: number;
  };
  /**
   * A spell landed (GDD §9). Online-only: the offline sim has no mana or
   * cards, so nothing there ever emits it. `friendly` is POV-relative, so a
   * Bênção you cast and one the enemy cast do not read the same.
   */
  SpellCast: { spellId: string; x: number; y: number; radius: number; friendly: boolean };
  PlayerDefeated: { playerId: EntityId; team: Team };
  PlayerRespawned: { playerId: EntityId; x: number; y: number };
  BuffPickedUp: { playerId: EntityId; buff: BuffType; x: number; y: number };
  UnitsSelected: { ids: readonly EntityId[] };
  RoundStarted: { seed: number };
  RoundEnded: { winner: Team };
  GamePaused: { paused: boolean };
}

export type GameEventType = keyof GameEvents;
