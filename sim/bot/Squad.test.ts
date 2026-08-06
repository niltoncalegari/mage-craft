import { describe, expect, it } from 'vitest';
import { defaultSquad } from '../cards';
import { SIM_DT, TOWER_RANGE } from '../config';
import { TEAM_A, TEAM_B, type Structure } from '../entities';
import { Vec2 } from '../Vec2';
import { World } from '../World';
import { coveringTower, isOurGround, siegeProgress, SquadPlanner } from './Squad';

/** A siege world with both squads on the board, planned once. */
function planned(mutate: (w: World) => void = () => {}): { w: World; planner: SquadPlanner } {
  const w = new World();
  w.initSquad(TEAM_A, defaultSquad());
  w.initSquad(TEAM_B, defaultSquad());
  mutate(w);

  const planner = new SquadPlanner();
  planner.step(w, SIM_DT);
  return { w, planner };
}

function towersOf(w: World, team: typeof TEAM_A | typeof TEAM_B): Structure[] {
  return w.structuresOf(team).filter((s) => s.kind === 'tower');
}

describe('SquadPlanner — one objective for the whole squad', () => {
  /*
   * The reason this layer exists. Four mages each walking at whichever Tower is
   * nearest splits the squad two-and-two, and neither half out-damages a
   * Tower's own defence — which is exactly why no structure ever fell.
   */
  it('gives every mage on a team the same objective', () => {
    const { planner } = planned();

    const a = planner.planFor(TEAM_A).objective;
    const b = planner.planFor(TEAM_B).objective;

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // …and each side is pushing the *other* side's structure.
    expect(a?.team).toBe(TEAM_B);
    expect(b?.team).toBe(TEAM_A);
  });

  it('commits to the Tower already taking damage, not the closer one', () => {
    const [first, second] = towersOf(new World(), TEAM_B);
    // Park the squad right next to the untouched Tower, so distance alone would
    // pick it, and put a real dent in the far one.
    const { planner } = planned((w) => {
      const towers = towersOf(w, TEAM_B);
      const near = towers.find((t) => t.id === first.id)!;
      const far = towers.find((t) => t.id === second.id)!;
      far.health = far.maxHealth * 0.2;
      for (const m of w.mages.values()) {
        if (m.team === TEAM_A) m.position = near.position.add(new Vec2(-3, 0));
      }
    });

    expect(planner.planFor(TEAM_A).objective?.id).toBe(second.id);
  });

  it('re-plans immediately when the objective falls rather than waiting out the interval', () => {
    const { w, planner } = planned();
    const first = planner.planFor(TEAM_A).objective!;

    first.alive = false;
    // Far less than PLAN_INTERVAL: a squad still walking at a dead Tower is the
    // one staleness that is visibly broken.
    planner.step(w, SIM_DT);

    expect(planner.planFor(TEAM_A).objective?.id).not.toBe(first.id);
  });
});

describe('SquadPlanner — posture', () => {
  it('pushes by default, so a match can actually resolve', () => {
    const { planner } = planned();
    expect(planner.planFor(TEAM_A).posture).toBe('push');
  });

  /*
   * Both sides pushing is a race, and a race ends. Both sides defending is the
   * 100%-draw deadlock GDD §14 warns about, so only the side that is measurably
   * behind is allowed to turn around.
   */
  it('only the side losing the race turns around to defend', () => {
    const { w, planner } = planned((w) => {
      // B is most of a Tower ahead…
      towersOf(w, TEAM_A)[0].health = towersOf(w, TEAM_A)[0].maxHealth * 0.2;
      // …and is standing in A's ground to prove it.
      for (const m of w.mages.values()) {
        if (m.team === TEAM_B) m.position = towersOf(w, TEAM_A)[0].position.add(new Vec2(3, 0));
      }
    });
    planner.step(w, SIM_DT);

    expect(planner.planFor(TEAM_A).posture).toBe('defend');
    expect(planner.planFor(TEAM_A).threat).not.toBeNull();
    // The side that is ahead keeps pushing — that is what breaks the deadlock.
    expect(planner.planFor(TEAM_B).posture).toBe('push');
  });

  it('falls back instead of feeding when outnumbered on the field', () => {
    const { planner } = planned((w) => {
      let killed = 0;
      for (const m of w.mages.values()) {
        if (m.team === TEAM_A && killed < 2) {
          m.alive = false;
          killed++;
        }
      }
    });

    expect(planner.planFor(TEAM_A).posture).toBe('regroup');
  });

  it('rallies on our own side of the map, in front of a structure we still hold', () => {
    const { w, planner } = planned();
    const rally = planner.planFor(TEAM_A).rally;

    // Team A defends the -x side (siege1.json), so falling back means -x…
    expect(rally.x).toBeLessThan(0);
    // …and the point sits inside one of our own Towers' cover, which is what
    // makes falling back an ambush rather than a surrender.
    expect(coveringTower(w, TEAM_B, rally)).not.toBeNull();
  });
});

describe('SquadPlanner — the anchor', () => {
  /*
   * A Tower shoots whatever is nearest that it can see (World.towerTarget), so
   * naming an anchor is the only lever the AI has over *which* mage takes ~9
   * damage a second. It goes to the role built to absorb it.
   */
  it('names the tank, not whoever happens to be closest', () => {
    const { w, planner } = planned((w) => {
      const objective = towersOf(w, TEAM_B)[0];
      for (const m of w.mages.values()) {
        // Put a squishy right on top of the Tower and the tank far away.
        if (m.team === TEAM_A && m.role === 'damage') m.position = objective.position.add(new Vec2(-2, 0));
        if (m.team === TEAM_A && m.role === 'tank') m.position = new Vec2(-20, 0);
      }
    });
    planner.step(w, SIM_DT);

    const anchor = w.mage(planner.planFor(TEAM_A).anchorId);
    expect(anchor?.role).toBe('tank');
  });

  it('names nobody when the squad has no unit built to soak', () => {
    const { w, planner } = planned((w) => {
      for (const m of w.mages.values()) if (m.role === 'tank') m.alive = false;
    });
    planner.step(w, SIM_DT);

    // No anchor means no dive: the squad works the Tower from outside its
    // range instead of trading mages for it (see Brain.siegeStandoff).
    expect(planner.planFor(TEAM_A).anchorId).toBe('');
  });
});

describe('Tower threat', () => {
  it('reports the Tower covering a point, and nothing outside its range', () => {
    const w = new World();
    const tower = towersOf(w, TEAM_B)[0];

    const inside = tower.position.add(new Vec2(-TOWER_RANGE * 0.5, 0));
    const outside = tower.position.add(new Vec2(-(TOWER_RANGE + 2), 0));

    expect(coveringTower(w, TEAM_A, inside)?.id).toBe(tower.id);
    expect(coveringTower(w, TEAM_A, outside)).toBeNull();
    // Our own Towers are cover, not threat.
    expect(coveringTower(w, TEAM_B, inside)).toBeNull();
  });

  it('stops reporting a Tower once it is down', () => {
    const w = new World();
    const tower = towersOf(w, TEAM_B)[0];
    const inside = tower.position.add(new Vec2(-TOWER_RANGE * 0.5, 0));
    tower.alive = false;

    expect(coveringTower(w, TEAM_A, inside)).toBeNull();
  });

  it('knows our own ground from theirs', () => {
    const w = new World();
    const ours = w.structuresOf(TEAM_A)[0].position;
    const theirs = w.structuresOf(TEAM_B)[0].position;

    expect(isOurGround(w, TEAM_A, ours)).toBe(true);
    expect(isOurGround(w, TEAM_A, theirs)).toBe(false);
  });
});

describe('siegeProgress — who is winning the race', () => {
  it('counts a felled structure as worth more than a damaged one', () => {
    const w = new World();
    const [first, second] = towersOf(w, TEAM_B);

    second.health = second.maxHealth * 0.5;
    expect(siegeProgress(w, TEAM_A)).toBeCloseTo(0.5, 5);

    first.alive = false;
    expect(siegeProgress(w, TEAM_A)).toBeCloseTo(1.5, 5);
  });

  it('starts level, so neither side opens the match already behind', () => {
    const w = new World();
    expect(siegeProgress(w, TEAM_A)).toBe(0);
    expect(siegeProgress(w, TEAM_B)).toBe(0);
  });
});
