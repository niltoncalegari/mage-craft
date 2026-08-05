import { describe, expect, it } from 'vitest';
import { defaultDeck } from '../../sim/Deck';
import { BOT_FALLBACK_SECONDS, Matchmaker, type QueueEntry } from './Matchmaker';

function entry(clientId: string, joinedAt = 0): QueueEntry {
  return { clientId, name: clientId, deck: defaultDeck(), joinedAt };
}

describe('Matchmaker', () => {
  it('pairs two waiting players and drains them from the queue', () => {
    const m = new Matchmaker();
    m.join(entry('a'));
    m.join(entry('b'));

    const pairs = m.pair(0);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.clientId).toBe('a');
    expect(pairs[0].b?.clientId).toBe('b');
    expect(m.size).toBe(0);
  });

  it('leaves a lone player waiting before the fallback elapses', () => {
    const m = new Matchmaker();
    m.join(entry('a', 0));

    expect(m.pair(BOT_FALLBACK_SECONDS - 1)).toHaveLength(0);
    expect(m.size).toBe(1);
  });

  it('gives a lone player a bot once the fallback elapses', () => {
    const m = new Matchmaker();
    m.join(entry('a', 0));

    const pairs = m.pair(BOT_FALLBACK_SECONDS);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].b).toBeNull();
    expect(m.size).toBe(0);
  });

  it('pairs humans first and only then falls back to a bot', () => {
    const m = new Matchmaker();
    m.join(entry('a', 0));
    m.join(entry('b', 0));
    m.join(entry('c', 0));

    const pairs = m.pair(BOT_FALLBACK_SECONDS);

    expect(pairs).toHaveLength(2);
    expect(pairs[0].b?.clientId).toBe('b');
    expect(pairs[1].b).toBeNull();
    expect(pairs[1].a.clientId).toBe('c');
  });

  it('removes a player who leaves', () => {
    const m = new Matchmaker();
    m.join(entry('a'));

    expect(m.leave('a')).toBe(true);
    expect(m.leave('a')).toBe(false);
    expect(m.has('a')).toBe(false);
  });

  it('refreshes rather than duplicating a player who re-queues', () => {
    const m = new Matchmaker();
    m.join(entry('a', 0));
    m.join(entry('a', 5));

    expect(m.size).toBe(1);
    expect(m.entryOf('a')?.joinedAt).toBe(5);
  });

  it('reports a 1-based queue position', () => {
    const m = new Matchmaker();
    m.join(entry('a'));
    m.join(entry('b'));

    expect(m.positionOf('a')).toBe(1);
    expect(m.positionOf('b')).toBe(2);
    expect(m.positionOf('nobody')).toBe(0);
  });
});
