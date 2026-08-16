/**
 * What a card sounds like when it lands (GDD §17), as a sibling of `SPELL_VFX`.
 *
 * **Spells have been silent since they were written.** `SpellCast` has been on
 * the event bus since the v1.1 pivot and the {@link AudioManager} subscribed to
 * seven events, none of them that one — so this table is not an expansion of
 * spell audio, it is the whole of it.
 *
 * Sound carries more of the load here than it would in a game with a hand on
 * it. Nobody clicks during an idle match: the player wrote a program before it
 * started and is now watching to find out whether it works. The trace panel
 * names the rule that fired, but only if he happens to be looking at the HUD
 * corner rather than at the field — a cast he *hears* is the confirmation that
 * reaches him wherever his eyes are. So each card is written to be told apart
 * from the other six with the screen ignored, and the same three questions the
 * beat answers apply: which card, where, and whose. The first is this table's
 * job; the third is the gain the manager multiplies it by (see
 * {@link ENEMY_CAST_GAIN}); the second is a stereo field this game does not
 * have and does not need, because the flash already points at the spot.
 *
 * Held against the catalog by `src/render/spellVfx.test.ts`, which owns the
 * same question for the beat and asks it of both tables at once.
 */

import type { Sound } from './synth';

/** A card's sound: layers over a shared timeline, and its per-firing wobble. */
export type SpellSound = Sound;

/**
 * How much of a cast reaches you when it was not yours.
 *
 * Not distance — the arena is small and the game has no stereo field. It is the
 * same distinction the white core flash draws on screen: your program spending
 * your mana is the event you are here for, and the opponent's is context. Loud
 * enough to be counted, quiet enough that you never mistake it for your own.
 */
export const ENEMY_CAST_GAIN = 0.45;

/**
 * Per-card sound. Written to be told apart by ear alone, in the pairs the
 * player will actually have to separate: the two green cards, and the two reds.
 */
export const SPELL_SFX: Readonly<Record<string, SpellSound>> = {
  /*
   * The one card that catches both squads, and the only one that is *switched
   * on* rather than thrown — the torus on screen says the same thing. So it
   * rises instead of falling, which no other card in the deck does, and it is
   * the only sawtooth: an electrical bed rather than an impact.
   */
  overload_field: {
    detune: 0.03,
    layers: [
      { kind: 'tone', wave: 'sawtooth', freq: 110, toFreq: 220, at: 0, duration: 0.45, gain: 0.045 },
      { kind: 'tone', wave: 'sawtooth', freq: 220, toFreq: 448, at: 0.02, duration: 0.4, gain: 0.028 },
      { kind: 'noise', filter: 'bandpass', from: 600, to: 2400, at: 0.05, duration: 0.35, gain: 0.035, q: 2 },
    ],
  },
  /*
   * The heaviest card in the deck, the only one allowed to move the camera, and
   * the only one with a sub under it. Everything else here lives above 100Hz;
   * the boom is what makes five mana audible as five mana.
   */
  meteor_shower: {
    detune: 0.02,
    layers: [
      { kind: 'noise', filter: 'lowpass', from: 3200, to: 180, at: 0, duration: 0.55, gain: 0.075 },
      { kind: 'tone', wave: 'sine', freq: 120, toFreq: 38, at: 0.05, duration: 0.5, gain: 0.095 },
      { kind: 'tone', wave: 'triangle', freq: 62, toFreq: 30, at: 0.1, duration: 0.45, gain: 0.045 },
    ],
  },
  /*
   * Read against Pântano Pegajoso, the card it shares a colour and a target
   * shape with. Praga boils *up* out of a bright puddle: a resonant bandpass
   * that opens, over a square blipping underneath. The swamp below is the same
   * idea inverted.
   */
  plague: {
    detune: 0.05,
    layers: [
      { kind: 'noise', filter: 'bandpass', from: 300, to: 900, at: 0, duration: 0.42, gain: 0.05, q: 4 },
      { kind: 'tone', wave: 'square', freq: 180, toFreq: 92, at: 0.04, duration: 0.3, gain: 0.035 },
    ],
  },
  /* Duller, browner, closing rather than opening — a squelch that settles. */
  sticky_swamp: {
    detune: 0.04,
    layers: [
      { kind: 'noise', filter: 'lowpass', from: 1400, to: 160, at: 0, duration: 0.5, gain: 0.055 },
      { kind: 'tone', wave: 'triangle', freq: 160, toFreq: 58, at: 0.05, duration: 0.4, gain: 0.05 },
    ],
  },
  /*
   * The other card that is unambiguously good news, so it has to be told apart
   * from Bênção de Ímpeto by ear and not by luck. Bênção is a triad struck at
   * once — an announcement. This is one sine gliding up a fifth over moving air:
   * a breath rather than a chord, which is also the difference between a burst
   * of speed and something that keeps giving for four seconds.
   */
  rejuvenating_breeze: {
    detune: 0.02,
    layers: [
      { kind: 'noise', filter: 'highpass', from: 400, to: 3000, at: 0, duration: 0.45, gain: 0.03 },
      { kind: 'tone', wave: 'sine', freq: 392, toFreq: 587.33, at: 0.05, duration: 0.35, gain: 0.04 },
    ],
  },
  /*
   * The third green, and the two it has to be told apart from both *fall*:
   * Praga's square drops 180→92, the swamp's triangle drops 160→58. So this one
   * climbs. Nothing else in the catalog does that except Campo de Sobrecarga,
   * which is a sawtooth bed and shares no timbre with a creak.
   *
   * Dry rather than wet, too. Both other greens are filtered noise standing in
   * for liquid; this is a short bandpass snap that closes fast — timber, not
   * mud — over a low triangle cinching upward. The card grabs and holds, and
   * the sound is the grab, not the hold.
   */
  entangling_roots: {
    detune: 0.045,
    layers: [
      { kind: 'noise', filter: 'bandpass', from: 2000, to: 400, at: 0, duration: 0.28, gain: 0.05, q: 3 },
      { kind: 'tone', wave: 'triangle', freq: 70, toFreq: 130, at: 0.03, duration: 0.3, gain: 0.05 },
    ],
  },
  /*
   * The only consonant thing in the game. A major triad, played straight, is
   * the fastest way to say "this one was for us" to someone who is not looking
   * — every other card is noise or a sweep.
   */
  blessing: {
    detune: 0.02,
    layers: [
      { kind: 'chord', wave: 'triangle', freqs: [523.25, 659.25, 783.99], at: 0, duration: 0.34, gain: 0.055 },
      { kind: 'tone', wave: 'sine', freq: 784, toFreq: 1174.66, at: 0.08, duration: 0.22, gain: 0.03 },
    ],
  },
  /*
   * A dome snapping shut: a hard tick of high noise, a swept body under it, and
   * a fifth ringing after. The tick is what makes it read as a thing closing
   * rather than a thing arriving, which is the difference from Bênção — the two
   * white cards are the pair most likely to be confused.
   */
  arcane_shield: {
    detune: 0.02,
    layers: [
      { kind: 'noise', filter: 'highpass', from: 900, to: 2600, at: 0, duration: 0.12, gain: 0.045 },
      { kind: 'tone', wave: 'sine', freq: 300, toFreq: 900, at: 0.02, duration: 0.26, gain: 0.045 },
      { kind: 'chord', wave: 'triangle', freqs: [880, 1318.51], at: 0.1, duration: 0.3, gain: 0.03 },
    ],
  },
  /*
   * The third white, against two that are both fast. Bênção is a triad struck
   * at once and Escudo Arcano is a tick and a snap; this is the only card in
   * the catalog with no attack to speak of — a swell that arrives over half a
   * second, which is exactly how the card pays out.
   *
   * An open fifth rather than a major triad, so it does not merely read as a
   * slower Bênção. Hollow instead of bright, which is also the right word for
   * consecrated ground.
   */
  consecrated_ground: {
    detune: 0.015,
    layers: [
      { kind: 'chord', wave: 'triangle', freqs: [261.63, 392, 523.25], at: 0, duration: 0.5, gain: 0.05 },
      { kind: 'noise', filter: 'highpass', from: 200, to: 1200, at: 0, duration: 0.5, gain: 0.025 },
    ],
  },
  /* Falling, and the only card whose noise bed simply gets darker under it. */
  slow_curse: {
    detune: 0.03,
    layers: [
      { kind: 'tone', wave: 'sine', freq: 420, toFreq: 148, at: 0, duration: 0.4, gain: 0.06 },
      { kind: 'noise', filter: 'lowpass', from: 900, to: 200, at: 0, duration: 0.3, gain: 0.035 },
    ],
  },
};

/**
 * An unknown card is still heard, for the same reason it is still drawn: the
 * Tier 2/3 cards land one commit at a time, and a card that is silent *and*
 * unremarkable on screen is a card whose rule looks broken in the trace panel.
 * `spellVfx.test.ts` is what stops this from quietly becoming the default.
 */
export const DEFAULT_SPELL_SFX: SpellSound = {
  detune: 0.04,
  layers: [
    { kind: 'tone', wave: 'triangle', freq: 520, toFreq: 260, at: 0, duration: 0.28, gain: 0.05 },
    { kind: 'noise', filter: 'bandpass', from: 1200, to: 400, at: 0, duration: 0.24, gain: 0.035, q: 1 },
  ],
};

export function spellSfxFor(spellId: string): SpellSound {
  return SPELL_SFX[spellId] ?? DEFAULT_SPELL_SFX;
}
