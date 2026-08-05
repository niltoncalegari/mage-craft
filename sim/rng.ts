/**
 * Small seeded PRNG (mulberry32) replacing Go's `math/rand`.
 *
 * An authoritative simulation must be reproducible: given the same seed and
 * the same inputs, two runs have to make the same decisions. `Math.random()`
 * cannot offer that, so the bot AI takes an explicit Rng instead.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Keep the seed in uint32 range; 0 is a valid state for mulberry32.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
