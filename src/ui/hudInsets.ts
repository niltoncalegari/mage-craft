/**
 * How much of the viewport the HUD has taken, so the camera can frame the arena
 * in what is left.
 *
 * The HUD floats over the canvas — it always has, and on a desktop that costs
 * nothing, because there is room for the dashboards to dock beside the board
 * rather than on it. On a phone there is no such room: the top bar and the
 * squad strip sit on the arena's own top and bottom edges, and no amount of
 * blur makes a Tower readable through them.
 *
 * The fix is not to move the HUD again but to stop pretending the canvas is all
 * board. Each HUD surface reports the band it has taken, `CameraController`
 * grows the frustum and shifts the focus by exactly that much, and the arena
 * lands inside the hole in the middle. What ends up under the glass is sky.
 */

/** The four edges of a box, in the same sense as a DOMRect. */
export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A band reserved along each edge, in CSS pixels. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Past this the camera is fitting the arena into a sliver and scaling the
 * frustum up to compensate, which costs the player more board than the overlap
 * ever did. A HUD hungrier than this gets to overlap.
 */
const MAX_FRACTION = 0.45;

/**
 * The band `surface` reserves inside `container` — on the one edge it is
 * cheapest to tuck against.
 *
 * "Cheapest", not "nearest", and the phone squad strip is why: it hugs the
 * bottom edge and the left edge by the same 6px, so nearest-edge is a coin
 * flip, and calling it the left would reserve half the viewport's width to
 * spare 62px of its height. Reserving the edge with the shallowest band gets
 * every case right — a docked side panel, the top bar, the strip — without any
 * of them having to say which edge they think they are on.
 */
export function insetFor(surface: Rect, container: Rect): ViewInsets {
  const width = container.right - container.left;
  const height = container.bottom - container.top;
  if (width <= 0 || height <= 0) return NO_INSETS;
  if (surface.right <= surface.left || surface.bottom <= surface.top) return NO_INSETS;

  const bands: readonly { edge: keyof ViewInsets; depth: number; limit: number }[] = [
    { edge: 'top', depth: surface.bottom - container.top, limit: height },
    { edge: 'right', depth: container.right - surface.left, limit: width },
    { edge: 'bottom', depth: container.bottom - surface.top, limit: height },
    { edge: 'left', depth: surface.right - container.left, limit: width },
  ];

  let cheapest = bands[0];
  for (const band of bands) if (band.depth < cheapest.depth) cheapest = band;

  const depth = Math.max(0, Math.min(cheapest.depth, cheapest.limit * MAX_FRACTION));
  return { ...NO_INSETS, [cheapest.edge]: depth };
}

/** The deepest reservation on each edge — the HUD as a whole. */
export function mergeInsets(...insets: readonly ViewInsets[]): ViewInsets {
  const merged = { ...NO_INSETS };
  for (const one of insets) {
    merged.top = Math.max(merged.top, one.top);
    merged.right = Math.max(merged.right, one.right);
    merged.bottom = Math.max(merged.bottom, one.bottom);
    merged.left = Math.max(merged.left, one.left);
  }
  return merged;
}

/** Whether two reservations are the same, to the pixel. */
export function sameInsets(a: ViewInsets, b: ViewInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}
