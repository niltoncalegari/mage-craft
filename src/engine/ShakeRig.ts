import { prefersReducedMotion } from './reducedMotion';

/**
 * Trauma-based camera shake (GDD §17).
 *
 * Events add *trauma*; the offset is trauma **squared**, so a small event
 * barely moves the view and a large one snaps. Trauma decays linearly and is
 * hard-capped, which is what stops two heavy casts landing on the same tick
 * from flinging the camera off the arena.
 *
 * **Sized for a game you watch, not one you play.** The usual advice — 0.4 on a
 * hit, 0.7 on an explosion — assumes the shake is confirming something the
 * player's own hand just did, and that they are looking at their character. In
 * an idle match nobody's hand did anything, and the camera is the instrument
 * the *next* rule is read through: the player is watching a cluster form to see
 * whether his `enemy_cluster >= 3` guard fires. A camera that lurches hides
 * exactly that. So the offsets here are small, the decay is fast, and there is
 * no roll at all — rolling a tilted orthographic view of a bounded arena swings
 * the world's edges into frame, which is disorienting in a way a perspective
 * camera in an open level never is.
 *
 * Deliberately free of Three.js: it produces two numbers, {@link CameraController}
 * spends them. That is also what makes it testable in the `node` suite.
 */

const TRAUMA_MAX = 1;
/** Trauma units shed per second. Fast — the field has to come back quickly. */
const TRAUMA_DECAY = 1.8;
/** World units of offset at full trauma. The arena is ~40 wide, so this is subtle. */
const MAX_OFFSET = 0.35;
/** Shake frequency in Hz. High enough to read as a jolt rather than a sway. */
const SHAKE_HZ = 28;

/**
 * Deterministic value noise in [-1, 1]. Per-axis seeds keep the two axes
 * independent, so the camera jitters rather than sliding along a diagonal.
 */
function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export class ShakeRig {
  private trauma = 0;
  private time = 0;

  /** Current offset, in world units. Written by {@link update}. */
  offsetX = 0;
  offsetY = 0;

  /**
   * `muted` is injected rather than read from the media query directly so the
   * suite can drive both branches; it defaults to the real preference.
   */
  constructor(private readonly muted: () => boolean = prefersReducedMotion) {}

  /**
   * Adds trauma for an event. Refused outright under reduced motion — swallowed
   * here rather than at each call site, so a future event source cannot forget.
   */
  addTrauma(amount: number): void {
    if (amount <= 0 || this.muted()) return;
    this.trauma = Math.min(TRAUMA_MAX, this.trauma + amount);
  }

  /**
   * Advances the decay and recomputes the offset.
   *
   * `dt` is the renderer's fixed step, matching every other per-frame decay in
   * this codebase (`PlayerRenderer.RENDER_DT`, `ParticleRenderer.PARTICLE_DT`).
   * The consequence is the honest one: below 60fps a shake lasts longer in wall
   * clock than it should. Every other effect in the game already drifts the
   * same way, and a shake that decays on a different clock from the particles
   * it accompanies would look worse than one that is slightly too long.
   */
  update(dt: number): void {
    if (this.trauma <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    this.time += dt;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const shake = this.trauma * this.trauma;
    const freq = this.time * SHAKE_HZ;
    this.offsetX = MAX_OFFSET * shake * pseudoNoise(freq, 1);
    this.offsetY = MAX_OFFSET * shake * pseudoNoise(freq, 2);
  }

  /** For tests and diagnostics; the offset is the part anything else should read. */
  get level(): number {
    return this.trauma;
  }
}
