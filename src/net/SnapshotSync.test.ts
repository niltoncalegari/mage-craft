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
import type { MageSnapshotDTO, ProjectileSnapshotDTO, SnapshotMsg, StructureSnapshotDTO } from './protocol';
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

function mage(over: Partial<MageSnapshotDTO> = {}): MageSnapshotDTO {
  return {
    id: 'mage-1',
    team: TEAM_A,
    position: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    health: 100,
    maxHealth: 100,
    charging: false,
    charge: 0,
    element: 'fire',
    role: 'damage',
    kills: 0,
    deaths: 0,
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

describe('SnapshotSync — mage respawn', () => {
  it('snaps a respawned mage to the spawn pad instead of easing the corpse across the arena', () => {
    const { sync, world, events } = makeSync(TEAM_A);
    const respawns: { x: number; y: number }[] = [];
    events.on('PlayerRespawned', (e) => respawns.push({ x: e.x, y: e.y }));

    sync.applySnapshot(snapshot({ mages: [mage({ position: { x: 4, y: -2 }, health: 100 })] }));
    sync.applySnapshot(
      snapshot({ tick: 6, mages: [mage({ position: { x: 4, y: -2 }, health: 0 })] }),
    );
    // Leave the corpse where it fell for a few frames of smoothing, then
    // teleport via respawn — the render pose must jump, not lerp.
    sync.tick(0.05);
    sync.applySnapshot(
      snapshot({
        tick: 12,
        mages: [mage({ position: { x: -16, y: 1 }, health: 100, facing: { x: 0, y: 1 } })],
      }),
    );

    const player = world.players[0];
    expect(player.alive).toBe(true);
    expect(player.position.x).toBeCloseTo(-16);
    expect(player.position.y).toBeCloseTo(1);
    expect(player.velocity.x).toBe(0);
    expect(player.velocity.y).toBe(0);
    expect(respawns).toEqual([{ x: -16, y: 1 }]);

    // Further smoothing must not pull the mage back toward the death spot.
    sync.tick(0.1);
    expect(player.position.x).toBeCloseTo(-16);
    expect(player.position.y).toBeCloseTo(1);
  });
});

/**
 * The renderer draws the hat band, staff gem and silhouette from these two
 * fields. They travel as bare strings, so an unknown value must land as
 * `undefined` — the figure then falls back to the team look. Anything else
 * (passing the raw string through) would index a palette with a missing key and
 * crash the whole render loop on one bad mage.
 */
describe('SnapshotSync — mage identity', () => {
  it('carries element and role onto the rendered mage', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ element: 'ice', role: 'tank' })] }));

    expect(world.players[0].element).toBe('ice');
    expect(world.players[0].role).toBe('tank');
  });

  it('drops values it does not recognize instead of passing them to the renderer', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ element: 'plasma', role: 'necromancer' })] }));

    expect(world.players[0].element).toBeUndefined();
    expect(world.players[0].role).toBeUndefined();
  });

  it('reads identity once — a later snapshot cannot swap a mage mid-match', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ element: 'fire', role: 'damage' })] }));
    sync.applySnapshot(
      snapshot({ tick: 6, mages: [mage({ element: 'poison', role: 'support' })] }),
    );

    expect(world.players[0].element).toBe('fire');
    expect(world.players[0].role).toBe('damage');
  });
});

describe('SnapshotSync — status effects', () => {
  it('carries the whole effect list onto the rendered mage, stacks included', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ fx: [{ k: 'burn', s: 3 }, { k: 'slow' }] })] }));

    expect(world.players[0].fx).toEqual([
      { kind: 'burn', stacks: 3 },
      // Omitted `s` means one stack — the wire's cheapest common case.
      { kind: 'slow', stacks: 1 },
    ]);
  });

  it('derives the three legacy booleans the older renderers read', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ fx: [{ k: 'haste' }, { k: 'shield' }] })] }));

    const p = world.players[0];
    expect(p.hasted).toBe(true);
    expect(p.shielded).toBe(true);
    expect(p.slowed).toBe(false);
  });

  it('clears an effect that stopped being sent', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: [mage({ fx: [{ k: 'slow' }] })] }));
    expect(world.players[0].slowed).toBe(true);

    sync.applySnapshot(snapshot({ tick: 6, mages: [mage()] }));
    expect(world.players[0].slowed).toBe(false);
    expect(world.players[0].fx).toEqual([]);
  });

  /**
   * The wire carries state, never events, so a broken shield has to be spotted
   * as a falling edge — the same trick `PlayerHit` plays with health. Without
   * it a Cleric stripping Escudo Arcano would produce no VFX at all.
   */
  it('emits ShieldBroken when a shield disappears off a living mage', () => {
    const { sync, events } = makeSync(TEAM_A);
    let fired = 0;
    events.on('ShieldBroken', () => fired++);

    sync.applySnapshot(snapshot({ mages: [mage({ fx: [{ k: 'shield' }] })] }));
    expect(fired).toBe(0);

    sync.applySnapshot(snapshot({ tick: 6, mages: [mage()] }));
    expect(fired).toBe(1);
  });

  it('stays quiet when the shield goes down with the mage', () => {
    const { sync, events } = makeSync(TEAM_A);
    let fired = 0;
    events.on('ShieldBroken', () => fired++);

    sync.applySnapshot(snapshot({ mages: [mage({ fx: [{ k: 'shield' }] })] }));
    sync.applySnapshot(snapshot({ tick: 6, mages: [mage({ health: 0 })] }));

    expect(fired).toBe(0);
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

/*
 * The squad dashboard reads its rows from here, not from the render World: a
 * mage's identity (roster, role), its tally and its respawn clock never reach
 * `world.players`. Row order also has to survive the whole match, since the
 * panel writes into four fixed rows per side.
 */
describe('SnapshotSync — squad', () => {
  const squadOf = (over: Partial<MageSnapshotDTO>[] = []): MageSnapshotDTO[] =>
    [
      mage({ id: 'mage-1', team: TEAM_A, rosterId: 'stone_golem', role: 'tank', maxHealth: 280, health: 280 }),
      mage({ id: 'mage-2', team: TEAM_A, rosterId: 'pyromancer', maxHealth: 80, health: 80 }),
      mage({ id: 'mage-9', team: TEAM_B, rosterId: 'cleric', role: 'support', maxHealth: 95, health: 95 }),
      mage({ id: 'mage-10', team: TEAM_B, rosterId: 'stormcaller', maxHealth: 60, health: 60 }),
    ].map((m, i) => ({ ...m, ...(over[i] ?? {}) }));

  it('exposes one row per mage with its identity and tally', () => {
    const { sync } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: squadOf([{ kills: 2, deaths: 1 }]) }));

    const [golem] = sync.squad;
    expect(sync.squad).toHaveLength(4);
    expect(golem).toMatchObject({
      wireId: 'mage-1',
      rosterId: 'stone_golem',
      role: 'tank',
      maxHealth: 280,
      kills: 2,
      deaths: 1,
      alive: true,
    });
  });

  it('mirrors POV so your own squad is Team.Player from either seat', () => {
    const a = makeSync(TEAM_A);
    a.sync.applySnapshot(snapshot({ mages: squadOf() }));
    expect(a.sync.squad.filter((m) => m.team === Team.Player).map((m) => m.wireId)).toEqual([
      'mage-1',
      'mage-2',
    ]);

    const b = makeSync(TEAM_B);
    b.sync.applySnapshot(snapshot({ mages: squadOf() }));
    expect(b.sync.squad.filter((m) => m.team === Team.Player).map((m) => m.wireId)).toEqual([
      'mage-9',
      'mage-10',
    ]);
  });

  // Not sorted by id on purpose: 'mage-10' sorts before 'mage-9'.
  it('keeps row order across snapshots, in first-seen order', () => {
    const { sync } = makeSync(TEAM_A);
    const order = (): string[] => sync.squad.map((m) => m.wireId);

    sync.applySnapshot(snapshot({ mages: squadOf() }));
    const first = order();
    sync.applySnapshot(snapshot({ tick: 6, mages: [...squadOf()].reverse() }));
    sync.applySnapshot(snapshot({ tick: 9, mages: squadOf() }));

    expect(first).toEqual(['mage-1', 'mage-2', 'mage-9', 'mage-10']);
    expect(order()).toEqual(first);
  });

  it('reports a downed mage with its respawn countdown', () => {
    const { sync } = makeSync(TEAM_A);
    sync.applySnapshot(
      snapshot({ mages: squadOf([{ health: 0, deaths: 1, respawnRemaining: 4.2 }]) }),
    );

    expect(sync.squad[0]).toMatchObject({ alive: false, deaths: 1, respawnRemaining: 4.2 });
  });

  it('treats the omitted respawn and immunity fields as absent, not undefined', () => {
    const { sync } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: squadOf() }));

    expect(sync.squad[0].respawnRemaining).toBe(0);
    expect(sync.squad[0].immune).toBe(false);
  });

  it('resolves a wire mage id to a render entity, and nothing for a stranger', () => {
    const { sync, world } = makeSync(TEAM_A);
    sync.applySnapshot(snapshot({ mages: squadOf() }));

    const entityId = sync.entityIdFor('mage-9');
    expect(entityId).not.toBeNull();
    expect(world.players.some((p) => p.id === entityId)).toBe(true);
    expect(sync.entityIdFor('mage-404')).toBeNull();
    expect(sync.entityIdFor(null)).toBeNull();
  });
});

/*
 * Teams are mirrored by POV, positions are not: whichever wire team you draw,
 * your squad comes out `Team.Player`, but the board renders exactly where the
 * server put it. A HUD pinned to one side would therefore be backwards for
 * whoever drew the other seat.
 */
describe('SnapshotSync — which half of the arena is yours', () => {
  it('reports the side your own Core actually stands on, from either seat', () => {
    const a = makeSync(TEAM_A);
    a.sync.applySnapshot(snapshot());
    expect(a.sync.mySide).toBe('left');

    const b = makeSync(TEAM_B);
    b.sync.applySnapshot(snapshot());
    expect(b.sync.mySide).toBe('right');
  });

  it('falls back to the left before any structure has arrived', () => {
    const { sync } = makeSync(TEAM_A);
    expect(sync.mySide).toBe('left');
  });
});
