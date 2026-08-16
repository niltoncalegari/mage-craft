/**
 * End-to-end coverage of the wire protocol against a recording transport: the
 * same JSON the browser sends goes in, and the JSON it would receive comes out.
 * This is the test that would catch a message changing shape on the server side
 * only — the failure mode the old Go/TypeScript split made easy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClientMsg,
  EmoteMsg,
  ErrorMsg,
  MatchFoundMsg,
  MatchResultMsg,
  QueueStatusMsg,
  RoomListMsg,
  RoomStateMsg,
  ServerMsg,
  SnapshotMsg,
} from '../../sim/protocol';
import { defaultSquad } from '../../sim/cards';
import { SIM_DT, SQUAD_SIZE } from '../../sim/config';
import { HAND_SIZE } from '../../sim/Deck';
import { emptyStrategy, STRATEGY_VERSION } from '../../sim/strategy';
import { BOT_FALLBACK_SECONDS } from './Matchmaker';
import { App, type Transport } from './App';

interface Sent {
  clientId: string;
  msg: ServerMsg;
}

class RecordingTransport implements Transport {
  readonly sent: Sent[] = [];

  sendTo(clientId: string, data: string): boolean {
    this.sent.push({ clientId, msg: JSON.parse(data) as ServerMsg });
    return true;
  }

  broadcast(clientIds: Iterable<string>, data: string): void {
    for (const id of clientIds) this.sendTo(id, data);
  }

  /** Every message of a given type delivered to a client, oldest first. */
  to<T extends ServerMsg>(clientId: string, type: T['type']): T[] {
    return this.sent.filter((s) => s.clientId === clientId && s.msg.type === type).map((s) => s.msg as T);
  }

  last<T extends ServerMsg>(clientId: string, type: T['type']): T | undefined {
    return this.to<T>(clientId, type).at(-1);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

let hub: RecordingTransport;
let app: App;

beforeEach(() => {
  hub = new RecordingTransport();
  app = new App(hub);
});

// Leaving a match loop running would leak an interval into the next test.
afterEach(() => app.dispose());

function send(clientId: string, msg: ClientMsg): void {
  app.handleMessage(clientId, JSON.stringify(msg));
}

/** create_room -> join -> team -> element, returning the room code. */
function hostRoom(clientId: string, name: string, teamSize = 1): string {
  send(clientId, { type: 'create_room', teamSize });
  const roomId = hub.last<RoomStateMsg>(clientId, 'room_state')?.roomId;
  if (!roomId) throw new Error('create_room did not return a room_state');

  send(clientId, { type: 'join_room', roomId, name });
  send(clientId, { type: 'select_team', team: 0 });
  send(clientId, { type: 'select_element', element: 'fire' });
  return roomId;
}

describe('App — lobby protocol', () => {
  it('creates a room and reports its code back to the creator', () => {
    send('c1', { type: 'create_room', teamSize: 2 });

    const state = hub.last<RoomStateMsg>('c1', 'room_state');
    expect(state?.roomId).toMatch(/^[A-Z2-9]{4}$/);
    expect(state?.teamSize).toBe(2);
    expect(state?.state).toBe('lobby');
    expect(state?.slots).toEqual([]);
  });

  it('rejects an invalid team size with an error message', () => {
    send('c1', { type: 'create_room', teamSize: 99 });
    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/teamSize/);
  });

  it('broadcasts room_state to everyone, with a per-recipient youRole', () => {
    const roomId = hostRoom('host', 'Alice');
    hub.clear();

    send('guest', { type: 'join_room', roomId, name: 'Bob' });

    expect(hub.last<RoomStateMsg>('host', 'room_state')?.youRole).toBe('player');
    expect(hub.last<RoomStateMsg>('guest', 'room_state')?.youRole).toBe('player');
    expect(hub.last<RoomStateMsg>('guest', 'room_state')?.slots).toHaveLength(1);
  });

  it('omits empty optional slot fields rather than sending empty strings', () => {
    hostRoom('host', 'Alice');
    send('host', { type: 'add_bot', team: 1, difficulty: 'normal' });

    const slots = hub.last<RoomStateMsg>('host', 'room_state')?.slots ?? [];
    const bot = slots.find((s) => s.isBot);
    expect(bot).toBeDefined();
    // A bot has no playerId and no pending claim: those keys must be absent,
    // because the client tests them for presence.
    expect(bot && 'playerId' in bot).toBe(false);
    expect(bot && 'pendingClaimPlayerId' in bot).toBe(false);
    expect(bot?.element).toBeTruthy();
  });

  it('rejects a duplicate element on the same team', () => {
    const roomId = hostRoom('host', 'Alice', 2);
    send('guest', { type: 'join_room', roomId, name: 'Bob' });
    send('guest', { type: 'select_team', team: 0 });
    hub.clear();

    send('guest', { type: 'select_element', element: 'fire' });
    expect(hub.last<ErrorMsg>('guest', 'error')?.message).toMatch(/already taken/);
  });

  it('lists joinable rooms', () => {
    hostRoom('host', 'Alice');
    hub.clear();

    send('browser', { type: 'list_rooms' });

    const rooms = hub.last<RoomListMsg>('browser', 'room_list')?.rooms ?? [];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ teamSize: 1, state: 'lobby', filled: 1, capacity: 2 });
  });

  it('auto-fills bots when the room was created with fillBots', () => {
    send('host', { type: 'create_room', teamSize: 2, fillBots: true, botDifficulty: 'hard' });
    const roomId = hub.last<RoomStateMsg>('host', 'room_state')!.roomId;
    send('host', { type: 'join_room', roomId, name: 'Alice' });
    send('host', { type: 'select_team', team: 0 });
    send('host', { type: 'select_element', element: 'fire' });

    const slots = hub.last<RoomStateMsg>('host', 'room_state')?.slots ?? [];
    expect(slots).toHaveLength(4);
    expect(slots.filter((s) => s.isBot)).toHaveLength(3);
  });

  it('tells a client that has not joined a room to join one first', () => {
    send('stranger', { type: 'set_ready', ready: true });
    expect(hub.last<ErrorMsg>('stranger', 'error')?.message).toMatch(/not joined a room/);
  });

  it('broadcasts a sent emote to both players in the room, naming the sender', () => {
    const roomId = hostRoom('host', 'Alice');
    send('guest', { type: 'join_room', roomId, name: 'Bob' });
    hub.clear();

    send('host', { type: 'send_emote', emoteId: 'gg' });

    expect(hub.last<EmoteMsg>('host', 'emote')).toEqual({ type: 'emote', playerId: 'host', emoteId: 'gg' });
    expect(hub.last<EmoteMsg>('guest', 'emote')).toEqual({ type: 'emote', playerId: 'host', emoteId: 'gg' });
  });

  it('drops an emote from a client that has not joined a room', () => {
    send('stranger', { type: 'send_emote', emoteId: 'gg' });
    expect(hub.to<EmoteMsg>('stranger', 'emote')).toHaveLength(0);
    expect(hub.last<ErrorMsg>('stranger', 'error')?.message).toMatch(/not joined a room/);
  });

  it('reports malformed input instead of throwing', () => {
    app.handleMessage('c1', 'not json');
    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/malformed message/);

    app.handleMessage('c1', '{"nope":1}');
    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/missing a "type"/);

    app.handleMessage('c1', '{"type":"teleport"}');
    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/unknown message type/);
  });
});

describe('App — match protocol', () => {
  /**
   * A 1v1 room against a bot, already started. The real 60Hz interval is
   * stopped immediately so each test drives the sim tick by tick instead of
   * racing a timer.
   */
  /** Returns the room code, for tests that need to seat a spectator in it. */
  function startedMatch(): string {
    const roomId = hostRoom('host', 'Alice');
    send('host', { type: 'add_bot', team: 1, difficulty: 'easy' });
    send('host', { type: 'start_match' });
    app.dispose();
    return roomId;
  }

  it('announces match_start and pushes snapshots as the sim ticks', () => {
    startedMatch();
    expect(hub.to('host', 'match_start')).toHaveLength(1);
    hub.clear();

    // Drive the sim by hand rather than waiting on the real 60Hz interval.
    const session = getSession();
    for (let i = 0; i < 3; i++) session.tick();

    const snap = hub.last<SnapshotMsg>('host', 'snapshot');
    expect(snap?.structures.length).toBeGreaterThan(0);
    expect(snap?.structures[0]).toMatchObject({
      kind: expect.any(String),
      position: { x: expect.any(Number), y: expect.any(Number) },
      health: expect.any(Number),
      maxHealth: expect.any(Number),
      alive: expect.any(Boolean),
      invulnerable: expect.any(Boolean),
    });
    expect(snap?.mana).toEqual(expect.any(Number));
    expect(snap?.elapsed).toEqual(expect.any(Number));
  });

  it('sends every mage a kill tally, and omits respawn state while it is alive', () => {
    startedMatch();
    const session = getSession();
    for (let i = 0; i < 3; i++) session.tick();

    const mage = hub.last<SnapshotMsg>('host', 'snapshot')?.mages[0];
    expect(mage).toMatchObject({ kills: 0, deaths: 0 });
    // Absent, not zero/false: the client tests these for presence, the same way
    // it does for the optional slot fields above.
    expect(mage && 'respawnRemaining' in mage).toBe(false);
    expect(mage && 'immune' in mage).toBe(false);
  });

  it('sends each player their own hand plus the card queued behind it', () => {
    startedMatch();
    const session = getSession();
    for (let i = 0; i < 3; i++) session.tick();

    const snap = hub.last<SnapshotMsg>('host', 'snapshot');
    expect(snap?.hand).toEqual(session.deckFor(0)!.hand());
    expect(snap?.hand).toHaveLength(HAND_SIZE);
    expect(snap?.next).toBe(session.deckFor(0)!.next());
    // The preview is a distinct slot in the cycle — its *value* may still
    // match a card already in hand, since only 4 spells exist so far and the
    // provisional deck duplicates each one (GDD §9, §16.4).
    expect(snap?.next).toBeTruthy();
  });

  it('cycles the hand on the wire as the seat’s own program casts', () => {
    startedMatch();
    const session = getSession();
    const handBefore = session.deckFor(0)!.hand();

    // Nobody sends anything. A seat with a program plays itself, which is the
    // whole claim of the idle pivot — the hand moving with no client message in
    // between is the smallest end-to-end proof of it.
    tickFor(session, 2);

    const snap = hub.last<SnapshotMsg>('host', 'snapshot');
    expect(snap?.hand).toHaveLength(HAND_SIZE);
    // The played slot cycled to the back — the hand as a whole changed, even
    // though a duplicate of the same spell id may still be in it (GDD §9).
    expect(snap?.hand).not.toEqual(handBefore);
  });

  it('names the rule that fired, on the caster’s own channel only', () => {
    const roomId = startedMatch();
    send('watcher', { type: 'join_room', roomId, name: 'Bob' });
    const session = getSession();
    tickFor(session, 2);

    // The idle player's only account of the match: which of their rules just
    // spent their mana, and where it aimed.
    const mine = hub.last<SnapshotMsg>('host', 'snapshot')?.firedRule;
    expect(mine).toMatchObject({ cardId: expect.any(String), at: expect.any(String) });
    expect(mine?.index).toBeGreaterThanOrEqual(0);

    // A spectator has no program, so there is nothing of theirs to report — and
    // the host's must not leak onto their channel.
    expect(hub.last<SnapshotMsg>('watcher', 'snapshot')?.firedRule).toBeUndefined();
  });

  it('refuses a by-hand cast — a match is played by the program now', () => {
    startedMatch();
    const session = getSession();
    const card = session.deckFor(0)!.hand()[0];
    const mageCountBefore = session.liveWorld?.mages.size;

    send('host', { type: 'cast', cardId: card, position: { x: -10, y: 0 } });

    expect(hub.last('host', 'error')).toMatchObject({
      message: expect.stringContaining('idle_mode'),
    });
    // Answered rather than acted on: nothing about the match moved.
    expect(session.liveWorld?.mages.size).toBe(mageCountBefore);
    expect(mageCountBefore).toBe(SQUAD_SIZE * 2);
  });

  it('survives a malformed cast without disturbing the match', () => {
    startedMatch();
    const session = getSession();

    app.handleMessage('host', '{"type":"cast"}');
    session.tick();

    expect(session.liveWorld).toBeTruthy();
  });

  it('broadcasts round_end followed by the rematch room_state', () => {
    startedMatch();
    const session = getSession();
    hub.clear();

    for (const st of session.liveWorld?.structures.values() ?? []) {
      if (st.team === 1) {
        st.invulnerable = false;
        st.health = 0;
        st.alive = false;
      }
    }
    session.tick();

    const types = hub.sent.filter((s) => s.clientId === 'host').map((s) => s.msg.type);
    expect(types).toContain('round_end');
    // The client relies on room_state arriving *after* round_end so it can hold
    // the result screen until the player dismisses it.
    expect(types.indexOf('room_state')).toBeGreaterThan(types.indexOf('round_end'));
    expect(hub.last('host', 'room_state')).toMatchObject({ state: 'lobby' });
  });

  it('drops a disconnecting player from the roster', () => {
    const roomId = hostRoom('host', 'Alice', 2);
    send('guest', { type: 'join_room', roomId, name: 'Bob' });
    send('guest', { type: 'select_team', team: 1 });
    hub.clear();

    app.handleDisconnect('guest');

    expect(hub.last<RoomStateMsg>('host', 'room_state')?.slots).toHaveLength(1);
  });
});

describe('App — matchmaking queue', () => {
  /** Drives the bot-fallback timeout without waiting 12 real seconds. */
  let clockMs = 0;

  beforeEach(() => {
    clockMs = 0;
    app = new App(hub, () => clockMs);
  });

  it('reports the queue back to a player who just joined', () => {
    send('c1', { type: 'join_queue', name: 'Alice' });

    expect(hub.last<QueueStatusMsg>('c1', 'queue_status')).toMatchObject({
      waiting: 1,
      position: 1,
      elapsedSeconds: 0,
    });
  });

  it('drops two queued players straight into a live match, with no lobby step', () => {
    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    // Stop the real 60Hz loop so this test drives the sim tick by tick.
    app.dispose();

    expect(hub.to<ErrorMsg>('c1', 'error')).toEqual([]);
    expect(hub.to<ErrorMsg>('c2', 'error')).toEqual([]);
    expect(hub.last<MatchFoundMsg>('c1', 'match_found')).toMatchObject({
      opponentName: 'Bob',
      yourTeam: 0,
      againstBot: false,
    });
    expect(hub.last<MatchFoundMsg>('c2', 'match_found')).toMatchObject({
      opponentName: 'Alice',
      yourTeam: 1,
      againstBot: false,
    });
    expect(hub.to('c1', 'match_start')).toHaveLength(1);
    expect(hub.to('c2', 'match_start')).toHaveLength(1);

    const session = getSession();
    for (let i = 0; i < 3; i++) session.tick();

    // Each side sees its own mana, so both must actually receive snapshots.
    expect(hub.last<SnapshotMsg>('c1', 'snapshot')?.structures.length).toBeGreaterThan(0);
    expect(hub.last<SnapshotMsg>('c2', 'snapshot')?.structures.length).toBeGreaterThan(0);
  });

  it('gives a lone player an AI commander once the wait runs out', () => {
    send('solo', { type: 'join_queue', name: 'Alice' });
    expect(hub.last<MatchFoundMsg>('solo', 'match_found')).toBeUndefined();

    clockMs = (BOT_FALLBACK_SECONDS + 1) * 1000;
    app.sweepQueue();
    app.dispose();

    expect(hub.to<ErrorMsg>('solo', 'error')).toEqual([]);
    expect(hub.last<MatchFoundMsg>('solo', 'match_found')).toMatchObject({ againstBot: true });
    expect(hub.to('solo', 'match_start')).toHaveLength(1);

    const session = getSession();
    for (let i = 0; i < 3; i++) session.tick();
    expect(hub.last<SnapshotMsg>('solo', 'snapshot')).toBeTruthy();
  });

  it('plays both queued seats from their own programs, with nobody clicking', () => {
    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    app.dispose();

    const session = getSession();
    const handsBefore = [session.deckFor(0)!.hand(), session.deckFor(1)!.hand()];
    tickFor(session, 2);

    expect(hub.to<ErrorMsg>('c1', 'error')).toEqual([]);
    expect(hub.to<ErrorMsg>('c2', 'error')).toEqual([]);
    // Neither player sent a thing, and both hands moved — a queued match is
    // contested on both sides by the programs their players brought.
    expect(session.deckFor(0)!.hand()).not.toEqual(handsBefore[0]);
    expect(session.deckFor(1)!.hand()).not.toEqual(handsBefore[1]);
    // Casts never summon anything (GDD §9) — both squads are already full.
    expect(session.liveWorld?.mages.size).toBe(SQUAD_SIZE * 2);
  });
});

describe('App — loadout', () => {
  const SQUAD = ['ice_sentinel', 'wind_dervish', 'alchemist', 'arcane_bard'];
  /** A legal two-colour deck that deliberately holds no green — so no `plague`. */
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

  it('fields the squad a queued player registered before joining the queue', () => {
    send('c1', { type: 'set_loadout', squad: SQUAD });
    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    app.dispose();

    expect(hub.to<ErrorMsg>('c1', 'error')).toEqual([]);
    const fielded = [...(getSession().liveWorld?.mages.values() ?? [])]
      .filter((m) => m.team === 0)
      .map((m) => m.rosterId)
      .sort();
    expect(fielded).toEqual([...SQUAD].sort());
    // The opponent, who sent nothing, still gets the default squad.
    expect([...(getSession().liveWorld?.mages.values() ?? [])].filter((m) => m.team === 1)).toHaveLength(SQUAD_SIZE);
  });

  it('applies a loadout sent before the room existed to the seat that follows', () => {
    send('c1', { type: 'set_loadout', squad: SQUAD });
    hostRoom('c1', 'Alice');
    send('c1', { type: 'add_bot', team: 1, difficulty: 'normal' });
    send('c1', { type: 'set_ready', ready: true });
    send('c1', { type: 'start_match' });
    app.dispose();

    const fielded = [...(getSession().liveWorld?.mages.values() ?? [])]
      .filter((m) => m.team === 0)
      .map((m) => m.rosterId)
      .sort();
    expect(fielded).toEqual([...SQUAD].sort());
  });

  it('rejects an illegal squad and leaves the queue usable', () => {
    // Four mages, all real, but no support — the role floor (GDD §7).
    send('c1', { type: 'set_loadout', squad: ['stone_golem', 'ice_sentinel', 'pyromancer', 'stormcaller'] });

    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/invalid squad/);

    hub.clear();
    send('c1', { type: 'join_queue', name: 'Alice' });
    expect(hub.to<ErrorMsg>('c1', 'error')).toEqual([]);
    expect(hub.last<QueueStatusMsg>('c1', 'queue_status')).toMatchObject({ position: 1 });
  });

  it('fields the strategy a player registered, and lets it beat an empty one', () => {
    // Deliberately the AFK baseline: the only program whose effect is legible
    // from outside without reading the caster is the one that casts nothing.
    send('c1', { type: 'set_loadout', strategy: emptyStrategy() });
    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    app.dispose();

    const session = getSession();
    const mine = session.deckFor(0)!.hand();
    const theirs = session.deckFor(1)!.hand();
    tickFor(session, 4);

    expect(hub.to<ErrorMsg>('c1', 'error')).toEqual([]);
    expect(session.deckFor(0)!.hand()).toEqual(mine);
    // The opponent, who registered nothing, still gets the default program —
    // an idle match where neither side casts would be a screensaver.
    expect(session.deckFor(1)!.hand()).not.toEqual(theirs);
  });

  it('rejects a strategy that names a card the deck does not hold', () => {
    // A rule on a card you did not bring can never fire. Refusing it is the
    // difference between a program that is wrong and one that is silently inert.
    const orphan = {
      version: STRATEGY_VERSION,
      name: 'orphan',
      rules: [
        { id: 'r1', enabled: true, card: 'plague', when: { kind: 'always' }, at: 'enemy_cluster' },
      ],
    };
    send('c1', { type: 'set_loadout', deck: WHITE_RED_DECK, strategy: orphan });

    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/invalid strategy/);
  });

  it('applies a loadout all at once, so an illegal deck takes the squad down with it', () => {
    send('c1', { type: 'set_loadout', squad: SQUAD, deck: ['blessing'] });

    expect(hub.last<ErrorMsg>('c1', 'error')?.message).toMatch(/invalid deck/);

    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    app.dispose();

    // Half-applying would field a squad the player picked alongside a deck they
    // did not — the message is rejected whole instead.
    const fielded = [...(getSession().liveWorld?.mages.values() ?? [])]
      .filter((m) => m.team === 0)
      .map((m) => m.rosterId)
      .sort();
    expect(fielded).toEqual([...defaultSquad()].sort());
  });
});

describe('App — match result', () => {
  it('sends both players the finished match summary before round_end', () => {
    send('c1', { type: 'join_queue', name: 'Alice' });
    send('c2', { type: 'join_queue', name: 'Bob' });
    app.dispose();

    const session = getSession();
    for (const st of session.liveWorld?.structures.values() ?? []) {
      if (st.team === 1) {
        st.invulnerable = false;
        st.health = 0;
        st.alive = false;
      }
    }
    hub.clear();
    session.tick();

    const result = hub.last<MatchResultMsg>('c1', 'match_result');
    expect(result).toBeTruthy();
    expect(result?.winnerTeam).toBe(0);
    expect(result?.perTeam[0].squad).toHaveLength(SQUAD_SIZE);
    expect(result?.durationSeconds).toBeGreaterThan(0);
    expect(hub.last<MatchResultMsg>('c2', 'match_result')).toBeTruthy();

    // Ordering matters: a client that navigates on round_end must already have
    // the numbers.
    const forC1 = hub.sent.filter((s) => s.clientId === 'c1').map((s) => s.msg.type);
    expect(forC1.indexOf('match_result')).toBeLessThan(forC1.indexOf('round_end'));
  });
});

/** Reaches into App for the one live session, so tests can tick deterministically. */
/**
 * Advances a session by real simulated seconds. Needed since the idle pivot:
 * a caster thinks on its own clock, so "has anything happened yet" is a
 * question about elapsed time rather than about a handful of ticks.
 */
function tickFor(session: import('./Session').Session, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) session.tick();
}

function getSession(): import('./Session').Session {
  const sessions = (app as unknown as { sessions: Map<string, import('./Session').Session> })
    .sessions;
  const [first] = sessions.values();
  if (!first) throw new Error('no session');
  return first;
}
