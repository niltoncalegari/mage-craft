import { describe, expect, it } from 'vitest';
import { TEAM_A, TEAM_B } from '../../sim/entities';
import { Room } from './Room';
import { RoomManager } from './RoomManager';

function newRoom(teamSize: number): Room {
  return new RoomManager().createRoom(teamSize);
}

describe('RoomManager', () => {
  it('assigns unique, non-empty ids', () => {
    const m = new RoomManager();
    const r1 = m.createRoom(2);
    const r2 = m.createRoom(2);

    expect(r1.id).not.toBe('');
    expect(r2.id).not.toBe('');
    expect(r1.id).not.toBe(r2.id);
    expect(m.room(r1.id)).toBe(r1);
  });

  it('retries when the generator collides', () => {
    const ids = ['AAAA', 'AAAA', 'BBBB'];
    let i = 0;
    const m = new RoomManager(() => ids[i++]);

    expect(m.createRoom(1).id).toBe('AAAA');
    expect(m.createRoom(1).id).toBe('BBBB');
  });

  it('rejects out-of-range team sizes', () => {
    const m = new RoomManager();
    for (const size of [0, -1, 7, 1.5]) {
      expect(() => m.createRoom(size), `teamSize ${size}`).toThrow();
    }
  });

  it('omits ended rooms from summaries', () => {
    const m = new RoomManager();
    const r = m.createRoom(1);
    expect(m.summaries()).toHaveLength(1);
    r.markEnded();
    expect(m.summaries()).toHaveLength(0);
  });
});

describe('Room — seats', () => {
  it('occupies a slot on join + selectTeam', () => {
    const r = newRoom(2);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);

    const slot = r.findSlot(TEAM_A, 'p1');
    expect(slot).toBeDefined();
    expect(slot?.name).toBe('Alice');
    expect(slot?.isBot).toBe(false);
  });

  it('rejects a team that is already full', () => {
    const r = newRoom(1); // 1v1: team A has exactly one slot
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.join('p2', 'Bob');

    expect(() => r.selectTeam('p2', TEAM_A)).toThrow(/full/);
  });

  it('frees the slot and element when a player leaves', () => {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');

    r.leave('p1');

    r.join('p2', 'Bob');
    r.selectTeam('p2', TEAM_A);
    expect(() => r.selectElement('p2', 'fire')).not.toThrow();
  });
});

describe('Room — elements', () => {
  it('rejects a duplicate element within a team but allows it across teams', () => {
    const r = newRoom(2);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.join('p2', 'Bob');
    r.selectTeam('p2', TEAM_A);

    r.selectElement('p1', 'fire');
    expect(() => r.selectElement('p2', 'fire')).toThrow(/already taken/);
    expect(() => r.selectElement('p2', 'ice')).not.toThrow();

    const other = newRoom(1);
    other.join('a', 'Alice');
    other.selectTeam('a', TEAM_A);
    other.join('b', 'Bob');
    other.selectTeam('b', TEAM_B);
    other.selectElement('a', 'fire');
    expect(() => other.selectElement('b', 'fire')).not.toThrow();
  });

  it('rejects an element outside the catalog', () => {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    expect(() => r.selectElement('p1', 'shadow')).toThrow(/unknown element/);
  });
});

describe('Room — bots', () => {
  it('auto-picks a free element and refuses a full team', () => {
    const r = newRoom(2);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');

    const slot = r.addBot(TEAM_A, 'normal');
    expect(slot.isBot).toBe(true);
    expect(slot.element).toBeTruthy();
    expect(slot.element).not.toBe('fire');

    expect(() => r.addBot(TEAM_A, 'normal')).toThrow(/full/);
  });

  it('frees the seat again on removeBot', () => {
    const r = newRoom(1);
    const slot = r.addBot(TEAM_A, 'easy');
    r.removeBot(slot.id);

    r.join('p1', 'Alice');
    expect(() => r.selectTeam('p1', TEAM_A)).not.toThrow();
  });

  it('fills every remaining seat on both teams', () => {
    const r = newRoom(2);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');

    r.fillEmptyWithBots('normal');

    expect(r.slots()).toHaveLength(4);
    expect(r.slots().filter((s) => s.isBot)).toHaveLength(3);
  });
});

describe('Room — match start', () => {
  it('refuses to start until every slot has an element', () => {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.join('p2', 'Bob');
    r.selectTeam('p2', TEAM_B);

    expect(() => r.startMatch()).toThrow(/no element selected/);

    r.selectElement('p1', 'fire');
    r.selectElement('p2', 'ice');

    const world = r.startMatch();
    expect(r.state).toBe('in_progress');
    expect(world.structures.size).toBeGreaterThan(0);
  });

  it('starts an empty world — a player has no avatar in the arena', () => {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');
    r.addBot(TEAM_B, 'normal');

    const world = r.startMatch();
    expect(world.mages.size).toBe(0);
  });
});

describe('Room — spectators and claims', () => {
  function startedRoom(): { room: Room; botSlotId: string } {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');
    const bot = r.addBot(TEAM_B, 'normal');
    r.startMatch();
    return { room: r, botSlotId: bot.id };
  }

  it('only accepts spectators while a match is in progress', () => {
    const r = newRoom(1);
    r.join('p1', 'Alice');
    r.selectTeam('p1', TEAM_A);
    r.selectElement('p1', 'fire');
    r.addBot(TEAM_B, 'normal');

    expect(() => r.joinAsSpectator('spec', 'Viewer')).toThrow(/cannot spectate/);

    r.startMatch();
    r.joinAsSpectator('spec', 'Viewer');
    expect(r.roleOf('spec')).toBe('spectator');
  });

  it('promotes a claiming spectator into the bot’s seat on rematch', () => {
    const { room, botSlotId } = startedRoom();
    room.joinAsSpectator('spec', 'Viewer');
    room.claimSlot('spec', botSlotId);

    room.applyClaims();
    room.resetToLobby();

    expect(room.state).toBe('lobby');
    expect(room.roleOf('spec')).toBe('player');
    const slot = room.findSlot(TEAM_B, 'spec');
    expect(slot?.isBot).toBe(false);
    // The claimed seat keeps the bot's element so the room stays startable.
    expect(slot?.element).toBeTruthy();
  });

  it('refuses a slot already claimed by someone else', () => {
    const { room, botSlotId } = startedRoom();
    room.joinAsSpectator('s1', 'One');
    room.joinAsSpectator('s2', 'Two');
    room.claimSlot('s1', botSlotId);

    expect(() => room.claimSlot('s2', botSlotId)).toThrow(/already claimed/);
  });

  it('releases the claim when the claiming spectator leaves', () => {
    const { room, botSlotId } = startedRoom();
    room.joinAsSpectator('spec', 'Viewer');
    room.claimSlot('spec', botSlotId);

    room.leave('spec');
    room.applyClaims();

    expect(room.slots().find((s) => s.id === botSlotId)?.isBot).toBe(true);
  });
});
