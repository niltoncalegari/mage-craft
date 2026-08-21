import { describe, expect, it } from 'vitest';
import { defaultSquad } from '../cards';
import { SIM_DT, TOWER_RANGE } from '../config';
import { TEAM_A, TEAM_B, type Structure } from '../entities';
import { ROLE_BEHAVIOR } from '../roles';
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

describe('SquadPlanner — the detachment', () => {
  /*
   * The failure this answers: two squads sieging each other's Towers at the
   * same pace are, by `choosePosture`, both "not behind", so both keep pushing
   * and *nobody* ever walks back to a Tower being dismantled behind them. The
   * whole-squad posture could not express it — turning the squad around loses
   * the race, and not turning loses the Tower. So the answer is neither: a
   * sized piece of the squad peels off and the rest keep pushing.
   */
  it('sends someone home to an intruder even while the squad is pushing', () => {
    const { w, planner } = planned((w) => {
      // Level race — neither side is behind, so posture stays `push`…
      const raider = [...w.mages.values()].find((m) => m.team === TEAM_B && m.role === 'damage')!;
      // …and one of B's mages is standing on A's Tower anyway.
      raider.position = towersOf(w, TEAM_A)[0].position.add(new Vec2(2, 0));
    });
    planner.step(w, SIM_DT);
    const plan = planner.planFor(TEAM_A);

    expect(plan.posture).toBe('push');
    expect(plan.defenderIds.length).toBe(1);
  });

  /*
   * The guard that keeps this from re-introducing the deadlock the posture
   * model was shaped to avoid. If a whole enemy squad piling into our ground
   * could recall our whole squad, then two squads doing it to each other is
   * four mages walking home on both sides and neither Tower ever falling.
   */
  it('always leaves someone on the push, however many crossed', () => {
    const { w, planner } = planned((w) => {
      const tower = towersOf(w, TEAM_A)[0];
      let n = 0;
      for (const m of w.mages.values()) {
        if (m.team === TEAM_B) m.position = tower.position.add(new Vec2(2 + n++ * 0.5, 0));
      }
    });
    planner.step(w, SIM_DT);
    const plan = planner.planFor(TEAM_A);

    const attackers = [...w.mages.values()].filter(
      (m) => m.team === TEAM_A && m.alive && ROLE_BEHAVIOR[m.role].attacks,
    );
    expect(plan.intruders.length).toBeGreaterThanOrEqual(attackers.length);
    expect(plan.defenderIds.length).toBe(attackers.length - 1);
  });

  it('recalls the anchor last — it is the one soaking the objective', () => {
    const { w, planner } = planned((w) => {
      const raider = [...w.mages.values()].find((m) => m.team === TEAM_B && m.role === 'damage')!;
      raider.position = towersOf(w, TEAM_A)[0].position.add(new Vec2(2, 0));
      // Park the tank right on top of the raider, so distance alone would
      // elect it — and it is the anchor, so it must still be passed over.
      const tank = [...w.mages.values()].find((m) => m.team === TEAM_A && m.role === 'tank')!;
      tank.position = raider.position.add(new Vec2(-1, 0));
    });
    planner.step(w, SIM_DT);
    const plan = planner.planFor(TEAM_A);

    expect(plan.anchorId).not.toBe('');
    expect(plan.defenderIds).not.toContain(plan.anchorId);
  });

  /*
   * Sizing the detachment is only half of it: two defenders both walking at the
   * *deepest* raider leaves the second one taking a Tower apart unopposed. Each
   * intruder gets its own answer, nearest body first.
   */
  it('pairs each defender to an intruder rather than dogpiling the deepest', () => {
    const w = new World();
    const [south, north] = towersOf(w, TEAM_A);

    // Two raiders, one on each of our Towers; the southern one is deeper, so
    // it is `threat` and the naive pick would send everyone at it.
    w.summon(TEAM_B, 'pyromancer', south.position.add(new Vec2(2, 0)));
    w.summon(TEAM_B, 'pyromancer', north.position.add(new Vec2(3, 0)));

    // Two of ours are near the southern raider, one near the northern.
    const southA = w.summon(TEAM_A, 'pyromancer', south.position.add(new Vec2(2, 2)));
    w.summon(TEAM_A, 'pyromancer', south.position.add(new Vec2(2, -2)));
    const northA = w.summon(TEAM_A, 'pyromancer', north.position.add(new Vec2(3, -2)));

    const planner = new SquadPlanner();
    planner.step(w, SIM_DT);
    const plan = planner.planFor(TEAM_A);

    expect(plan.defenderIds).toEqual([southA.id, northA.id].sort());
  });

  /*
   * A squad that answers a raider by sending its healer has answered it twice
   * over: the raider still gets fought by one body, and the push it left loses
   * the only thing keeping the anchor alive under Tower fire. So a support goes
   * home only when it is the one that is meaningfully closer.
   */
  it('sends the damage dealer home and keeps the support on the push', () => {
    const w = new World();
    const home = towersOf(w, TEAM_A)[0];
    const raider = w.summon(TEAM_B, 'pyromancer', home.position.add(new Vec2(2, 0)));

    // The support is nearer the raider than the damage dealer is…
    const support = w.summon(TEAM_A, 'cleric', raider.position.add(new Vec2(3, 0)));
    const dealer = w.summon(TEAM_A, 'pyromancer', raider.position.add(new Vec2(6, 0)));
    // …and a third body, so the "someone always pushes" floor leaves room for one.
    w.summon(TEAM_A, 'pyromancer', new Vec2(8, 0));

    const planner = new SquadPlanner();
    planner.step(w, SIM_DT);
    const plan = planner.planFor(TEAM_A);

    expect(plan.defenderIds).toContain(dealer.id);
    expect(plan.defenderIds).not.toContain(support.id);
  });

  it('leaves nobody behind when nobody has crossed', () => {
    const { planner } = planned();
    expect(planner.planFor(TEAM_A).defenderIds).toEqual([]);
  });
});
