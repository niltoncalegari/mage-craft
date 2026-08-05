/**
 * Covers the two things the siege snapshot added that a renderer cannot check
 * for itself: which side of the board is *yours*, and the per-player match state
 * the card bar is drawn from.
 *
 * The POV mapping matters more than it looks. Before the pivot it was inferred
 * from the local player's own mage; a player has no mage now, so a wrong default
 * would mirror the whole board — you would be shown the enemy Core as your own
 * and defend the wrong flank.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import { createEmptyArena } from '../game/Arena';
import { Team } from '../game/types';
import { World } from '../game/World';
import type { SnapshotMsg, StructureSnapshotDTO } from './protocol';
import { SnapshotSync } from './SnapshotSync';

const TEAM_A = 0;
const TEAM_B = 1;

function structure(team: number, kind: 'core' | 'tower', over: Partial<StructureSnapshotDTO> = {}): StructureSnapshotDTO {
  return {
    id: `${kind}-${team}`,
    team,
    kind,
    position: { x: team === TEAM_A ? -17 : 17, y: 0 },
    radius: kind === 'core' ? 1.6 : 1.1,
    health: kind === 'core' ? 900 : 400,
    maxHealth: kind === 'core' ? 900 : 400,
    alive: true,
    invulnerable: kind === 'core',
    ...over,
  };
}

function snapshot(over: Partial<SnapshotMsg> = {}): SnapshotMsg {
  return {
    type: 'snapshot',
    tick: 3,
    mages: [],
    projectiles: [],
    puddles: [],
    structures: [structure(TEAM_A, 'core'), structure(TEAM_B, 'core')],
    elapsed: 12.5,
    suddenDeath: false,
    mana: 6,
    hand: ['stone_golem', 'pyromancer', 'cleric', 'wind_dervish'],
    next: 'arcane_archer',
    ...over,
  };
}

function makeSync(localTeam: number | null): { sync: SnapshotSync; world: World } {
  const world = new World(createEmptyArena(), 1);
  return { sync: new SnapshotSync(world, 'me', new EventBus(), localTeam), world };
}

describe('SnapshotSync — structures', () => {
  it('shows the commanded team as its own, whichever side that is', () => {
    const a = makeSync(TEAM_A);
    a.sync.applySnapshot(snapshot());
    expect(a.world.structures.find((s) => s.position.x < 0)?.team).toBe(Team.Player);
    expect(a.world.structures.find((s) => s.position.x > 0)?.team).toBe(Team.Enemy);

    // The same wire data, seen from the other seat, has to come out mirrored.
    const b = makeSync(TEAM_B);
    b.sync.applySnapshot(snapshot());
    expect(b.world.structures.find((s) => s.position.x > 0)?.team).toBe(Team.Player);
    expect(b.world.structures.find((s) => s.position.x < 0)?.team).toBe(Team.Enemy);
  });

  it('creates each structure once and then only updates it', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot());
    sync.applySnapshot(snapshot({ tick: 6, structures: [structure(TEAM_A, 'core', { health: 420 })] }));

    expect(world.structures).toHaveLength(2);
    expect(world.structures.find((s) => s.team === Team.Player)?.health).toBe(420);
  });

  it('keeps a destroyed structure in the world so the map can show the loss', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot());
    sync.applySnapshot(
      snapshot({
        tick: 6,
        structures: [structure(TEAM_B, 'tower', { health: 0, alive: false, invulnerable: false })],
      }),
    );

    const tower = world.structures.find((s) => s.kind === 'tower');
    expect(tower?.alive).toBe(false);
    expect(world.structures).toHaveLength(3);
  });
});

describe('SnapshotSync — match state', () => {
  it('carries mana, the clock and the hand straight off the wire', () => {
    const { sync } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot());

    expect(sync.matchState).toEqual({
      mana: 6,
      elapsed: 12.5,
      suddenDeath: false,
      hand: ['stone_golem', 'pyromancer', 'cleric', 'wind_dervish'],
      next: 'arcane_archer',
    });
  });

  it('reports an empty hand before the first snapshot, not a stale one', () => {
    const { sync } = makeSync(null);
    expect(sync.matchState.hand).toEqual([]);

    sync.applySnapshot(snapshot({ hand: [], next: undefined, mana: 0 }));
    expect(sync.matchState.next).toBeNull();
  });
});
