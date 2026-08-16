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
  /**
   * A mage gained health this snapshot (GDD §8 — the Cleric's heal). Derived
   * on the client from the health delta the same way `PlayerHit` is, because
   * the wire carries health but never says who topped whom up. `healerId` is
   * the Cleric the client believes is responsible, or null when none is in
   * range — pickups and spells heal too.
   */
  MageHealed: { playerId: EntityId; healerId: EntityId | null; x: number; y: number };
  /**
   * An Escudo Arcano came down while its mage was still standing (GDD §8.7,
   * §9) — either drained by damage or stripped by a Cleric's light. Derived
   * from the falling edge of the shield effect, for the same reason
   * `MageHealed` is derived: the wire carries state, never events.
   */
  ShieldBroken: { playerId: EntityId; x: number; y: number };
  /**
   * A Core or Tower just fell (GDD §16). Derived on the client from the falling
   * edge of `alive`, for the same reason `ShieldBroken` is: the wire carries
   * state, never events. `team` is POV-relative like everything else here, so
   * losing your own Core and taking theirs do not read the same.
   *
   * The heaviest thing that happens in a match, and until the idle pivot it was
   * also the quietest — a tower simply stopped being drawn.
   */
  StructureDestroyed: {
    structureId: EntityId;
    kind: 'core' | 'tower';
    team: Team;
    x: number;
    y: number;
  };
  PlayerDefeated: { playerId: EntityId; team: Team };
  PlayerRespawned: { playerId: EntityId; x: number; y: number };
  BuffPickedUp: { playerId: EntityId; buff: BuffType; x: number; y: number };
  UnitsSelected: { ids: readonly EntityId[] };
  RoundStarted: { seed: number };
  RoundEnded: { winner: Team };
  GamePaused: { paused: boolean };
}

export type GameEventType = keyof GameEvents;
