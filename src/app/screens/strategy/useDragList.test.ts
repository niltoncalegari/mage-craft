/**
 * The list surgery and the hit-test, which is all of the gesture that can be
 * wrong without a browser. Off-by-one here shows up as "I dropped the rule
 * where I wanted and it went one slot too far", and a priority list is exactly
 * the place that is unforgivable.
 */

import { describe, expect, it } from 'vitest';
import { dropIndexAt, insertItem, moveItem } from './useDragList';

const rect = (top: number, height = 20): DOMRect => ({ top, height }) as DOMRect;

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves a rule down to the gap it was dropped in', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveItem(list, 0, 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('moves a rule up', () => {
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('leaves the program alone when the drop lands where it started', () => {
    // Both gaps touching an item are the item's own place. A nudge that goes
    // nowhere must not renumber anything.
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, 1, 2)).toEqual(list);
  });

  it('ignores an index that is not in the list', () => {
    expect(moveItem(list, 9, 0)).toEqual(list);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe('insertItem', () => {
  it('inserts at a gap', () => {
    expect(insertItem(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(insertItem(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(insertItem(['a', 'b'], 'x', 2)).toEqual(['a', 'b', 'x']);
  });

  it('clamps a gap past either end', () => {
    expect(insertItem(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(insertItem(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b']);
  });
});

describe('dropIndexAt', () => {
  const rows = [rect(0), rect(20), rect(40)];

  it('flips at each row middle, not at its edge', () => {
    expect(dropIndexAt(9, rows)).toBe(0);
    expect(dropIndexAt(11, rows)).toBe(1);
    expect(dropIndexAt(29, rows)).toBe(1);
    expect(dropIndexAt(31, rows)).toBe(2);
  });

  it('reaches the gap past the last row', () => {
    expect(dropIndexAt(1000, rows)).toBe(3);
    expect(dropIndexAt(-1000, rows)).toBe(0);
  });

  it('puts the only gap of an empty list at 0', () => {
    expect(dropIndexAt(120, [])).toBe(0);
  });
});
