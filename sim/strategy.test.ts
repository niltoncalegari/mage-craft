import { describe, expect, it } from 'vitest';
import {
  ALL_TARGET_SELECTORS,
  defaultStrategy,
  emptyStrategy,
  evaluateStrategy,
  STRATEGY_MAX_RULES,
  STRATEGY_VERSION,
  validateStrategy,
  type Condition,
  type Strategy,
  type StrategyFacts,
  type StrategyRule,
  type TargetSelector,
} from './strategy';
import { ALL_SPELLS, type CardId } from './spells';
import { Vec2 } from './Vec2';

const HERE = new Vec2(3, 4);

/** Every selector resolves by default, so a test only pins the facts it is about. */
function targets(
  overrides: Partial<Record<TargetSelector, Vec2 | null>> = {},
): Record<TargetSelector, Vec2 | null> {
  const all = {} as Record<TargetSelector, Vec2 | null>;
  for (const t of ALL_TARGET_SELECTORS) all[t] = HERE;
  return { ...all, ...overrides };
}

function facts(overrides: Partial<StrategyFacts> = {}): StrategyFacts {
  return {
    mana: 10,
    elapsed: 0,
    suddenDeath: false,
    posture: 'push',
    allyCount: 4,
    enemyCount: 4,
    allyLowestHealthFraction: 1,
    enemyLowestHealthFraction: 1,
    ourCoreFraction: 1,
    enemyCoreFraction: 1,
    ourTowersAlive: 2,
    enemyTowersAlive: 2,
    allyClusterSize: 1,
    enemyClusterSize: 1,
    hasIntruder: false,
    allyEffects: new Set(),
    enemyEffects: new Set(),
    targets: targets(),
    ...overrides,
  };
}

function rule(over: Partial<StrategyRule> = {}): StrategyRule {
  return { id: 'r1', enabled: true, card: 'blessing', when: { kind: 'always' }, at: 'ally_cluster', ...over };
}

function strategy(rules: StrategyRule[]): Strategy {
  return { version: STRATEGY_VERSION, name: 'test', rules };
}

const RICH = { hand: [...ALL_SPELLS] as CardId[], mana: 10 };

describe('evaluateStrategy — rule selection', () => {
  it('returns the first eligible rule and ignores everything below it', () => {
    const s = strategy([
      rule({ id: 'a', card: 'plague', when: { kind: 'mana', op: 'gte', value: 99 } }),
      rule({ id: 'b', card: 'slow_curse' }),
      rule({ id: 'c', card: 'blessing' }),
    ]);

    const d = evaluateStrategy(s, facts(), RICH);

    expect(d).toMatchObject({ ruleId: 'b', ruleIndex: 1, cardId: 'slow_curse' });
  });

  it('casts nothing when no rule is eligible', () => {
    const s = strategy([rule({ when: { kind: 'mana', op: 'gte', value: 99 } })]);
    expect(evaluateStrategy(s, facts(), RICH)).toBeNull();
  });

  it('an empty strategy never casts — this is the AFK baseline', () => {
    expect(evaluateStrategy(emptyStrategy(), facts(), RICH)).toBeNull();
  });

  it('skips a disabled rule without letting it block the ones below', () => {
    const s = strategy([
      rule({ id: 'off', enabled: false, card: 'plague' }),
      rule({ id: 'on', card: 'blessing' }),
    ]);

    expect(evaluateStrategy(s, facts(), RICH)?.ruleId).toBe('on');
  });

  /*
   * Skipping rather than waiting is the load-bearing choice: a rule that
   * blocked the ones under it would make the editor's fallthrough arrow a lie,
   * and would let the top rule deny service to the player's own program.
   * Waiting stays expressible — as an explicit `mana >= N` guard.
   */
  it('skips a rule whose card is not in hand', () => {
    const s = strategy([rule({ id: 'gone', card: 'plague' }), rule({ id: 'held', card: 'blessing' })]);

    const d = evaluateStrategy(s, facts(), { hand: ['blessing'], mana: 10 });

    expect(d?.ruleId).toBe('held');
  });

  it('skips a rule the team cannot afford', () => {
    const s = strategy([
      rule({ id: 'dear', card: 'plague' }), // 4
      rule({ id: 'cheap', card: 'blessing' }), // 2
    ]);

    const d = evaluateStrategy(s, facts(), { hand: [...ALL_SPELLS], mana: 2 });

    expect(d?.ruleId).toBe('cheap');
  });

  it('skips a rule whose target does not resolve, rather than retargeting it', () => {
    const s = strategy([
      rule({ id: 'nowhere', at: 'deepest_intruder' }),
      rule({ id: 'somewhere', at: 'ally_cluster' }),
    ]);

    const d = evaluateStrategy(s, facts({ targets: targets({ deepest_intruder: null }) }), RICH);

    expect(d?.ruleId).toBe('somewhere');
  });

  it('reports the resolved position of the selector it fired on', () => {
    const spot = new Vec2(-7, 2);
    const s = strategy([rule({ at: 'enemy_cluster' })]);

    const d = evaluateStrategy(s, facts({ targets: targets({ enemy_cluster: spot }) }), RICH);

    expect(d?.position).toEqual(spot);
  });
});

describe('evaluateStrategy — conditions', () => {
  const fires = (when: Condition, f: Partial<StrategyFacts>): boolean =>
    evaluateStrategy(strategy([rule({ when })]), facts(f), RICH) !== null;

  it('compares numeric facts with every comparator', () => {
    expect(fires({ kind: 'mana', op: 'lt', value: 5 }, { mana: 4 })).toBe(true);
    expect(fires({ kind: 'mana', op: 'lt', value: 5 }, { mana: 5 })).toBe(false);
    expect(fires({ kind: 'mana', op: 'lte', value: 5 }, { mana: 5 })).toBe(true);
    expect(fires({ kind: 'mana', op: 'gt', value: 5 }, { mana: 6 })).toBe(true);
    expect(fires({ kind: 'mana', op: 'gt', value: 5 }, { mana: 5 })).toBe(false);
    expect(fires({ kind: 'mana', op: 'gte', value: 5 }, { mana: 5 })).toBe(true);
    expect(fires({ kind: 'mana', op: 'eq', value: 5 }, { mana: 5 })).toBe(true);
  });

  it('reads each numeric fact from its own field', () => {
    expect(fires({ kind: 'elapsed', op: 'gt', value: 60 }, { elapsed: 61 })).toBe(true);
    expect(fires({ kind: 'ally_count', op: 'lt', value: 3 }, { allyCount: 2 })).toBe(true);
    expect(fires({ kind: 'enemy_count', op: 'gte', value: 4 }, { enemyCount: 4 })).toBe(true);
    expect(fires({ kind: 'ally_health', op: 'lt', value: 0.5 }, { allyLowestHealthFraction: 0.4 })).toBe(true);
    expect(fires({ kind: 'enemy_health', op: 'lt', value: 0.5 }, { enemyLowestHealthFraction: 0.4 })).toBe(true);
    expect(fires({ kind: 'ally_cluster', op: 'gte', value: 3 }, { allyClusterSize: 3 })).toBe(true);
    expect(fires({ kind: 'enemy_cluster', op: 'gte', value: 3 }, { enemyClusterSize: 3 })).toBe(true);
    expect(fires({ kind: 'our_core', op: 'lt', value: 0.5 }, { ourCoreFraction: 0.3 })).toBe(true);
    expect(fires({ kind: 'enemy_core', op: 'lt', value: 0.5 }, { enemyCoreFraction: 0.3 })).toBe(true);
    expect(fires({ kind: 'our_towers', op: 'lt', value: 2 }, { ourTowersAlive: 1 })).toBe(true);
    expect(fires({ kind: 'enemy_towers', op: 'eq', value: 0 }, { enemyTowersAlive: 0 })).toBe(true);
  });

  it('reads the boolean and enum facts', () => {
    expect(fires({ kind: 'always' }, {})).toBe(true);
    expect(fires({ kind: 'sudden_death', value: true }, { suddenDeath: true })).toBe(true);
    expect(fires({ kind: 'sudden_death', value: true }, { suddenDeath: false })).toBe(false);
    expect(fires({ kind: 'sudden_death', value: false }, { suddenDeath: false })).toBe(true);
    expect(fires({ kind: 'intruder' }, { hasIntruder: true })).toBe(true);
    expect(fires({ kind: 'intruder' }, { hasIntruder: false })).toBe(false);
    expect(fires({ kind: 'posture', value: 'defend' }, { posture: 'defend' })).toBe(true);
    expect(fires({ kind: 'posture', value: 'defend' }, { posture: 'push' })).toBe(false);
  });

  it('tests effect membership on either side', () => {
    expect(fires({ kind: 'enemy_has_effect', effect: 'burn' }, { enemyEffects: new Set(['burn']) })).toBe(true);
    expect(fires({ kind: 'enemy_has_effect', effect: 'burn' }, { enemyEffects: new Set(['slow']) })).toBe(false);
    expect(fires({ kind: 'ally_has_effect', effect: 'shield' }, { allyEffects: new Set(['shield']) })).toBe(true);
  });

  /*
   * Without a plan there is no posture and no squad objective. Those must read
   * as "never eligible" rather than throw or quietly pass, or a rule guarded on
   * posture would fire in a world that has no opinion about posture at all.
   */
  it('never fires a posture rule when the squad has no plan', () => {
    expect(fires({ kind: 'posture', value: 'push' }, { posture: null })).toBe(false);
  });

  it('combines conditions with not / all / any', () => {
    expect(fires({ kind: 'not', of: { kind: 'intruder' } }, { hasIntruder: false })).toBe(true);
    expect(fires({ kind: 'not', of: { kind: 'intruder' } }, { hasIntruder: true })).toBe(false);

    const both: Condition = {
      kind: 'all',
      of: [
        { kind: 'mana', op: 'gte', value: 5 },
        { kind: 'intruder' },
      ],
    };
    expect(fires(both, { mana: 5, hasIntruder: true })).toBe(true);
    expect(fires(both, { mana: 5, hasIntruder: false })).toBe(false);

    const either: Condition = {
      kind: 'any',
      of: [
        { kind: 'mana', op: 'gte', value: 99 },
        { kind: 'intruder' },
      ],
    };
    expect(fires(either, { mana: 1, hasIntruder: true })).toBe(true);
    expect(fires(either, { mana: 1, hasIntruder: false })).toBe(false);
  });
});

describe('validateStrategy', () => {
  const deck: CardId[] = [...ALL_SPELLS];
  const ok = (s: unknown): boolean => validateStrategy(s, deck).ok;
  const why = (s: unknown): string => {
    const v = validateStrategy(s, deck);
    return v.ok ? '' : v.reason;
  };

  it('accepts an empty strategy and the default one', () => {
    expect(ok(emptyStrategy())).toBe(true);
    expect(ok(defaultStrategy(deck))).toBe(true);
  });

  it('rejects a non-object, a wrong version and a missing rule list', () => {
    expect(ok(null)).toBe(false);
    expect(ok('nope')).toBe(false);
    expect(why({ version: 99, name: '', rules: [] })).toMatch(/version/);
    expect(ok({ version: STRATEGY_VERSION, name: '' })).toBe(false);
  });

  it('rejects more rules than the editor can show', () => {
    const rules = Array.from({ length: STRATEGY_MAX_RULES + 1 }, (_, i) => rule({ id: `r${i}` }));
    expect(why(strategy(rules))).toMatch(/at most/);
  });

  it('rejects duplicate rule ids — the HUD names the rule that fired', () => {
    expect(why(strategy([rule({ id: 'same' }), rule({ id: 'same' })]))).toMatch(/duplicate/);
  });

  /*
   * A rule naming a card the player did not bring can never fire. Rejecting it
   * at authoring time is the difference between a program that is wrong and a
   * program that is silently inert.
   */
  it('rejects a rule naming a card outside the deck', () => {
    const v = validateStrategy(strategy([rule({ card: 'plague' })]), ['blessing']);
    expect(v.ok ? '' : v.reason).toMatch(/not in the deck/);
  });

  it('rejects unknown cards, selectors, condition kinds and comparators', () => {
    expect(why(strategy([rule({ card: 'fireball_of_doom' as CardId })]))).toMatch(/unknown card/);
    expect(why(strategy([rule({ at: 'the_moon' as TargetSelector })]))).toMatch(/unknown target/);
    expect(why(strategy([rule({ when: { kind: 'vibes' } as unknown as Condition })]))).toMatch(/unknown condition/);
    expect(
      why(strategy([rule({ when: { kind: 'mana', op: 'about' as never, value: 1 } })])),
    ).toMatch(/comparator/);
  });

  it('rejects a non-finite or out-of-range value', () => {
    expect(ok(strategy([rule({ when: { kind: 'mana', op: 'gte', value: Number.NaN } })]))).toBe(false);
    expect(ok(strategy([rule({ when: { kind: 'ally_health', op: 'lt', value: 5 } })]))).toBe(false);
    expect(ok(strategy([rule({ when: { kind: 'mana', op: 'gte', value: -1 } })]))).toBe(false);
  });

  it('rejects an unknown effect name', () => {
    expect(
      why(strategy([rule({ when: { kind: 'enemy_has_effect', effect: 'cursed' as never } })])),
    ).toMatch(/effect/);
  });

  /*
   * The shape a rule row can render: a flat list of `[não] <condição>`. A group
   * inside a group would need a tree widget and would stop being readable at a
   * glance, which is the entire point of the flowchart.
   */
  it('refuses a group nested inside a group', () => {
    const nested: Condition = { kind: 'all', of: [{ kind: 'any', of: [{ kind: 'always' }] }] };
    expect(why(strategy([rule({ when: nested })]))).toMatch(/nest/);
  });

  it('refuses negating a whole group, but allows negating a condition inside one', () => {
    const negatedGroup: Condition = { kind: 'not', of: { kind: 'all', of: [{ kind: 'always' }] } };
    expect(why(strategy([rule({ when: negatedGroup })]))).toMatch(/not may negate/);

    // "no intruder AND mana >= 5" is a natural thing to write and must stay legal.
    const mixed: Condition = {
      kind: 'all',
      of: [
        { kind: 'not', of: { kind: 'intruder' } },
        { kind: 'mana', op: 'gte', value: 5 },
      ],
    };
    expect(ok(strategy([rule({ when: mixed })]))).toBe(true);
  });

  it('rejects an empty or oversized group', () => {
    expect(ok(strategy([rule({ when: { kind: 'all', of: [] } })]))).toBe(false);
    const five = Array.from({ length: 5 }, () => ({ kind: 'always' }) as Condition);
    expect(ok(strategy([rule({ when: { kind: 'any', of: five } })]))).toBe(false);
  });
});

describe('strategy — serialisation', () => {
  it('round-trips through JSON unchanged, so localStorage and Mongo agree', () => {
    const s = defaultStrategy([...ALL_SPELLS]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('the default strategy only names cards from the deck it was built for', () => {
    const deck: CardId[] = ['blessing', 'blessing', 'plague', 'plague'];
    const s = defaultStrategy(deck);

    expect(s.rules.length).toBeGreaterThan(0);
    for (const r of s.rules) expect(deck).toContain(r.card);
    expect(validateStrategy(s, deck).ok).toBe(true);
  });
});
