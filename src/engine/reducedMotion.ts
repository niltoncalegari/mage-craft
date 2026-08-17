/**
 * Whether the player has asked the system for less motion.
 *
 * This matters more here than the preference usually does. A shooter is played
 * in bursts and the camera answers to the hand holding it; an idle match is
 * *watched*, for minutes at a stretch, by someone whose only job is reading the
 * field — and motion you did not ask for and cannot stop is exactly the case
 * `prefers-reduced-motion` exists for.
 *
 * Cached with a listener rather than read per frame: `matchMedia` is a live
 * object, and the preference changes about as often as a person changes their
 * mind about it. Guarded for the test environment, which is `node` (see
 * `vite.config.ts`) and has no `window` at all.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined' || !window.matchMedia) {
    cached = false;
    return cached;
  }

  const media = window.matchMedia(QUERY);
  cached = media.matches;
  media.addEventListener('change', (event) => {
    cached = event.matches;
  });
  return cached;
}
