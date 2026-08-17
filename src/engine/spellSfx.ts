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
   * Two dry ticks and nothing else — the shortest sound in the catalog, and the
   * only one with no body under it. Everything else here is a swell, a squelch
   * or an impact; this is a pair of clicks, which is what a card that does no
   * damage on arrival has earned. When it eventually pays, the payment is heard
   * as somebody dying, not as this.
   */
  executioners_mark: {
    detune: 0.02,
    layers: [
      { kind: 'noise', filter: 'highpass', from: 2600, to: 3400, at: 0, duration: 0.05, gain: 0.04 },
      { kind: 'noise', filter: 'highpass', from: 2200, to: 2800, at: 0.11, duration: 0.06, gain: 0.032 },
    ],
  },
  /*
   * The one buff that should not sound kind. Bênção, Escudo Arcano and Solo
   * Consagrado are all consonant; this is a squad being wound up, so it is a
   * square snarling upward under a short hard noise — nearer Praga's family
   * than to the other three cards that help you.
   */
  blood_frenzy: {
    detune: 0.06,
    layers: [
      { kind: 'tone', wave: 'square', freq: 98, toFreq: 196, at: 0, duration: 0.32, gain: 0.05 },
      { kind: 'noise', filter: 'bandpass', from: 1600, to: 700, at: 0, duration: 0.16, gain: 0.045, q: 2 },
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
   * The only card in the catalog whose sound has to cover a *wait*. Everything
   * else here is the whole event; this is a low swell rising under a second and
   * a bit of silence on screen, and then the rupture.
   *
   * The swell is what stops the telegraph reading as a card that failed. It
   * climbs rather than sits — 40Hz to 70Hz over the warning — so a player who
   * is not looking at that corner of the field still knows something is coming
   * and roughly how soon. The break lands with the jets rather than with the
   * cast, a hair early: the ground cracking just before rock comes out of it.
   *
   * This is the card that made the sound budget bite. Nothing may ring longer
   * than the global cooldown, so the whole card — warning and rupture — has to
   * fit in 0.75s, and that ceiling is what set the telegraph in `spellVfx.ts`
   * rather than the other way round.
   *
   * Chuva de Meteoros is the card to be told apart from, and the two are
   * opposites in time: the shower is loudest at the start and decays for half a
   * second, this is near-silent at the start and arrives at the end.
   */
  volcanic_eruption: {
    detune: 0.03,
    layers: [
      { kind: 'tone', wave: 'triangle', freq: 40, toFreq: 70, at: 0, duration: 0.6, gain: 0.05 },
      { kind: 'noise', filter: 'lowpass', from: 200, to: 700, at: 0.1, duration: 0.5, gain: 0.03 },
      { kind: 'noise', filter: 'bandpass', from: 900, to: 260, at: 0.6, duration: 0.15, gain: 0.06, q: 1.2 },
      { kind: 'tone', wave: 'square', freq: 96, toFreq: 44, at: 0.6, duration: 0.15, gain: 0.055 },
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
   * Glass growing. A bright bandpass opening upward — the opposite sweep to
   * Raízes Entrelaçadas, which snaps shut — over a high tone that climbs and
   * then simply stays, because what this card leaves behind does not settle or
   * decay: it stands there.
   *
   * The fourth green and the one that must not be mistaken for the roots. That
   * one is timber and closes; this is crystal and opens.
   */
  crystal_rift: {
    detune: 0.03,
    layers: [
      { kind: 'noise', filter: 'bandpass', from: 700, to: 4200, at: 0, duration: 0.3, gain: 0.04, q: 2 },
      { kind: 'tone', wave: 'triangle', freq: 587.33, toFreq: 880, at: 0.05, duration: 0.34, gain: 0.045 },
      { kind: 'chord', wave: 'sine', freqs: [1174.66, 1567.98], at: 0.22, duration: 0.28, gain: 0.025 },
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
   * A slab landing and then nothing. One very short low thud with a lowpass
   * slammed shut over it — no tail, no ring, no motion after the first 80ms,
   * which is the only sound in the catalog that simply stops. Everything else
   * decays; stone does not decay, it is just suddenly there.
   */
  petrify: {
    detune: 0.015,
    layers: [
      { kind: 'noise', filter: 'lowpass', from: 900, to: 90, at: 0, duration: 0.08, gain: 0.055 },
      { kind: 'tone', wave: 'triangle', freq: 84, toFreq: 52, at: 0, duration: 0.14, gain: 0.05 },
    ],
  },
  /*
   * A crack, then the roll after it. The crack is the shortest, brightest noise
   * in the catalog — a highpass slammed open and shut in 40ms — and the roll
   * underneath is the only layer here that *starts late* rather than at zero,
   * which is what makes the two read as one event at a distance rather than as
   * two sounds. Petrificar is the other card that begins with a hard tick; that
   * one stops dead where this one keeps rumbling.
   */
  thunderstrike: {
    detune: 0.04,
    layers: [
      { kind: 'noise', filter: 'highpass', from: 3600, to: 1200, at: 0, duration: 0.04, gain: 0.07 },
      { kind: 'tone', wave: 'sawtooth', freq: 320, toFreq: 60, at: 0, duration: 0.18, gain: 0.05 },
      { kind: 'noise', filter: 'lowpass', from: 800, to: 120, at: 0.06, duration: 0.42, gain: 0.055 },
    ],
  },
  /*
   * A note bending down and refusing to arrive. The only layer in the catalog
   * with no attack and no end — it fades rather than stopping, because the card
   * does not finish when the sound does: the pull runs for three more seconds
   * that no sound is allowed to cover (nothing may ring past the global
   * cooldown), and a sound that ended cleanly would say the card had.
   *
   * Read against Dobra Espacial, blue's other card about space: that one closes
   * on an arrival, this one opens on something that never lands.
   */
  gravity_well: {
    detune: 0.03,
    layers: [
      { kind: 'tone', wave: 'sine', freq: 196, toFreq: 65, at: 0, duration: 0.55, gain: 0.05 },
      { kind: 'tone', wave: 'triangle', freq: 293.66, toFreq: 98, at: 0.06, duration: 0.5, gain: 0.035 },
      { kind: 'noise', filter: 'lowpass', from: 1200, to: 240, at: 0, duration: 0.5, gain: 0.03 },
    ],
  },
  /*
   * An intake of air and then bodies where there were none. The only sound in
   * the catalog that runs *backwards* — a filter opening upward under a tone
   * that falls into it, so the impact reads as a thing being pulled shut rather
   * than a thing striking.
   *
   * It has to be told apart from Escudo Arcano, which is the other card that
   * snaps closed over your own squad. That one ticks first and rings after;
   * this one has no attack at all until the very end, where the arrival lands.
   */
  spatial_fold: {
    detune: 0.03,
    layers: [
      { kind: 'noise', filter: 'highpass', from: 300, to: 4200, at: 0, duration: 0.26, gain: 0.035 },
      { kind: 'tone', wave: 'sine', freq: 880, toFreq: 220, at: 0.04, duration: 0.24, gain: 0.04 },
      { kind: 'noise', filter: 'bandpass', from: 1400, to: 600, at: 0.28, duration: 0.08, gain: 0.05, q: 2 },
    ],
  },
  /*
   * The card whose effect the player cannot see, so this is the whole of the
   * confirmation that it landed — nothing on the field changes for twelve
   * seconds except a number in the corner.
   *
   * A rising open fifth on sines, clean and slow, and the only layer in the
   * file with no noise under it at all. Everything else here has grit because
   * everything else here hits something; this one is the sound of a channel
   * opening, which has no impact in it to voice.
   */
  mana_flow: {
    detune: 0.02,
    layers: [
      { kind: 'tone', wave: 'sine', freq: 330, toFreq: 494, at: 0, duration: 0.4, gain: 0.045 },
      { kind: 'chord', wave: 'sine', freqs: [659.25, 987.77], at: 0.14, duration: 0.34, gain: 0.03 },
    ],
  },
  /*
   * The only sound in the catalog that goes *away*. Every other card here
   * arrives — an impact, a swell, a crack — and this one is a bright band of
   * noise closing to nothing in a fifth of a second, with a tone sliding down
   * under it and stopping short. It should read as a thing being switched off,
   * because that is precisely what the card does.
   *
   * Petrificar is the other card that simply stops, and the two are told apart
   * by where they live: stone is a low thud with everything above 200Hz gone,
   * this is all top end and no body at all.
   */
  null_flash: {
    detune: 0.03,
    layers: [
      { kind: 'noise', filter: 'bandpass', from: 5200, to: 900, at: 0, duration: 0.2, gain: 0.05, q: 1.5 },
      { kind: 'tone', wave: 'sine', freq: 1320, toFreq: 210, at: 0, duration: 0.16, gain: 0.035 },
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
   * The fourth white, and the only one that is not addressed to the squad
   * standing there — it is addressed to the ones who are down. So it is the
   * only card in the catalog built on a *rising* interval played twice: a
   * fourth, struck and struck again a beat later, which is the shape of a call
   * rather than of a chord.
   *
   * Bright and hard where Solo Consagrado is hollow and slow, because these two
   * are the white pair most likely to be confused now: both are wide discs cast
   * over your own people.
   */
  call_to_battle: {
    detune: 0.02,
    layers: [
      { kind: 'chord', wave: 'square', freqs: [392, 523.25], at: 0, duration: 0.16, gain: 0.045 },
      { kind: 'chord', wave: 'square', freqs: [523.25, 698.46], at: 0.18, duration: 0.22, gain: 0.045 },
      { kind: 'noise', filter: 'highpass', from: 1800, to: 3200, at: 0, duration: 0.1, gain: 0.03 },
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
  /*
   * The answer to Vínculo da Dor, and written as one: the same two tones, the
   * same slide toward each other — except these two *arrive*. Black's pair
   * stops a tritone apart and beats against itself; this one closes on a
   * unison, which is the only resolution in the catalog.
   *
   * Sine rather than square, because the black card is a web being pulled tight
   * and this is a squad agreeing to share.
   */
  bond_of_solidarity: {
    detune: 0.02,
    layers: [
      { kind: 'tone', wave: 'sine', freq: 349.23, toFreq: 440, at: 0, duration: 0.4, gain: 0.045 },
      { kind: 'tone', wave: 'sine', freq: 554.37, toFreq: 440, at: 0, duration: 0.4, gain: 0.04 },
      { kind: 'noise', filter: 'highpass', from: 1200, to: 2600, at: 0, duration: 0.1, gain: 0.025 },
    ],
  },
  /*
   * A web being drawn tight. Two square tones a tritone apart, sliding toward
   * each other without arriving — the one interval in the file more unpleasant
   * than Tributo Obscuro's minor second, and it has to be, because these are
   * the two black cards and they must not be confused.
   *
   * The tribute is a *cost*: struck, held, over. This one keeps moving for a
   * third of a second after it lands, which is the right sentence for a card
   * whose damage has not happened yet and will arrive later, from somewhere
   * else, whenever the enemy next swings.
   */
  bond_of_pain: {
    detune: 0.035,
    layers: [
      { kind: 'tone', wave: 'square', freq: 220, toFreq: 262, at: 0, duration: 0.38, gain: 0.045 },
      { kind: 'tone', wave: 'square', freq: 311, toFreq: 268, at: 0, duration: 0.38, gain: 0.04 },
      { kind: 'noise', filter: 'bandpass', from: 1800, to: 500, at: 0, duration: 0.12, gain: 0.035, q: 3 },
    ],
  },
  /*
   * The other black card, and the one that has to sound like a *cost*. Every
   * buff in the catalog is consonant or bright; this one helps the player who
   * cast it and still has to be unpleasant, because what it did was hurt his
   * own squad.
   *
   * So: a minor second, held — two tones a semitone apart, which is the one
   * interval in this file that does not resolve — over a short wet thud. The
   * beating between them is the sound of the bargain.
   */
  dark_tribute: {
    detune: 0.025,
    layers: [
      { kind: 'chord', wave: 'triangle', freqs: [146.83, 155.56], at: 0, duration: 0.42, gain: 0.05 },
      { kind: 'noise', filter: 'lowpass', from: 700, to: 120, at: 0, duration: 0.14, gain: 0.05 },
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
