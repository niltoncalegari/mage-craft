import { describe, expect, it } from 'vitest';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import { Rng } from '../../sim/rng';
import { Vec2 } from '../../sim/Vec2';
import { RoomManager } from './RoomManager';
import { Session, SNAPSHOT_EVERY_N_TICKS, type SessionCallbacks } from './Session';

function newSession(teamSize = 1, cb: SessionCallbacks = {}): Session {
  return new Session(new RoomManager().createRoom(teamSize), cb, new Rng(1));
}

/** A 1v1 human-vs-human session with the match already running. */
function startedSession(cb: SessionCallbacks = {}): Session {
  const s = newSession(1, cb);
  s.join('p1', 'Alice');
  s.selectTeam('p1', TEAM_A);
  s.selectElement('p1', 'fire');
  s.join('p2', 'Bob');
  s.selectTeam('p2', TEAM_B);
  s.selectElement('p2', 'ice');
  s.startMatch();
  return s;
}

/** Razes a team's structures, which is now the only way a match ends (GDD §4). */
function eliminate(s: Session, team: number): void {
  for (const st of s.liveWorld?.structures.values() ?? []) {
    if (st.team === team) {
      st.invulnerable = false;
      st.health = 0;
      st.alive = false;
    }
  }
}

describe('Session — start', () => {
  it('builds an empty world — players have no avatar since the pivot', () => {
    const s = newSession();
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');
    s.addBot(TEAM_B, 'hard');

    s.startMatch();

    expect(s.liveWorld?.mages.size).toBe(0);
    // Structures came from the map, so there is something to fight over.
    expect((s.liveWorld?.structures.size ?? 0)).toBeGreaterThan(0);
  });

  it('deals each team a hand from its deck', () => {
    const s = startedSession();
    expect(s.deckFor(TEAM_A)?.hand()).toHaveLength(4);
    expect(s.deckFor(TEAM_B)?.next()).toBeTruthy();
  });

  it('rejects a cast before the match starts', () => {
    const s = newSession();
    expect(() => s.submitCast('p1', 'pyromancer', new Vec2(-10, 0))).toThrow(/not started/);
  });

  it('fills empty seats with bots', () => {
    const s = newSession(2);
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');

    s.fillEmptyWithBots('easy');

    expect(s.slots()).toHaveLength(4);
    expect(s.slots().filter((x) => x.isBot)).toHaveLength(3);
  });
});

describe('Session — ticking', () => {
  it('deploys a unit and charges mana for a cast in hand', () => {
    const s = startedSession();
    const card = s.deckFor(TEAM_A)!.hand()[0];
    const manaBefore = s.manaFor(TEAM_A);

    const result = s.submitCast('p1', card, new Vec2(-10, 0));

    expect(result.ok).toBe(true);
    expect(s.liveWorld?.mages.size).toBe(1);
    expect(s.manaFor(TEAM_A)).toBeLessThan(manaBefore);
    // The played card cycles to the back, so it leaves the hand.
    expect(s.deckFor(TEAM_A)!.hand()).not.toContain(card);
  });

  it('refuses a card that is not in hand', () => {
    const s = startedSession();
    const notInHand = s.deckFor(TEAM_A)!.next()!;

    const result = s.submitCast('p1', notInHand, new Vec2(-10, 0));

    expect(result).toEqual({ ok: false, reason: 'not_in_hand' });
    expect(s.liveWorld?.mages.size).toBe(0);
  });

  it('refuses a cast in the enemy half', () => {
    const s = startedSession();
    const card = s.deckFor(TEAM_A)!.hand()[0];

    const result = s.submitCast('p1', card, new Vec2(15, 0));

    expect(result).toEqual({ ok: false, reason: 'outside_deploy_zone' });
  });

  it('emits a snapshot on the configured cadence', () => {
    let snapshots = 0;
    const s = startedSession({ onSnapshot: () => snapshots++ });

    for (let i = 0; i < SNAPSHOT_EVERY_N_TICKS - 1; i++) s.tick();
    expect(snapshots).toBe(0);
    s.tick();
    expect(snapshots).toBe(1);
  });

  it('includes mages, projectiles and puddles in the snapshot', () => {
    const s = startedSession({
      onSnapshot: (snap) => {
        expect(snap.tick).toBe(SNAPSHOT_EVERY_N_TICKS);
        expect(Array.isArray(snap.projectiles)).toBe(true);
        expect(Array.isArray(snap.puddles)).toBe(true);
        expect(snap.structures.length).toBeGreaterThan(0);
        expect(snap.mana[TEAM_A]).toBeGreaterThan(0);
      },
    });
    for (let i = 0; i < SNAPSHOT_EVERY_N_TICKS; i++) s.tick();
  });
});

describe('Session — round end', () => {
  it('reports the winner exactly once and reopens the rematch lobby', () => {
    let endCalls = 0;
    let winner = -1;
    const s = startedSession({
      onRoundEnd: (w) => {
        endCalls++;
        winner = w;
      },
    });

    eliminate(s, TEAM_B);
    s.tick();
    s.tick(); // a second tick must not re-fire the callback

    expect(endCalls).toBe(1);
    expect(winner).toBe(TEAM_A);
    expect(s.room.state).toBe('lobby');
    expect(s.ended).toBe(true);
  });

  it('applies a spectator’s claim on rematch and can start the next round', () => {
    const s = newSession();
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');
    const botSlot = s.addBot(TEAM_B, 'normal');
    s.startMatch();

    s.join('p3', 'Carol'); // joins mid-match, so: spectator
    expect(s.roleOf('p3')).toBe('spectator');
    s.claimSlot('p3', botSlot.id);

    eliminate(s, TEAM_B);
    s.tick();

    expect(s.room.state).toBe('lobby');
    expect(s.roleOf('p3')).toBe('player');
    const seat = s.slots().find((x) => x.playerId === 'p3');
    expect(seat?.isBot).toBe(false);
    expect(seat?.element).toBeTruthy();

    s.setReady('p1', true);
    s.setReady('p3', true);
    s.startMatch();
    expect(s.liveWorld).toBeTruthy();
  });
});

describe('Session — run loop', () => {
  it('catches up on elapsed time instead of dropping ticks, and stops at round end', async () => {
    let ended = false;
    const s = startedSession({ onRoundEnd: () => (ended = true) });

    // A fake clock that jumps 100ms per interval fire: at 60Hz that is 6 ticks
    // of work, above the 5-tick catch-up cap, which is what the cap is for.
    let now = 0;
    s.runLoop(() => (now += 100));

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(s.liveWorld?.elapsed ?? 0).toBeGreaterThan(0);

    eliminate(s, TEAM_B);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(ended).toBe(true);
    expect(s.ended).toBe(true);
    s.stop(); // idempotent; the loop already stopped itself
  });
});
