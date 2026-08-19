import { describe, expect, it } from 'vitest';
import { bestComps, castsByMage, mostUsedCards, type MatchRecord } from './matchHistory';

function record(over: Partial<MatchRecord>): MatchRecord {
  return {
    at: 0,
    mode: 'pvp',
    won: false,
    squad: ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'],
    cards: [],
    kills: 0,
    deaths: 0,
    durationSeconds: 120,
    structuresDestroyed: 0,
    ...over,
  };
}

describe('bestComps', () => {
  it('groups by squad regardless of pick order', () => {
    const a = record({ won: true, squad: ['cleric', 'stone_golem', 'pyromancer', 'stormcaller'] });
    const b = record({ won: false, squad: ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'] });

    const comps = bestComps([a, b]);

    expect(comps).toHaveLength(1);
    expect(comps[0].games).toBe(2);
    expect(comps[0].wins).toBe(1);
    expect(comps[0].winRate).toBe(0.5);
  });

  it('hides comps below the sample floor', () => {
    const played = [record({ won: true }), record({ won: true })];
    const oneOff = record({ won: true, squad: ['ice_sentinel', 'alchemist', 'wind_dervish', 'arcane_bard'] });

    const comps = bestComps([...played, oneOff]);

    expect(comps).toHaveLength(1);
    expect(comps[0].squad).toContain('stone_golem');
  });

  it('ranks by win rate, breaking ties on games played', () => {
    const winner = Array.from({ length: 2 }, () => record({ won: true }));
    const loser = Array.from({ length: 3 }, () =>
      record({ won: false, squad: ['ice_sentinel', 'alchemist', 'wind_dervish', 'arcane_bard'] }),
    );

    const comps = bestComps([...loser, ...winner]);

    expect(comps.map((c) => c.winRate)).toEqual([1, 0]);
  });

  it('counts a draw as a game but not a win', () => {
    const comps = bestComps([record({ won: null }), record({ won: true })]);

    expect(comps[0]).toMatchObject({ games: 2, wins: 1 });
  });
});

describe('mostUsedCards', () => {
  it('sums casts across matches, most-cast first', () => {
    const first = record({
      cards: [
        { cardId: 'plague', casts: 3 },
        { cardId: 'blessing', casts: 1 },
      ],
    });
    const second = record({
      cards: [
        { cardId: 'blessing', casts: 5 },
        { cardId: 'plague', casts: 1 },
      ],
    });

    expect(mostUsedCards([first, second])).toEqual([
      { cardId: 'blessing', casts: 6 },
      { cardId: 'plague', casts: 4 },
    ]);
  });

  it('drops cards that were never cast', () => {
    expect(mostUsedCards([record({ cards: [{ cardId: 'blessing', casts: 0 }] })])).toEqual([]);
  });
});

describe('castsByMage', () => {
  /*
   * The question the pivot made askable, and the reason `rosterId` rides along
   * with `cardId` on every stored cast: not "which spell got spent" but "which
   * body earned its slot".
   */
  it('credits a spell to the mage whose kit holds it', () => {
    const r = record({
      cards: [
        { cardId: 'volcanic_eruption', rosterId: 'pyromancer', casts: 3 },
        { cardId: 'meteor_shower', rosterId: 'pyromancer', casts: 2 },
        { cardId: 'blessing', rosterId: 'cleric', casts: 7 },
      ],
    });

    expect(castsByMage([r])).toEqual([
      { rosterId: 'cleric', casts: 7 },
      { rosterId: 'pyromancer', casts: 5 },
    ]);
  });

  /*
   * History predates the pivot, so most stored rows carry a `cardId` and no
   * `rosterId` at all. Dropping them would make the panel go blank for exactly
   * the players with the most history. Kits are disjoint and cover the
   * catalog — `kits.test.ts` holds both — so the catalog can answer for them.
   */
  it('falls back to the catalog for records saved before mages owned spells', () => {
    const legacy = record({ cards: [{ cardId: 'petrify', casts: 4 }] });

    expect(castsByMage([legacy])).toEqual([{ rosterId: 'ice_sentinel', casts: 4 }]);
  });

  it('drops a cast whose card no kit claims, rather than inventing an owner', () => {
    const orphan = record({ cards: [{ cardId: 'not_a_spell' as never, casts: 9 }] });

    expect(castsByMage([orphan])).toEqual([]);
  });
});
