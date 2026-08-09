import { describe, expect, it } from 'vitest';
import { defaultSquad } from '../../sim/cards';
import { SQUAD_SIZE } from '../../sim/config';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import type { MatchSummary } from '../../sim/matchStats';
import { Rng } from '../../sim/rng';
import { Vec2 } from '../../sim/Vec2';
import { RoomManager } from './RoomManager';
import { Session, SNAPSHOT_EVERY_N_TICKS, type SessionCallbacks, type Snapshot } from './Session';

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
  it('gives each team its full, permanent squad from match start (GDD §4, §7)', () => {
    const s = newSession();
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');
    s.addBot(TEAM_B, 'hard');

    s.startMatch();

    expect(s.liveWorld?.mages.size).toBe(SQUAD_SIZE * 2);
    // Structures came from the map too, so there is something to fight over.
    expect((s.liveWorld?.structures.size ?? 0)).toBeGreaterThan(0);
  });

  it('deals each team a hand from its deck', () => {
    const s = startedSession();
    expect(s.deckFor(TEAM_A)?.hand()).toHaveLength(4);
    expect(s.deckFor(TEAM_B)?.next()).toBeTruthy();
  });

  it('rejects a cast before the match starts', () => {
    const s = newSession();
    expect(() => s.submitCast('p1', 'blessing', new Vec2(-10, 0))).toThrow(/not started/);
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
  it('casts a spell from hand and spends mana for it', () => {
    const s = startedSession();
    const card = s.deckFor(TEAM_A)!.hand()[0];
    const handBefore = s.deckFor(TEAM_A)!.hand();
    const manaBefore = s.manaFor(TEAM_A);
    const mageCountBefore = s.liveWorld?.mages.size;

    const result = s.submitCast('p1', card, new Vec2(-10, 0));

    expect(result.ok).toBe(true);
    // Spells never summon anything (GDD §9) — the squad stays the same size.
    expect(s.liveWorld?.mages.size).toBe(mageCountBefore);
    expect(s.manaFor(TEAM_A)).toBeLessThan(manaBefore);
    // The cast cycled the played slot to the back of the deck.
    expect(s.deckFor(TEAM_A)!.hand()).not.toEqual(handBefore);
  });

  it('refuses a card that is not in hand', () => {
    const s = startedSession();
    const mageCountBefore = s.liveWorld?.mages.size;

    const result = s.submitCast('p1', 'not_a_real_spell', new Vec2(-10, 0));

    expect(result).toEqual({ ok: false, reason: 'not_in_hand' });
    expect(s.liveWorld?.mages.size).toBe(mageCountBefore);
  });

  it('refuses a cast outside the arena — there is no deploy zone since the pivot (GDD §5)', () => {
    const s = startedSession();
    const card = s.deckFor(TEAM_A)!.hand()[0];

    const result = s.submitCast('p1', card, new Vec2(9999, 9999));

    expect(result).toEqual({ ok: false, reason: 'out_of_bounds' });
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
        expect(snap.mages.length).toBe(SQUAD_SIZE * 2);
        expect(snap.mana[TEAM_A]).toBeGreaterThan(0);
      },
    });
    for (let i = 0; i < SNAPSHOT_EVERY_N_TICKS; i++) s.tick();
  });

  // The squad panel reads all four of these off every mage, every snapshot.
  it('carries each mage’s kill tally and respawn state', () => {
    const s = startedSession({
      onSnapshot: (snap) => {
        for (const m of snap.mages) {
          expect(m.kills).toBe(0);
          expect(m.deaths).toBe(0);
          expect(m.respawnRemaining).toBe(0);
          expect(m.immune).toBe(false);
        }
      },
    });
    for (let i = 0; i < SNAPSHOT_EVERY_N_TICKS; i++) s.tick();
  });

  it('reports a downed mage’s remaining respawn time and its killer’s tally', () => {
    const snapshots: Snapshot[] = [];
    const s = startedSession({ onSnapshot: (snap) => snapshots.push(snap) });
    const world = s.liveWorld!;
    const [victim] = [...world.mages.values()];
    const enemy = [...world.mages.values()].find((m) => m.team !== victim.team)!;

    world.dealDamage(victim, victim.maxHealth * 2, { attackerId: enemy.id });
    for (let i = 0; i < SNAPSHOT_EVERY_N_TICKS; i++) s.tick();

    const wired = snapshots.at(-1)!.mages;
    expect(wired.find((m) => m.id === victim.id)?.respawnRemaining).toBeGreaterThan(0);
    expect(wired.find((m) => m.id === victim.id)?.deaths).toBe(1);
    expect(wired.find((m) => m.id === enemy.id)?.kills).toBe(1);
    expect(wired.find((m) => m.id === enemy.id)?.respawnRemaining).toBe(0);
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

describe('Session — loadout', () => {
  it('fields the squad the seated player registered', () => {
    const squad = ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'] as const;
    const s = newSession();
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');
    s.setSquad('p1', [...squad]);
    s.addBot(TEAM_B, 'normal');

    s.startMatch();

    const fielded = [...(s.liveWorld?.mages.values() ?? [])]
      .filter((m) => m.team === TEAM_A)
      .map((m) => m.rosterId)
      .sort();
    expect(fielded).toEqual([...squad].sort());
  });

  it('leaves a bot seat on the default squad', () => {
    const s = newSession();
    s.join('p1', 'Alice');
    s.selectTeam('p1', TEAM_A);
    s.selectElement('p1', 'fire');
    s.setSquad('p1', ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard']);
    s.addBot(TEAM_B, 'normal');

    s.startMatch();

    const botSquad = [...(s.liveWorld?.mages.values() ?? [])]
      .filter((m) => m.team === TEAM_B)
      .map((m) => m.rosterId)
      .sort();
    expect(botSquad).toEqual([...defaultSquad()].sort());
  });
});

describe('Session — match result', () => {
  it('captures the match summary before the rematch drops the world', () => {
    const summaries: MatchSummary[] = [];
    const s = startedSession({ onMatchResult: (summary) => summaries.push(summary) });

    eliminate(s, TEAM_B);
    s.tick();
    s.tick(); // must not fire again

    expect(summaries).toHaveLength(1);
    // The world is already gone by the time the callback runs — the summary is
    // the only remaining account of the match, so it has to be complete.
    expect(s.liveWorld).toBeNull();
    expect(summaries[0].winnerTeam).toBe(TEAM_A);
    expect(summaries[0].perTeam[TEAM_A].squad).toHaveLength(SQUAD_SIZE);
    expect(summaries[0].perTeam[TEAM_A].structuresDestroyed).toBeGreaterThan(0);
  });

  it('counts the casts a player actually spent', () => {
    const summaries: MatchSummary[] = [];
    const s = startedSession({ onMatchResult: (summary) => summaries.push(summary) });

    const card = s.deckFor(TEAM_A)?.hand()[0] ?? 'blessing';
    expect(s.submitCast('p1', card, new Vec2(0, 0)).ok).toBe(true);

    eliminate(s, TEAM_B);
    s.tick();

    expect(summaries[0].perTeam[TEAM_A].casts).toContainEqual({ cardId: card, casts: 1 });
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
