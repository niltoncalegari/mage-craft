/**
 * The list surgery and the hit-test, which is all of the gesture that can be
 * wrong without a browser. Off-by-one here shows up as "I dropped the rule
 * where I wanted and it went one slot too far", and a priority list is exactly
 * the place that is unforgivable.
 */

import { describe, expect, it } from 'vitest';
import { dropIndexAt, insertItem, moveItem, settledRects, type RowBox } from './useDragList';

const rect = (top: number, height = 20): RowBox => ({ top, height });

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

  it('clamps a nudge past either end instead of wrapping', () => {
    // The arrow-key path asks for the gap past the end. Left unclamped, the
    // negative index reaches splice's count-from-the-end behaviour and the top
    // rule silently becomes the bottom one.
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 3, 5)).toEqual(list);
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

describe('settledRects', () => {
  // Three 20px rows at 0, 20, 40. Row 0 is grabbed and dragged 50px down, so
  // the pointer is at y=55 — inside what used to be row 2.
  const laidOut = [rect(0), rect(20), rect(40)];
  const dy = 50;
  const dragged = [rect(dy), rect(20), rect(40)];

  it('puts the lifted row back where it came from', () => {
    expect(settledRects(dragged, 0, dy).map((r) => r.top)).toEqual([0, 20, 40]);
  });

  it('is what stops a downward drag from resolving back onto itself', () => {
    // Measured live, the grabbed row's own box has travelled with the pointer
    // and is still counted below it, so the drop resolves one gap short of
    // where the finger is — and for a short drag, back onto the rule itself.
    expect(dropIndexAt(55, dragged)).toBe(2);
    expect(dropIndexAt(55, settledRects(dragged, 0, dy))).toBe(3);
  });

  it('leaves every box alone when nothing is lifted', () => {
    expect(settledRects(laidOut, -1, dy)).toEqual(laidOut);
  });
});
