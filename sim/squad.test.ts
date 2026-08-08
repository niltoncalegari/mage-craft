import { describe, expect, it } from 'vitest';
import { defaultSquad } from './cards';
import { SQUAD_SIZE } from './config';
import { validateSquad } from './squad';

describe('validateSquad', () => {
  it('accepts the default squad', () => {
    expect(validateSquad(defaultSquad())).toEqual({ ok: true });
  });

  it('rejects a squad of the wrong size', () => {
    const short = defaultSquad().slice(0, SQUAD_SIZE - 1);
    expect(validateSquad(short)).toEqual({
      ok: false,
      reason: `squad must hold ${SQUAD_SIZE} mages, got ${SQUAD_SIZE - 1}`,
    });
  });

  it('rejects unknown mages', () => {
    const squad = [...defaultSquad().slice(0, SQUAD_SIZE - 1), 'lich_king'];
    expect(validateSquad(squad)).toEqual({ ok: false, reason: 'unknown mage "lich_king"' });
  });

  it('rejects duplicates — unlike a deck, where they are the point', () => {
    expect(validateSquad(['pyromancer', 'pyromancer', 'stone_golem', 'cleric'])).toEqual({
      ok: false,
      reason: 'duplicate mage "pyromancer"',
    });
  });

  it('requires every role, since each one drives different behaviour', () => {
    // Legal size, no duplicates, all real mages — but no support.
    expect(validateSquad(['stone_golem', 'ice_sentinel', 'pyromancer', 'stormcaller'])).toEqual({
      ok: false,
      reason: 'squad needs at least one support',
    });
    // …and no tank.
    expect(validateSquad(['pyromancer', 'stormcaller', 'cleric', 'arcane_bard'])).toEqual({
      ok: false,
      reason: 'squad needs at least one tank',
    });
  });

  it('accepts any composition that satisfies the floor', () => {
    expect(validateSquad(['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'])).toEqual({ ok: true });
  });
});
