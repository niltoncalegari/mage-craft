import { describe, expect, it } from 'vitest';
import { ShakeRig } from './ShakeRig';

/**
 * The shake is the one piece of Phase 10 feedback that can make the game
 * *worse*: an idle match is read, not reacted to, and a camera that keeps
 * moving hides the cluster the next rule is about to be evaluated against. So
 * what is worth pinning is the containment — that it decays, that it cannot be
 * stacked past the cap, and that reduced motion silences it at the source.
 */

const DT = 1 / 60;

function noisy(muted = false): ShakeRig {
  return new ShakeRig(() => muted);
}

/** Runs the rig for `seconds` and reports the largest offset seen on either axis. */
function peakOver(rig: ShakeRig, seconds: number): number {
  let peak = 0;
  for (let t = 0; t < seconds; t += DT) {
    rig.update(DT);
    peak = Math.max(peak, Math.abs(rig.offsetX), Math.abs(rig.offsetY));
  }
  return peak;
}

describe('ShakeRig', () => {
  it('sits perfectly still until something happens', () => {
    const rig = noisy();
    expect(peakOver(rig, 1)).toBe(0);
    expect(rig.offsetX).toBe(0);
    expect(rig.offsetY).toBe(0);
  });

  it('decays back to nothing on its own', () => {
    const rig = noisy();
    rig.addTrauma(0.6);
    peakOver(rig, 2);
    expect(rig.level).toBe(0);
    expect(rig.offsetX).toBe(0);
    expect(rig.offsetY).toBe(0);
  });

  it('clears fast enough to hand the field back', () => {
    const rig = noisy();
    rig.addTrauma(0.35); // a Chuva de Meteoros
    // Half a second is roughly the cast beat's own lifetime; the shake must not
    // outlive the thing it is punctuating.
    peakOver(rig, 0.5);
    expect(rig.level).toBe(0);
  });

  it('cannot be stacked past the cap', () => {
    const rig = noisy();
    for (let i = 0; i < 20; i++) rig.addTrauma(0.6);
    expect(rig.level).toBe(1);
    // One frame of full trauma is the worst offset the camera can ever take.
    rig.update(DT);
    expect(Math.abs(rig.offsetX)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(rig.offsetY)).toBeLessThanOrEqual(0.35);
  });

  it('is quadratic, so a light event stays much lighter than a heavy one', () => {
    const light = noisy();
    light.addTrauma(0.3);
    const heavy = noisy();
    heavy.addTrauma(0.6);
    // Twice the trauma is four times the offset, not twice — that ratio is the
    // whole reason a common cast can carry a little without feeling like one.
    expect(peakOver(heavy, 0.2)).toBeGreaterThan(peakOver(light, 0.2) * 2);
  });

  it('stays silent under reduced motion, however hard it is hit', () => {
    const rig = noisy(true);
    rig.addTrauma(1);
    expect(rig.level).toBe(0);
    expect(peakOver(rig, 1)).toBe(0);
  });

  it('ignores a zero or negative event rather than banking it', () => {
    const rig = noisy();
    rig.addTrauma(0);
    rig.addTrauma(-1);
    expect(rig.level).toBe(0);
  });
});
