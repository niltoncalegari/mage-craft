/**
 * One pointer gesture for both things the rule list is edited with: dragging a
 * rule to a new priority, and dragging a card out of the palette into one.
 *
 * They are the same gesture because they answer the same question — *which
 * index does this land on* — and modelling them apart would mean two drop
 * hit-tests that could disagree about where the pointer is.
 *
 * **Pointer events, not HTML5 drag-and-drop.** `dragstart` never fires from
 * touch without a polyfill, and this app is played on a phone held landscape
 * (`useOrientationLock.ts`). `setPointerCapture` is already the idiom here —
 * `OnlineMatch` pans the camera with it.
 *
 * Two things keep the 60 Hz path cheap:
 *
 * - **The travelled offset never enters state.** It is written straight to the
 *   grabbed row's `transform`, so a drag re-renders the list only when the
 *   *drop index* changes — a few times per gesture instead of a few times per
 *   second, across twelve rows of select elements.
 * - **Rects are read once per move, before anything is written.** That is a
 *   read-then-write, not layout thrash, and re-reading is what keeps the drop
 *   index honest while the panel underneath is scrolled.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { CardId } from '../../../../sim/spells';

/** What the gesture is carrying. */
export type DragPayload =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'add'; readonly card: CardId };

/** Below this the press is a tap, and a tap appends rather than placing. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Moves one item to a gap between items.
 *
 * `to` counts gaps in the list *as it stands*: 0 is above everything, `length`
 * is below everything. Dropping an item into either gap touching it is a no-op,
 * which is what makes a nudge that goes nowhere leave the program alone.
 *
 * Both ends clamp, because the arrow-key path asks for the gap past them: a
 * negative index would reach `Array.splice`'s count-from-the-end behaviour and
 * send the top rule to the bottom.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const gap = Math.max(0, Math.min(to, list.length));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(gap > from ? gap - 1 : gap, 0, item);
  return next;
}

/** Inserts at a gap, with the same gap numbering `moveItem` uses. */
export function insertItem<T>(list: readonly T[], item: T, at: number): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(at, next.length)), 0, item);
  return next;
}

/**
 * Which gap a pointer at `y` is in, given each row's box.
 *
 * A row claims the gap above it until the pointer passes its middle, so the
 * indicator flips at the halfway point rather than at an edge — the same
 * feel every list reorder has.
 */
/**
 * All the drop hit-test reads of a row's box. `DOMRect` satisfies it, so real
 * measurements pass straight in, and the arithmetic stays testable without a DOM.
 */
export interface RowBox {
  readonly top: number;
  readonly height: number;
}

/**
 * The rows' boxes with the lifted one put back where it came from.
 *
 * `getBoundingClientRect` reports the transform, so the dragged row's own box
 * chases the pointer and keeps being counted on the near side of itself. The
 * symptom is not a wrong drop — it is a drop that quietly does nothing, because
 * the index resolves back to where the rule already was.
 *
 * `liftedIndex` is -1 when the drag carries a card from the palette; nothing is
 * lifted then, so every box is already where it belongs.
 */
export function settledRects(rects: readonly RowBox[], liftedIndex: number, dy: number): RowBox[] {
  return rects.map((r, i) => (i === liftedIndex ? { top: r.top - dy, height: r.height } : r));
}

export function dropIndexAt(y: number, rects: readonly RowBox[]): number {
  let index = 0;
  for (const rect of rects) {
    if (y > rect.top + rect.height / 2) index++;
  }
  return index;
}

export interface DragList {
  /** The gesture in flight, or null. `dropIndex` is where it would land. */
  readonly drag: { readonly payload: DragPayload; readonly dropIndex: number } | null;
  /** Hands each rendered row to the hook so it can be hit-tested and lifted. */
  rowRef(index: number): (el: HTMLElement | null) => void;
  /** Call from `pointerdown`. A press that never travels far enough appends. */
  beginDrag(payload: DragPayload, ev: PointerEvent): void;
}

export function useDragList(onDrop: (payload: DragPayload, index: number) => void): DragList {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<DragList['drag']>(null);

  // Everything the window listeners need, off the render path: reading it from
  // state would mean re-installing the listeners on every index change.
  const gesture = useRef<{
    payload: DragPayload;
    startY: number;
    pointerId: number;
    target: HTMLElement;
    lifted: HTMLElement | null;
    active: boolean;
    dropIndex: number;
  } | null>(null);

  // `onDrop` closes over the current program, so a gesture that started a
  // render ago must not commit against the one it started with.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const rowRef = useCallback(
    (index: number) =>
      (el: HTMLElement | null): void => {
        rows.current[index] = el;
      },
    [],
  );

  const beginDrag = useCallback((payload: DragPayload, ev: PointerEvent): void => {
    if (ev.button !== 0) return; // primary button and every touch/pen contact
    const target = ev.currentTarget as HTMLElement | null;
    if (!target) return;
    gesture.current = {
      payload,
      startY: ev.clientY,
      pointerId: ev.pointerId,
      target,
      lifted: null,
      active: false,
      dropIndex: payload.kind === 'move' ? payload.index : rows.current.length,
    };
  }, []);

  useEffect(() => {
    // Rows that are still on the page. The ref array is indexed and never
    // shrinks, so a removed rule leaves a hole behind it.
    const liveRows = (): HTMLElement[] =>
      rows.current.filter((el): el is HTMLElement => el !== null && el.isConnected);

    const move = (ev: PointerEvent): void => {
      const g = gesture.current;
      if (!g || ev.pointerId !== g.pointerId) return;

      const dy = ev.clientY - g.startY;
      if (!g.active) {
        if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        g.active = true;
        g.target.setPointerCapture?.(g.pointerId);
        // Only a rule already in the list has something to lift; a card coming
        // from the palette is represented by the indicator alone.
        g.lifted = g.payload.kind === 'move' ? rows.current[g.payload.index] ?? null : null;
        if (g.lifted) g.lifted.dataset.dragging = 'true';
        setDrag({ payload: g.payload, dropIndex: g.dropIndex });
      }

      const rects = liveRows().map((el) => el.getBoundingClientRect());
      const next = dropIndexAt(ev.clientY, settledRects(rects, g.payload.kind === 'move' ? g.payload.index : -1, dy));
      if (g.lifted) g.lifted.style.transform = `translateY(${dy}px)`;
      if (next !== g.dropIndex) {
        g.dropIndex = next;
        setDrag({ payload: g.payload, dropIndex: next });
      }
    };

    const end = (ev: PointerEvent): void => {
      const g = gesture.current;
      if (!g || ev.pointerId !== g.pointerId) return;
      gesture.current = null;

      if (g.lifted) {
        g.lifted.style.transform = '';
        delete g.lifted.dataset.dragging;
      }
      g.target.releasePointerCapture?.(g.pointerId);
      setDrag(null);

      // A press that never travelled is a tap. Placing it where the finger
      // happens to be would move a rule the player only meant to touch, so a
      // tap on the palette appends and a tap on a rule does nothing.
      if (!g.active) {
        if (g.payload.kind === 'add') onDropRef.current(g.payload, liveRows().length);
        return;
      }
      onDropRef.current(g.payload, g.dropIndex);
    };

    const cancel = (ev: PointerEvent): void => {
      const g = gesture.current;
      if (!g || ev.pointerId !== g.pointerId) return;
      gesture.current = null;
      if (g.lifted) {
        g.lifted.style.transform = '';
        delete g.lifted.dataset.dragging;
      }
      setDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  return { drag, rowRef, beginDrag };
}
