import { describe, expect, it } from 'vitest';
import { Brain } from './Brain';
import { Tactician } from './Tactician';
import { defaultSquad } from '../cards';
import { SIM_DT, SPELL_GLOBAL_COOLDOWN } from '../config';
import { Deck, defaultDeck } from '../Deck';
import { TEAM_A, TEAM_B, type Team } from '../entities';
import { Rng } from '../rng';
import { ALL_SPELLS, type CardId } from '../spells';
import {
  defaultStrategy,
  emptyStrategy,
  STRATEGY_VERSION,
  type Condition,
  type Strategy,
  type TargetSelector,
} from '../strategy';
import { World } from '../World';

function program(rules: { card: CardId; when?: Condition; at?: TargetSelector }[]): Strategy {
  return {
    version: STRATEGY_VERSION,
    name: 'test',
    rules: rules.map((r, i) => ({
      id: `r${i}`,
      enabled: true,
      card: r.card,
      when: r.when ?? { kind: 'always' },
      at: r.at ?? 'ally_frontline',
    })),
  };
}

function contestedWorld(): World {
  const w = new World();
  w.initSquad(TEAM_A, defaultSquad());
  w.initSquad(TEAM_B, defaultSquad());
  return w;
}

/** Drives a tactician for `seconds`, casting whatever it asks for. */
function run(w: World, team: Team, t: Tactician, deck: Deck, seconds: number): number {
  let casts = 0;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    const intent = t.step(w, team, deck, SIM_DT);
    if (intent && w.castSpell(team, intent.cardId, intent.position).ok) {
      deck.play(intent.cardId);
      casts++;
    }
    w.step(SIM_DT);
  }
  return casts;
}

describe('Tactician — cadence', () => {
  it('does not decide on the very first tick of every frame', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'blessing' }]));
    const deck = new Deck(defaultDeck());

    // The evaluation interval has to elapse before anything is proposed.
    expect(t.step(w, TEAM_A, deck, SIM_DT)).toBeNull();
  });

  /*
   * The Tactician's own interval only caps how often it thinks. What caps how
   * often it *casts* is the World's global cooldown, which is shared with the
   * human path and with the bot Commander. This asserts the two compose rather
   * than that either one alone is enough.
   */
  it('never casts twice inside the world’s global cooldown', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'blessing' }]));
    const deck = new Deck(defaultDeck());

    const seconds = 12;
    const casts = run(w, TEAM_A, t, deck, seconds);

    expect(casts).toBeGreaterThan(0);
    expect(casts).toBeLessThanOrEqual(Math.ceil(seconds / SPELL_GLOBAL_COOLDOWN));
  });

  it('spends mana over a match when its program is willing to', () => {
    const w = contestedWorld();
    const t = new Tactician(defaultStrategy(defaultDeck()));

    expect(run(w, TEAM_A, t, new Deck(defaultDeck()), 30)).toBeGreaterThan(2);
  });
});

describe('Tactician — the program decides', () => {
  it('an empty strategy casts nothing at all — the AFK baseline', () => {
    const w = contestedWorld();
    const t = new Tactician(emptyStrategy());

    expect(run(w, TEAM_A, t, new Deck(defaultDeck()), 60)).toBe(0);
    expect(w.manaOf(TEAM_A)).toBeGreaterThan(0);
  });

  it('casts the card the first matching rule names', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'arcane_shield' }]));
    const deck = new Deck([...ALL_SPELLS, ...ALL_SPELLS]);

    run(w, TEAM_A, t, deck, 5);

    expect(w.castsBySpell.get(TEAM_A)?.get('arcane_shield')).toBeGreaterThan(0);
    expect(w.castsBySpell.get(TEAM_A)?.get('plague') ?? 0).toBe(0);
  });

  it('names the rule behind the intent it just returned, so the HUD can explain it', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'slow_curse', at: 'enemy_frontline' }, { card: 'blessing' }]));
    const deck = new Deck(defaultDeck());

    expect(t.lastDecision).toBeNull();

    let intent = null;
    while (!intent) {
      intent = t.step(w, TEAM_A, deck, SIM_DT);
      w.step(SIM_DT);
    }

    expect(t.lastDecision).toMatchObject({ ruleId: 'r0', ruleIndex: 0, cardId: intent.cardId });
  });

  /*
   * Per-evaluation, not sticky: it answers "what did the program decide just
   * now", which goes null the moment nothing applies. Keeping the last *fired*
   * rule on screen is the caller's job, because only the caller knows whether
   * the cast was actually accepted.
   */
  it('reports nothing while no rule applies', () => {
    const w = contestedWorld();
    // Only fires while an enemy is in our ground, which never happens here.
    const t = new Tactician(program([{ card: 'blessing', when: { kind: 'intruder' } }]));
    const deck = new Deck(defaultDeck());

    run(w, TEAM_A, t, deck, 3);

    expect(t.lastDecision).toBeNull();
  });

  /*
   * A rotating queue with two copies of a card runs dry: play both and the
   * rule naming it simply stops being eligible until the cycle brings one
   * back. That is the deck design doing its job, and it is why a program wants
   * more than one answer.
   */
  it('stops firing a rule once its card has cycled out of the hand', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'blessing' }]));
    const deck = new Deck(defaultDeck());

    const casts = run(w, TEAM_A, t, deck, 6);

    expect(casts).toBe(2); // both copies, then nothing
    expect(deck.hand()).not.toContain('blessing');
  });

  it('never mutates the world — the caller casts', () => {
    const w = contestedWorld();
    const t = new Tactician(program([{ card: 'blessing' }]));
    const deck = new Deck(defaultDeck());
    const before = w.manaOf(TEAM_A);

    for (let i = 0; i < 200; i++) t.step(w, TEAM_A, deck, SIM_DT);

    expect(w.manaOf(TEAM_A)).toBe(before);
    expect(w.spellCasts.size).toBe(0);
  });
});

/*
 * The reason the Tactician takes no Rng. The server hands one Rng instance to
 * Brain, to both deck shuffles and to the bot Commander, so a caster that drew
 * from it would make *editing a rule list* change how the mages fight — and
 * the determinism the balance harness rests on would be describing the wrong
 * thing.
 */
describe('Tactician — determinism', () => {
  it('leaves the mages byte-identical no matter what the program says', () => {
    const positions = (s: Strategy): string => {
      const rng = new Rng(1234);
      const w = contestedWorld();
      const brain = new Brain(rng);
      const bots = new Map([...w.mages.keys()].map((id) => [id, 'normal' as const]));
      const t = new Tactician(s);
      const deck = new Deck(defaultDeck(), rng);

      for (let i = 0; i < 600; i++) {
        // The Tactician runs, but its casts are discarded: only its draw on the
        // shared Rng could leak into the mages, and it must have none.
        t.step(w, TEAM_A, deck, SIM_DT);
        brain.step(w, bots, SIM_DT);
        w.step(SIM_DT);
      }
      return [...w.mages.values()].map((m) => `${m.id}:${m.position.x},${m.position.y}`).join('|');
    };

    const busy = program([
      { card: 'plague', when: { kind: 'enemy_cluster', op: 'gte', value: 2 }, at: 'enemy_cluster' },
      { card: 'blessing' },
    ]);

    expect(positions(busy)).toBe(positions(emptyStrategy()));
  });

  it('replays a full contested match identically from the same seed', () => {
    const play = (): string => {
      const rng = new Rng(99);
      const w = contestedWorld();
      const brain = new Brain(rng);
      const bots = new Map([...w.mages.keys()].map((id) => [id, 'normal' as const]));
      const sides: Record<Team, { t: Tactician; d: Deck }> = {
        [TEAM_A]: { t: new Tactician(defaultStrategy(defaultDeck())), d: new Deck(defaultDeck(), rng) },
        [TEAM_B]: { t: new Tactician(program([{ card: 'slow_curse', at: 'enemy_frontline' }])), d: new Deck(defaultDeck(), rng) },
      };

      for (let i = 0; i < 1200; i++) {
        for (const team of [TEAM_A, TEAM_B] as Team[]) {
          const side = sides[team];
          const intent = side.t.step(w, team, side.d, SIM_DT);
          if (intent && w.castSpell(team, intent.cardId, intent.position).ok) side.d.play(intent.cardId);
        }
        brain.step(w, bots, SIM_DT);
        w.step(SIM_DT);
      }
      return JSON.stringify([...w.mages.values()].map((m) => [m.id, m.health, m.position.x, m.position.y]));
    };

    expect(play()).toBe(play());
  });
});
