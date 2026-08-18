/**
 * The loadout store, with the parts that only matter because it is read on
 * every boot from storage nobody controls: the migrations forward from v1 and
 * v2, and what happens when a stored part is not something this build can read.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSquad } from '../../sim/cards';
import { DEFAULT_LOADOUT_ID, loadLoadout, loadStore, saveStances, saveStore } from './loadout';

const V1_KEY = 'mage-craft.loadout.v1';
const V2_KEY = 'mage-craft.loadout.v2';
const V3_KEY = 'mage-craft.loadout.v3';

const SQUAD = ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'];
/** A legal v2 deck, kept only so the migration has a real v2 record to drop. */
const WHITE_RED_DECK = [
  'blessing',
  'blessing',
  'arcane_shield',
  'arcane_shield',
  'overload_field',
  'overload_field',
  'meteor_shower',
  'meteor_shower',
];

/*
 * The suite runs on `environment: 'node'` deliberately (see vite.config.ts), and
 * this is the only module under test that needs Web Storage. A ten-line stub
 * beats pulling in a whole DOM for one API with four methods — and it makes the
 * "quota exceeded" path reachable, which a real localStorage does not.
 */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('loadLoadout — defaults', () => {
  it('gives a fresh device a playable squad standing at the default posture', () => {
    const loadout = loadLoadout();

    expect(loadout.squad).toEqual(defaultSquad());
    // Empty rather than four explicit `normal` entries: absence *is* `normal`,
    // and writing it out would make "the player chose this" indistinguishable
    // from "nobody has opened the builder yet".
    expect(loadout.stances).toEqual({});
  });
});

describe('loadStore — migrating forward', () => {
  it('carries a v1 squad forward and drops the deck with it', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: SQUAD, deck: WHITE_RED_DECK }));

    const loadout = loadLoadout();

    expect(loadout.id).toBe(DEFAULT_LOADOUT_ID);
    expect(loadout.squad).toEqual(SQUAD);
    // The deck is not translated into anything. There is no hand to play, so
    // nothing it said has a v3 meaning to be preserved into.
    expect('deck' in loadout).toBe(false);
    expect(loadout.stances).toEqual({});
  });

  it('carries a v2 squad forward and drops the program with it', () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        loadouts: [
          { id: 'x', name: 'X', squad: SQUAD, deck: WHITE_RED_DECK, strategy: { rules: [] } },
        ],
        activeLoadoutId: 'x',
      }),
    );

    const loadout = loadLoadout();

    expect(loadout.id).toBe('x');
    expect(loadout.squad).toEqual(SQUAD);
    expect('strategy' in loadout).toBe(false);
  });

  it('prefers v2 over v1 when a device upgraded through both', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: defaultSquad() }));
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({ loadouts: [{ id: 'x', name: 'X', squad: SQUAD }], activeLoadoutId: 'x' }),
    );

    // v2 is the later of the two, so reading v1 would hand back a squad the
    // player replaced.
    expect(loadLoadout().squad).toEqual(SQUAD);
  });

  it('persists the migration, so the old keys are read exactly once', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: SQUAD }));
    loadStore();

    expect(localStorage.getItem(V3_KEY)).toBeTruthy();

    // With v1 gone the v3 copy is what answers — proof the read is not falling
    // through to the migration a second time.
    localStorage.removeItem(V1_KEY);
    expect(loadLoadout().squad).toEqual(SQUAD);
  });

  it('falls back per part, so a corrupt v1 squad still yields a profile', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: ['not_a_mage'] }));

    expect(loadLoadout().squad).toEqual(defaultSquad());
  });
});

describe('loadStore — a hand-edited store', () => {
  it('degrades an illegal part to the default instead of shipping it', () => {
    localStorage.setItem(
      V3_KEY,
      JSON.stringify({
        loadouts: [{ id: 'x', name: 'X', squad: ['not_a_mage'], stances: { cleric: 'hold' } }],
        activeLoadoutId: 'x',
      }),
    );

    const loadout = loadLoadout();

    // The squad falls back on its own; the postures beside it are legal and
    // survive, which is the whole point of cleaning part by part.
    expect(loadout.squad).toEqual(defaultSquad());
    expect(loadout.stances).toEqual({ cleric: 'hold' });
  });

  it('drops only the posture entries it cannot read', () => {
    localStorage.setItem(
      V3_KEY,
      JSON.stringify({
        loadouts: [
          {
            id: 'x',
            name: 'X',
            squad: defaultSquad(),
            stances: { cleric: 'hold', pyromancer: 'berserk', lich_king: 'normal' },
          },
        ],
        activeLoadoutId: 'x',
      }),
    );

    // One unreadable key is not a reason to forget every posture the player set.
    expect(loadLoadout().stances).toEqual({ cleric: 'hold' });
  });

  it('survives outright garbage', () => {
    localStorage.setItem(V3_KEY, '{{{');
    expect(loadLoadout().squad).toEqual(defaultSquad());
  });

  it('arms the first profile when the active id names none', () => {
    saveStore({
      loadouts: [{ id: 'a', name: 'A', squad: defaultSquad(), stances: {} }],
      activeLoadoutId: 'ghost',
    });

    expect(loadLoadout().id).toBe('a');
  });
});

describe('saveStances', () => {
  it('replaces the postures and leaves the squad alone', () => {
    saveStore({
      loadouts: [{ id: 'a', name: 'A', squad: SQUAD as never, stances: { cleric: 'hold' } }],
      activeLoadoutId: 'a',
    });

    saveStances({ stone_golem: 'aggressive' });

    const after = loadLoadout();
    expect(after.squad).toEqual(SQUAD);
    // Replaced wholesale rather than merged: the builder always sends the full
    // map it is showing, so a merge would resurrect a posture the player cleared.
    expect(after.stances).toEqual({ stone_golem: 'aggressive' });
  });

  it('refuses to store a posture it could not read back', () => {
    saveStances({ cleric: 'berserk' } as never);
    expect(loadLoadout().stances).toEqual({});
  });
});
