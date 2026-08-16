/**
 * Turning a `World` into the bytes a client renders.
 *
 * This used to live in two halves that had to agree without ever saying so:
 * `Session.buildSnapshot` produced the plain-data view, and
 * `App.broadcastSnapshot` re-shaped it into the wire DTO — including the
 * omit-when-zero rules that exist nowhere else. Anything that renders a match
 * without a socket in the middle (local practice, a replay, a headless probe)
 * had no way to reach that logic.
 *
 * Both halves now live here, next to the sim they describe, and the server is
 * one of the callers rather than the owner.
 */

import type { EffectKind } from './effects';
import { TEAM_A, TEAM_B } from './entities';
import type { ElementId } from './elements';
import type { RosterId } from './cards';
import type { FiredRuleDTO, SnapshotMsg } from './protocol';
import { fromVec2 } from './protocol';
import { Vec2 } from './Vec2';
import type { World } from './World';

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
  /** Mana per team, indexed by team number — the caller picks the receiver's. */
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
  /**
   * Every status effect currently on this mage (GDD §9), in `EFFECT_ORDER`.
   * This replaced three booleans (shielded/hasted/slowed): a client that reads
   * the list can show a burn or a stun the day it is added to `balance.json`,
   * with no protocol change.
   */
  fx: MageFxState[];
  /** Enemy mages this one put down (GDD §4); see `World.kill` for who gets credited. */
  kills: number;
  /** Times this mage was put down. A team's kill total is the enemy's sum of these. */
  deaths: number;
  /** Seconds until it returns; 0 while alive. The wire omits it when 0. */
  respawnRemaining: number;
  /** Post-respawn damage immunity is running. The wire omits it when false. */
  immune: boolean;
}

/** One running effect, flattened for the wire: kind and how many stacks deep. */
export interface MageFxState {
  kind: EffectKind;
  stacks: number;
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

/** Reads the whole world into a transport-free snapshot. */
export function buildSnapshot(world: World, tick: number): Snapshot {
  return {
    tick,
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
      fx: m.effects.map((e) => ({ kind: e.kind, stacks: e.stacks })),
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

/** The per-receiver half of a snapshot: your bar, your cards, never the opponent's. */
export interface SnapshotView {
  mana: number;
  hand: string[];
  next?: string | null;
  /**
   * The rule that last cast for this receiver, or null when none has. Rides the
   * per-receiver channel for the same reason mana and hand do: a program is its
   * author's, and the opponent must not read it off the wire.
   */
  firedRule?: FiredRuleDTO | null;
}

/** Shapes a snapshot into the wire message for one receiver. */
export function toSnapshotMsg(snap: Snapshot, view: SnapshotView): SnapshotMsg {
  return {
    type: 'snapshot',
    tick: snap.tick,
    elapsed: snap.elapsed,
    suddenDeath: snap.suddenDeath,
    structures: snap.structures.map((s) => ({
      id: s.id,
      team: s.team,
      kind: s.kind,
      position: fromVec2(s.position),
      radius: s.radius,
      health: s.health,
      maxHealth: s.maxHealth,
      alive: s.alive,
      invulnerable: s.invulnerable,
    })),
    mages: snap.mages.map((m) => ({
      id: m.id,
      team: m.team,
      position: fromVec2(m.position),
      facing: fromVec2(m.facing),
      health: m.health,
      maxHealth: m.maxHealth,
      charging: m.charging,
      charge: m.charge,
      element: m.element,
      role: m.role,

      kills: m.kills,
      deaths: m.deaths,
      ...(m.rosterId ? { rosterId: m.rosterId } : {}),
      // Omitted rather than sent empty/0/false: this rides 20 times a second
      // for eight mages, and all three are the exception, not the rule. A mage
      // with no effects on it now costs nothing, where the three booleans it
      // replaced always cost three fields.
      ...(m.fx.length > 0
        ? { fx: m.fx.map((e) => (e.stacks > 1 ? { k: e.kind, s: e.stacks } : { k: e.kind })) }
        : {}),
      ...(m.respawnRemaining > 0 ? { respawnRemaining: m.respawnRemaining } : {}),
      ...(m.immune ? { immune: true } : {}),
    })),
    projectiles: snap.projectiles.map((p) => ({
      id: p.id,
      element: p.element,
      position: fromVec2(p.position),
      velocity: fromVec2(p.velocity),
      height: p.height,
      radius: p.radius,
    })),
    puddles: snap.puddles.map((pu) => ({
      id: pu.id,
      position: fromVec2(pu.position),
      radius: pu.radius,
      remaining: pu.remaining,
    })),
    spells: snap.spells.map((fx) => ({
      id: fx.id,
      spellId: fx.spellId,
      team: fx.team,
      position: fromVec2(fx.position),
      radius: fx.radius,
    })),
    mana: view.mana,
    hand: view.hand,
    ...(view.next ? { next: view.next } : {}),
    ...(view.firedRule ? { firedRule: view.firedRule } : {}),
  };
}
