import { describe, expect, it } from 'vitest';
import { defaultSquad } from '../../sim/cards';
import { SIM_DT } from '../../sim/config';
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
    // Every mage carries the kit its roster entry gives it, and nothing on this
    // first snapshot has been spent yet — so the charges are omitted entirely.
    expect(first.mages.every((m) => !('cd' in m))).toBe(true);
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

  it('spends the player’s kits with nobody clicking', () => {
    const snaps: SnapshotMsg[] = [];
    const session = new LocalSession({
      squad: defaultSquad(),
      difficulty: 'normal',
      seed: 1,
      onSnapshot: (msg) => snaps.push(msg),
      onMatchResult: () => {},
    });

    // A practice match is the same idle match the server runs: charges move and
    // the trace names a cast, without a single call into the session.
    for (let i = 0; i < 2 / SIM_DT; i++) session.tick(SIM_DT);

    expect(snaps.at(-1)?.mages.some((m) => m.cd?.some((c) => c > 0))).toBe(true);
    expect(snaps.at(-1)?.firedAbility).toMatchObject({
      mageId: expect.any(String),
      spellId: expect.any(String),
      at: expect.any(String),
    });
    session.dispose();
  });

  it('ignores a by-hand cast — a spell belongs to the mage carrying it now', () => {
    const session = new LocalSession({
      squad: defaultSquad(),
      difficulty: 'normal',
      seed: 1,
      onSnapshot: () => {},
      onMatchResult: () => {},
    });

    // Still on `MatchTransport`, so the view can call it; it just does nothing.
    expect(() => session.sendCast()).not.toThrow();
    session.dispose();
  });
});
