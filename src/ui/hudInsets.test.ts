import { describe, expect, it } from 'vitest';
import { insetFor, mergeInsets, NO_INSETS, type Rect } from './hudInsets';

/** A 1000x600 viewport, which is what every case below measures against. */
const container: Rect = { top: 0, right: 1000, bottom: 600, left: 0 };

describe('insetFor', () => {
  it('reserves the left edge for a dashboard docked down the left side', () => {
    // The desktop SquadPanel: 210 wide, 12 from the left, hanging below the top bar.
    const panel: Rect = { top: 92, right: 222, bottom: 392, left: 12 };
    expect(insetFor(panel, container)).toEqual({ ...NO_INSETS, left: 222 });
  });

  it('reserves the right edge for its mirror', () => {
    const panel: Rect = { top: 92, right: 988, bottom: 392, left: 778 };
    expect(insetFor(panel, container)).toEqual({ ...NO_INSETS, right: 222 });
  });

  it('reserves the top edge for the match bar', () => {
    const top: Rect = { top: 10, right: 880, bottom: 78, left: 120 };
    expect(insetFor(top, container)).toEqual({ ...NO_INSETS, top: 78 });
  });

  /*
   * The case the edge-distance rule gets wrong on its own. The phone squad
   * strip hugs the bottom AND the left by the same 6px, but tucking it against
   * the left would reserve 423px of a 1000px viewport to save 62px along the
   * bottom. Cheapest reservation wins, not nearest edge.
   */
  it('reserves the bottom edge for a strip that hugs the bottom and a side equally', () => {
    const strip: Rect = { top: 538, right: 423, bottom: 594, left: 6 };
    expect(insetFor(strip, container)).toEqual({ ...NO_INSETS, bottom: 62 });
  });

  it('reserves nothing for a surface with no size', () => {
    const hidden: Rect = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(insetFor(hidden, container)).toEqual(NO_INSETS);
  });

  /*
   * A guard, not a feature: an inset over half the viewport leaves the camera
   * fitting the arena into a sliver and blowing the frustum up to compensate.
   * Better a HUD that overlaps than a board nobody can see.
   */
  it('never reserves more than 45% of the viewport', () => {
    // A top band 400 deep in a 600-tall viewport: cheapest edge is still the
    // top, but it gets 45% of the height and the camera keeps the rest.
    const greedy: Rect = { top: 0, right: 1000, bottom: 400, left: 0 };
    expect(insetFor(greedy, container)).toEqual({ ...NO_INSETS, top: 270 });
  });

  it('reserves nothing when the container has no size', () => {
    const empty: Rect = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(insetFor({ top: 0, right: 10, bottom: 10, left: 0 }, empty)).toEqual(NO_INSETS);
  });
});

describe('mergeInsets', () => {
  it('takes the deepest reservation on each edge', () => {
    const a = { top: 78, right: 0, bottom: 0, left: 0 };
    const b = { top: 10, right: 222, bottom: 62, left: 0 };
    const c = { top: 0, right: 0, bottom: 40, left: 222 };
    expect(mergeInsets(a, b, c)).toEqual({ top: 78, right: 222, bottom: 62, left: 222 });
  });

  it('is empty with nothing to merge', () => {
    expect(mergeInsets()).toEqual(NO_INSETS);
  });
});
