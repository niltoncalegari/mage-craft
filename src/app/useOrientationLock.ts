import { useEffect, useState } from 'preact/hooks';

/**
 * True landscape lock (`screen.orientation.lock`) does not exist in mobile
 * Safari — Apple has never implemented it, not even for a home-screen PWA.
 * The only way to force a landscape-shaped layout on a phone held in
 * portrait is to rotate the whole app 90° with CSS; the player straightens
 * it out by physically turning their phone, at which point this hook detects
 * the real landscape orientation and the CSS drops the transform (see
 * `.force-landscape` in src/style.css).
 *
 * Gated to phone-sized touch screens (coarse pointer, narrow viewport) so a
 * tablet in portrait — which has room for a real portrait layout — is left
 * alone.
 */
const COARSE_POINTER = '(pointer: coarse)';
const PORTRAIT = '(orientation: portrait)';
const PHONE_WIDTH = '(max-width: 900px)';

function computeShouldRotate(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return (
    window.matchMedia(COARSE_POINTER).matches &&
    window.matchMedia(PORTRAIT).matches &&
    window.matchMedia(PHONE_WIDTH).matches
  );
}

export function useOrientationLock(): boolean {
  const [rotated, setRotated] = useState(computeShouldRotate);

  useEffect(() => {
    const queries = [window.matchMedia(COARSE_POINTER), window.matchMedia(PORTRAIT), window.matchMedia(PHONE_WIDTH)];
    const update = (): void => setRotated(computeShouldRotate());

    update();
    for (const q of queries) q.addEventListener('change', update);
    // Belt and suspenders: iOS Safari's matchMedia 'change' event for
    // orientation has historically been unreliable around the rotation
    // itself, where resize always fires.
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      for (const q of queries) q.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return rotated;
}
