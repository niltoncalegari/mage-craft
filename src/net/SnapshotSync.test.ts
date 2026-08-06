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
import type { ProjectileSnapshotDTO, SnapshotMsg, StructureSnapshotDTO } from './protocol';
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
    spells: [],
    structures: [structure(TEAM_A, 'core'), structure(TEAM_B, 'core')],
    elapsed: 12.5,
    suddenDeath: false,
    mana: 6,
    hand: ['stone_golem', 'pyromancer', 'cleric', 'wind_dervish'],
    next: 'arcane_archer',
    ...over,
  };
}

function projectile(over: Partial<ProjectileSnapshotDTO> = {}): ProjectileSnapshotDTO {
  return {
    id: 'proj-1',
    element: 'fire',
    position: { x: 0, y: 0 },
    velocity: { x: 10, y: 0 },
    height: 1.4,
    radius: 0.22,
    ...over,
  };
}

function makeSync(localTeam: number | null): { sync: SnapshotSync; world: World; events: EventBus } {
  const world = new World(createEmptyArena(), 1);
  const events = new EventBus();
  return { sync: new SnapshotSync(world, 'me', events, localTeam), world, events };
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

/**
 * A buff or curse applies instantly, so the wire carries a *marker* that
 * lingers for a second rather than an event — the client is what turns it back
 * into a one-shot.
 */
describe('SnapshotSync — spell casts', () => {
  const cast = { id: 'cast-1', spellId: 'blessing', team: TEAM_A, position: { x: 3, y: -2 }, radius: 4 };

  it('fires a cast once, however many snapshots repeat it', () => {
    const { sync, events } = makeSync(TEAM_A);
    const seen: string[] = [];
    events.on('SpellCast', (e) => seen.push(e.spellId));

    sync.applySnapshot(snapshot({ spells: [cast] }));
    sync.applySnapshot(snapshot({ tick: 6, spells: [cast] }));
    sync.applySnapshot(snapshot({ tick: 9, spells: [cast] }));

    expect(seen).toEqual(['blessing']);
  });

  it('tells your own cast from the opponent’s, POV-relative like everything else', () => {
    const mine = makeSync(TEAM_A);
    const theirs = makeSync(TEAM_B);
    const friendly: boolean[] = [];
    mine.events.on('SpellCast', (e) => friendly.push(e.friendly));
    theirs.events.on('SpellCast', (e) => friendly.push(e.friendly));

    mine.sync.applySnapshot(snapshot({ spells: [cast] }));
    theirs.sync.applySnapshot(snapshot({ spells: [cast] }));

    expect(friendly).toEqual([true, false]);
  });

  it('forgets a cast once it drops out, so a reused id would still fire', () => {
    const { sync, events } = makeSync(TEAM_A);
    let fired = 0;
    events.on('SpellCast', () => fired++);

    sync.applySnapshot(snapshot({ spells: [cast] }));
    sync.applySnapshot(snapshot({ tick: 6, spells: [] }));
    sync.applySnapshot(snapshot({ tick: 9, spells: [cast] }));

    expect(fired).toBe(2);
  });
});

describe('SnapshotSync — projectiles', () => {
  it('flies at the height the server sent instead of sliding along the ground', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ projectiles: [projectile({ height: 1.4, radius: 0.3 })] }));

    // Height is what makes a spell arc, cast a shadow and shed a tail at all.
    expect(world.snowballs[0].height).toBeCloseTo(1.4);
    expect(world.snowballs[0].radius).toBe(0.3);
  });

  it('carries a projectile forward and ages it between snapshots', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ projectiles: [projectile({ velocity: { x: 10, y: 0 } })] }));

    sync.tick(0.1);

    // Nothing else advances a projectile online — there is no local
    // ProjectileSystem — so without this it would stutter at the 20Hz snapshot
    // rate and, since the tail is spawned off `age`, shed nothing.
    expect(world.snowballs[0].position.x).toBeCloseTo(1, 5);
    expect(world.snowballs[0].age).toBeCloseTo(0.1, 5);
  });

  it('reports the impact where the projectile actually was', () => {
    const { sync, events } = makeSync(TEAM_A);
    const impacts: { x: number; element?: string }[] = [];
    events.on('SnowballImpact', (e) => impacts.push({ x: e.x, element: e.element }));

    sync.applySnapshot(snapshot({ projectiles: [projectile({ position: { x: 5, y: 0 } })] }));
    sync.applySnapshot(snapshot({ tick: 6, projectiles: [] }));

    expect(impacts).toEqual([{ x: 5, element: 'fire' }]);
  });
});
