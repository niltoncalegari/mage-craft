import type { MapData } from '../../sim/Arena';

/**
 * The card range's arena: small, empty, and centred on the one spot the cards
 * land on.
 *
 * A sibling of `sim/rangeMap`, and it exists for the reason that map's own
 * docblock gives — "the camera frames the whole arena, so every unit of empty
 * map is spent shrinking what is being judged". That map is sized for nine
 * projectile lanes side by side, which is about twice as wide as anything here
 * needs; opened on it, the stage sat in the middle of the frame at a third of
 * the size, and a `column` shaft was indistinguishable from a `burst`.
 *
 * It lives in `src/dev/` rather than in `sim/` because nothing in the
 * simulation needs it: it is a camera framing decision for one dev screen.
 *
 * No obstacles. A wall is what a *projectile* range needs, because a shot has
 * to stop somewhere; a card lands where it is cast and a block would only
 * occlude the ground the beat is drawn on.
 */

/** Where the cards land: dead centre, so the camera frames it without panning. */
export const STAGE_X = 0;
export const STAGE_Y = 0;

/**
 * Sized so the widest card in the catalog (Chuva de Meteoros, radius 5) still
 * lands entirely on drawn ground, and no wider — a zone spilling over the arena
 * edge reads as a rendering bug rather than as a big spell.
 */
const WIDEST_RADIUS = 5;
const MARGIN = 2;

/**
 * Wider than deep, for the same reason `rangeMap` runs its lanes across rather
 * than up: the camera fits whichever axis is tighter, so a map shaped unlike a
 * widescreen viewport gets letterboxed and shrinks the very thing being judged.
 * The tilt foreshortens depth, which buys the extra width back.
 */
const ASPECT_BIAS = 1.55;

export function spellRangeMap(): MapData {
  const half = WIDEST_RADIUS + MARGIN;
  return {
    name: 'spell-range',
    width: half * 2 * ASPECT_BIAS,
    height: half * 2,
    objects: [],
    // No spawns and no structures: the dummies are placed by `World.summon`,
    // and a map with no Core never resolves a winner, so the range just runs.
    spawns: [],
    structures: [],
  };
}
