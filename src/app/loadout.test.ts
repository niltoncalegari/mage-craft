/**
 * The loadout store, with the parts that only matter because it is read on
 * every boot from storage nobody controls: the v1 migration, and what happens
 * when a stored part no longer agrees with the one next to it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSquad } from '../../sim/cards';
import { defaultDeck } from '../../sim/Deck';
import { STRATEGY_VERSION } from '../../sim/strategy';
import { DEFAULT_LOADOUT_ID, loadLoadout, loadStore, saveDeck, saveStore } from './loadout';

const V1_KEY = 'mage-craft.loadout.v1';
const V2_KEY = 'mage-craft.loadout.v2';

const SQUAD = ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'];
/** Legal, two-colour, and deliberately holding no green — so no `plague`. */
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
  it('gives a fresh device a playable profile, program included', () => {
    const loadout = loadLoadout();

    expect(loadout.squad).toEqual(defaultSquad());
    expect(loadout.deck).toEqual(defaultDeck());
    // Never an empty program: an empty one is the AFK baseline, and handing it
    // to somebody who has not opened the editor would be a seat that never casts.
    expect(loadout.strategy.rules.length).toBeGreaterThan(0);
  });
});

describe('loadStore — migrating v1', () => {
  it('carries a v1 squad and deck forward and writes a program for them', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: SQUAD, deck: WHITE_RED_DECK }));

    const loadout = loadLoadout();

    expect(loadout.id).toBe(DEFAULT_LOADOUT_ID);
    expect(loadout.squad).toEqual(SQUAD);
    expect(loadout.deck).toEqual(WHITE_RED_DECK);
    expect(loadout.strategy.version).toBe(STRATEGY_VERSION);
    // v1 predates programs entirely, so the migration has to invent one — and
    // every rule it invents has to name a card this deck actually holds.
    expect(loadout.strategy.rules.length).toBeGreaterThan(0);
    for (const rule of loadout.strategy.rules) expect(WHITE_RED_DECK).toContain(rule.card);
  });

  it('persists the migration, so v1 is read exactly once', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: SQUAD, deck: WHITE_RED_DECK }));
    loadStore();

    expect(localStorage.getItem(V2_KEY)).toBeTruthy();

    // With v1 gone the v2 copy is what answers — proof the read is not falling
    // through to the migration a second time.
    localStorage.removeItem(V1_KEY);
    expect(loadLoadout().squad).toEqual(SQUAD);
  });

  it('falls back per part, so a corrupt v1 deck does not cost the squad', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ squad: SQUAD, deck: ['blessing'] }));

    const loadout = loadLoadout();

    expect(loadout.squad).toEqual(SQUAD);
    expect(loadout.deck).toEqual(defaultDeck());
  });
});

describe('loadStore — a hand-edited store', () => {
  it('degrades an illegal part to the default instead of shipping it', () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        loadouts: [{ id: 'x', name: 'X', squad: ['not_a_mage'], deck: WHITE_RED_DECK, strategy: 'nonsense' }],
        activeLoadoutId: 'x',
      }),
    );

    const loadout = loadLoadout();

    expect(loadout.squad).toEqual(defaultSquad());
    expect(loadout.deck).toEqual(WHITE_RED_DECK);
    expect(loadout.strategy.rules.length).toBeGreaterThan(0);
  });

  it('survives outright garbage', () => {
    localStorage.setItem(V2_KEY, '{{{');
    expect(loadLoadout().deck).toEqual(defaultDeck());
  });

  it('arms the first profile when the active id names none', () => {
    saveStore({
      loadouts: [
        { id: 'a', name: 'A', squad: defaultSquad(), deck: defaultDeck(), strategy: loadLoadout().strategy },
      ],
      activeLoadoutId: 'ghost',
    });

    expect(loadLoadout().id).toBe('a');
  });
});

describe('saveDeck — keeping the program and the deck in agreement', () => {
  it('drops the rules a new deck orphaned and keeps the ones that still work', () => {
    const before = loadLoadout();
    // The default deck is green, so the default program names `plague`; the new
    // deck holds none. Those rules can never fire again.
    expect(before.strategy.rules.some((r) => r.card === 'plague')).toBe(true);

    saveDeck(WHITE_RED_DECK as never);

    const after = loadLoadout();
    expect(after.deck).toEqual(WHITE_RED_DECK);
    for (const rule of after.strategy.rules) expect(WHITE_RED_DECK).toContain(rule.card);
    // Rules naming cards the new deck still holds survive — editing a deck must
    // not quietly wipe the program the player wrote.
    const kept = before.strategy.rules.filter((r) => WHITE_RED_DECK.includes(r.card));
    expect(after.strategy.rules.map((r) => r.id)).toEqual(kept.map((r) => r.id));
  });
});
