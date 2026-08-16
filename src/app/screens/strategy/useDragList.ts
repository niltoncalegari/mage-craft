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
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, item);
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
export function dropIndexAt(y: number, rects: readonly DOMRect[]): number {
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
    const rectsNow = (): DOMRect[] =>
      rows.current.filter((el): el is HTMLElement => el !== null).map((el) => el.getBoundingClientRect());

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

      const next = dropIndexAt(ev.clientY, rectsNow());
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
        if (g.payload.kind === 'add') onDropRef.current(g.payload, rows.current.length);
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
