import { describe, expect, it } from 'vitest';
import { defaultSquad } from '../../sim/cards';
import { defaultDeck } from '../../sim/Deck';
import type { MatchSummary } from '../../sim/matchStats';
import type { SnapshotMsg } from './protocol';
import { LocalSession } from './LocalSession';

/** Runs a session to completion on a fixed clock — no DOM, no rAF, no sockets. */
function run(seconds: number, opts: { seed?: number } = {}): {
  snapshots: SnapshotMsg[];
  results: MatchSummary[];
  session: LocalSession;
} {
  const snapshots: SnapshotMsg[] = [];
  const results: MatchSummary[] = [];

  const session = new LocalSession({
    squad: defaultSquad(),
    deck: defaultDeck(),
    difficulty: 'normal',
    seed: opts.seed ?? 42,
    onSnapshot: (msg) => snapshots.push(msg),
    onMatchResult: (summary) => results.push(summary),
  });

  // 60 fps of wall clock; the session re-slices it into fixed sim steps.
  for (let i = 0; i < seconds * 60; i++) session.tick(1 / 60);

  return { snapshots, results, session };
}

describe('LocalSession', () => {
  it('plays a whole match to a result without a server', () => {
    const { results } = run(260);

    expect(results).toHaveLength(1);
    const summary = results[0];
    expect(summary.durationSeconds).toBeGreaterThan(0);
    // -1 is a draw; anything else names a side. All three are legal outcomes.
    expect([-1, 0, 1]).toContain(summary.winnerTeam);
    expect(summary.perTeam[0].squad).toEqual(defaultSquad());
  });

  it('emits snapshots the client can render, at the shared cadence', () => {
    const { snapshots } = run(2);

    expect(snapshots.length).toBeGreaterThan(0);
    const first = snapshots[0];
    expect(first.type).toBe('snapshot');
    expect(first.mages).toHaveLength(defaultSquad().length * 2);
    // The player's own hand and bar ride along, exactly as the server sends them.
    expect(first.hand).toHaveLength(4);
    expect(first.mana).toBeGreaterThan(0);
  });

  // Two full matches back to back; well past the default per-test budget.
  it(
    'reports the same result for the same seed',
    () => {
      const a = run(260, { seed: 7 }).results[0];
      const b = run(260, { seed: 7 }).results[0];

      expect(a.winnerTeam).toBe(b.winnerTeam);
      expect(a.durationSeconds).toBeCloseTo(b.durationSeconds);
    },
    30_000,
  );

  it('goes quiet once the match is over', () => {
    const { session, results } = run(260);
    const before = results.length;

    session.tick(1);
    session.tick(1);

    expect(results).toHaveLength(before);
    expect(session.connected).toBe(false);
  });

  it('ignores a cast for a card that is not in hand', () => {
    const session = new LocalSession({
      squad: defaultSquad(),
      deck: defaultDeck(),
      difficulty: 'normal',
      seed: 1,
      onSnapshot: () => {},
      onMatchResult: () => {},
    });

    // Never throws, whatever the client sends.
    expect(() => session.sendCast('not_a_spell', { x: 0, y: 0 })).not.toThrow();
    session.dispose();
  });
});
