/**
 * What an effect running *on* a mage sheds, one row per {@link FxKind}.
 *
 * Split out of {@link ParticleRenderer} for the same reason `spellVfx.ts` was:
 * the table stopped being the particle renderer's private business the moment
 * it started drifting from the catalog. A status effect reaches the client
 * generically — `buildSnapshot` maps the list, so a kind added to
 * `balance.json` is on the wire the same day — and **nothing then requires
 * anyone to draw it**. The emission loop walks this table and skips what is not
 * in it, which is how the Tier 2 pass shipped four effects that shed nothing at
 * all. Out here the table can be held against `EFFECT_ORDER` by a test; in
 * there it could not.
 *
 * **Emission only.** The rings, the body tint, the vulnerability shell and the
 * executioner's drop live in `PlayerRenderer`, because they are per-mage cloned
 * materials and this file owns none of them. So a kind belongs here when a
 * *stream of particles* says something the silhouette does not, and belongs in
 * {@link TELL_ELSEWHERE} when the silhouette already says it.
 *
 * The particle pool is a shared 900 and `spawnParticle` silently drops a
 * request when it is full, so a continuous emission has to be cheap: a burning
 * squad of four must not starve the impact bursts of their own fight. The
 * intervals are that budget, and `effectVfx.test.ts` adds it up.
 */

import type { FxKind } from '../game/effects';

export interface EffectEmission {
  readonly kind: FxKind;
  /** Seconds between motes at one stack. */
  readonly interval: number;
  /**
   * Whether deeper stacks emit proportionally faster. On for burn — the only
   * cue that a mage is three stacks deep rather than one — and meaningless for
   * anything that does not stack.
   */
  readonly perStack: boolean;
  readonly colors: readonly number[];
  /** Ring around the mage the mote appears on: base radius plus random spread. */
  readonly radius: number;
  readonly spread: number;
  /** Height band above the ground it appears in. */
  readonly height: number;
  readonly heightSpread: number;
  /** Outward horizontal speed, and vertical speed (negative sinks). */
  readonly drift: number;
  readonly rise: number;
  readonly size: number;
  readonly life: number;
  readonly gravityScale: number;
}

/**
 * Effects deliberately absent from {@link EFFECT_VFX}, and where they are drawn
 * instead. The value is the `PlayerRenderer` member that carries the tell, so a
 * claim made here can be checked by opening one file.
 *
 * This is the allowlist half of the coverage test, and it exists so that "this
 * effect has no particles" has to be *written down* rather than being what
 * happens when nobody decides. All seven of these have a ring, a shell, a tint
 * or an overhead marker already; a second cue would say the same thing twice
 * and pay for it out of a pool that fails silently.
 */
export const TELL_ELSEWHERE: Readonly<Partial<Record<FxKind, string>>> = {
  slow: 'slowRing, plus the frost body tint',
  haste: 'hasteRing',
  shield: 'shieldRing and shieldDome',
  stun: 'stunMotes over the crown',
  vulnerable: 'vulnerableShell',
  marked: 'markDrop, the blood drop over the crown',
  petrify: 'the whole body turned to stone, and the animation stopped',
};

export const EFFECT_VFX: readonly EffectEmission[] = [
  {
    kind: 'burn',
    interval: 0.055,
    perStack: true,
    colors: [0xffb238, 0xff5a1f, 0xffe9a8],
    radius: 0.1,
    spread: 0.28,
    height: 0.15,
    heightSpread: 0.7,
    drift: 0.25,
    rise: 1.25,
    size: 0.09,
    life: 0.42,
    /** Flames rise, so gravity works against them rather than for them. */
    gravityScale: -0.35,
  },
  {
    /** A note sagging off a mage whose concentration is being jammed. */
    kind: 'cast_slow',
    interval: 0.34,
    perStack: false,
    colors: [0xf72585],
    radius: 0.34,
    spread: 0,
    height: 1.25,
    heightSpread: 0.25,
    drift: 0.12,
    rise: -0.15,
    size: 0.06,
    life: 0.75,
    gravityScale: 0.12,
  },
  {
    /*
     * The one effect in the Tier 1 deck with no tell at all before this. Two of
     * the seven cards apply it (Bênção de Ímpeto, Campo de Sobrecarga), and a
     * mage charging faster looks exactly like a mage charging — which makes
     * "did my buff land?" unanswerable from the field.
     *
     * Deliberately the mirror of `cast_slow` above: same band, same size, rises
     * where that one sags. The pair is the read.
     */
    kind: 'cast_haste',
    interval: 0.3,
    perStack: false,
    colors: [0xffe9a8, 0xffd166],
    radius: 0.34,
    spread: 0,
    height: 0.9,
    heightSpread: 0.3,
    drift: 0.12,
    rise: 0.85,
    size: 0.06,
    life: 0.7,
    gravityScale: -0.05,
  },
  {
    /*
     * Raízes Entrelaçadas is the only card that applies this, and it is the one
     * card whose cast beat outlives the cast (`SpellVfx.persist`) precisely
     * because a rooted mage looks exactly like a standing one. That growth is
     * on the *ground*, though, and the mage is what the player is watching — so
     * this is the half of the answer that travels with the body.
     *
     * Low, wide and heavy: soil coming apart at the ankles, falling back down.
     * Nothing else here emits below the knee, which is the whole read — a mage
     * with dirt around his feet is a mage who is not going anywhere.
     */
    kind: 'root',
    interval: 0.26,
    perStack: false,
    colors: [0x8f6b3a, 0x4a7c2f, 0x243d19],
    radius: 0.3,
    spread: 0.16,
    height: 0.04,
    heightSpread: 0.18,
    drift: 0.18,
    rise: 0.5,
    size: 0.07,
    life: 0.4,
    /** Clods, not embers: they go up a little and come straight back down. */
    gravityScale: 0.9,
  },
  {
    /*
     * The mirror of `burn`, and written to be read as one. Both are a stream
     * off the body over time and both mean the health bar is moving on its own;
     * what separates them is direction of *feeling* rather than of travel —
     * embers are hot, fast and ragged, this is slow, pale and even.
     *
     * Deliberately gentler than the fire it answers: a third of the rate, twice
     * the life. A regen loud enough to compete with a burn would make a mage
     * being healed harder to read than one being killed.
     */
    kind: 'regen',
    interval: 0.22,
    perStack: false,
    colors: [0xeaffd0, 0xa8e06a, 0x6fb04a],
    radius: 0.16,
    spread: 0.24,
    height: 0.12,
    heightSpread: 0.75,
    drift: 0.1,
    rise: 0.75,
    size: 0.07,
    life: 0.8,
    gravityScale: -0.12,
  },
  {
    /*
     * Solo Consagrado applies this and `regen` in the same cast, so the two
     * have to be separable while overlapping on the same body: this one hugs
     * the floor and that one climbs past the shoulders.
     *
     * It also has to be separable from `cast_haste`, the other warm gold in the
     * table, and the split is the same one the cards make. Bênção quickens a
     * mind, so its motes sit overhead at head height; being braced happens to a
     * *body*, so this is a low skirt of light at the boots that barely rises.
     */
    kind: 'fortify',
    interval: 0.24,
    perStack: false,
    colors: [0xfff4d6, 0xffd97d, 0xd9a441],
    radius: 0.42,
    spread: 0.06,
    height: 0.02,
    heightSpread: 0.12,
    drift: -0.14,
    rise: 0.34,
    size: 0.055,
    life: 0.5,
    gravityScale: -0.02,
  },
  {
    /*
     * A bond has no body of its own to draw. The honest picture would be a line
     * between the bound mages, which is the `link` shape the catalog has been
     * putting off since the VFX pass because the `SpellCast` event carries a
     * centre and a radius and not two ends.
     *
     * This is the half that does not need one: a thin thread of dark red
     * spooling *off* each bound mage at waist height and falling away, so a
     * player scanning a scrum sees which bodies are wired together by seeing
     * which of them are unravelling. It reads as connection by repetition
     * rather than by geometry — the same colour on four mages at once is the
     * only thing in the emission table that ever appears in a set.
     */
    kind: 'linked',
    interval: 0.3,
    perStack: false,
    colors: [0x8b0d1f, 0xd62839],
    radius: 0.36,
    spread: 0.04,
    height: 0.75,
    heightSpread: 0.15,
    drift: 0.35,
    rise: -0.3,
    size: 0.05,
    life: 0.55,
    gravityScale: 0.25,
  },
  {
    /*
     * `linked`'s mirror, and drawn as one on purpose: the same thread at the
     * same height off the same waist, running the other way. Black's spools off
     * the body and falls; this one climbs and holds, because what it is doing
     * is carrying weight rather than leaking it.
     *
     * A player who has seen one should recognise the other instantly and know
     * only that they are opposites — which is the truth about the two cards.
     */
    kind: 'bonded',
    interval: 0.3,
    perStack: false,
    colors: [0xfff4d6, 0xffd97d],
    radius: 0.36,
    spread: 0.04,
    height: 0.75,
    heightSpread: 0.15,
    drift: -0.3,
    rise: 0.35,
    size: 0.05,
    life: 0.55,
    gravityScale: -0.1,
  },
  {
    /*
     * The only outward emission in the table. Everything else here rises off a
     * mage or falls around one; Frenesi Sanguinário is the one status that is
     * about what its carrier is going to do to *somebody else*, and motes
     * thrown away from the chest are the only shape that says so.
     *
     * Kept short-lived and few, because it lands on a whole squad at once and a
     * generous emission times four bodies is what empties the pool. Red rather
     * than orange, and no fringe of white, so a frenzied mage is never mistaken
     * for a burning one at a glance.
     */
    kind: 'empower',
    interval: 0.2,
    perStack: false,
    colors: [0xffb3b3, 0xe63946, 0x8b0d1f],
    radius: 0.26,
    spread: 0.1,
    height: 0.55,
    heightSpread: 0.4,
    drift: 0.95,
    rise: 0.1,
    size: 0.065,
    life: 0.28,
    gravityScale: 0.35,
  },
];

/**
 * The per-mage accumulators the emission loop counts down, one per row.
 *
 * A factory rather than a length the renderer writes for itself: the loop
 * indexes these *by position in the table*, so a row added here and an array
 * sized somewhere else is a new effect reading past the end of the array and
 * never emitting — silent, and the same silence this file was extracted to end.
 */
export function newEmissionTimers(): number[] {
  return new Array<number>(EFFECT_VFX.length).fill(0);
}
