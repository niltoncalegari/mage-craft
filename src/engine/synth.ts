/**
 * A small vocabulary of synthesised sound, as pure functions over a context
 * somebody else owns.
 *
 * Every sound in this game was, until now, a private method on
 * {@link AudioManager} with its node graph written out by hand — fine for the
 * seven noises a match made, hopeless for a card catalog. A card's *look* is
 * already a row in a table (`spellVfx.ts`); this is what lets its *sound* be a
 * row too, so adding a card stays an edit to data rather than a new method.
 *
 * **`ctx` and `dest` are arguments, not fields.** That is what makes these
 * testable at all: the suite runs on `environment: 'node'`, which has no
 * `AudioContext` and no `OfflineAudioContext` either, so the only way to look
 * at a node graph here is to hand one in (see `synth.test.ts`). It also happens
 * to be the right shape — a layer should not care whether it is going to the
 * master bus, a per-voice gain, or a send.
 */

/** The three things a layer can be. Kept small; a card is a stack of these. */
export type SynthLayer = ToneLayer | NoiseLayer | ChordLayer;

interface LayerBase {
  /** Offset from the start of the sound, in seconds. */
  at: number;
  duration: number;
  /** Peak gain of this layer alone. Roughly 0.02–0.10 in practice. */
  gain: number;
}

export interface ToneLayer extends LayerBase {
  kind: 'tone';
  wave: OscillatorType;
  freq: number;
  /** Sweep target; absent holds the pitch for the whole layer. */
  toFreq?: number;
}

export interface NoiseLayer extends LayerBase {
  kind: 'noise';
  filter: BiquadFilterType;
  /** Filter cutoff at the start and at the end — the sweep *is* the sound. */
  from: number;
  to: number;
  /** Filter resonance; higher is more pitched. Defaults to a gentle 0.7. */
  q?: number;
}

export interface ChordLayer extends LayerBase {
  kind: 'chord';
  wave: OscillatorType;
  freqs: readonly number[];
}

/**
 * Web Audio cannot ramp exponentially to zero, and a linear fade to silence
 * sounds like a click. Every envelope here starts and ends here instead.
 */
const SILENCE = 0.0001;
/** Attack, in seconds. Short enough to read as a transient, long enough not to pop. */
const ATTACK = 0.012;
/** Slack after the envelope before the node is stopped, so the tail is never clipped. */
const TAIL = 0.03;

/**
 * Disconnects the whole chain when the source ends.
 *
 * A cast fires every 0.75s per side for the length of a match — a few hundred
 * graphs. Leaking one node per cast is a leak nobody hears until the context
 * starts glitching several minutes in, which is exactly the kind of bug that
 * survives a smoke test.
 *
 * Exported because {@link AudioManager}'s hand-written sounds need exactly the
 * same thing, and two copies of "let go of the graph" is how one of them ends
 * up fixed and the other not.
 */
export function releaseOnEnd(source: AudioScheduledSourceNode, nodes: readonly AudioNode[], stopAt: number): void {
  source.addEventListener(
    'ended',
    () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
    },
    { once: true },
  );
  try {
    source.stop(stopAt);
  } catch {
    // Already stopped, or stopped by a voice that was cut short.
  }
}

/** Peak-then-decay envelope, written onto a gain node's param. */
function envelope(param: AudioParam, at: number, duration: number, peak: number): void {
  param.setValueAtTime(SILENCE, at);
  param.exponentialRampToValueAtTime(Math.max(SILENCE, peak), at + Math.min(ATTACK, duration * 0.5));
  param.exponentialRampToValueAtTime(SILENCE, at + duration);
}

/** One oscillator, optionally sweeping its pitch. The workhorse layer. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, layer: ToneLayer): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = layer.wave;
  osc.frequency.setValueAtTime(layer.freq, layer.at);
  if (layer.toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(SILENCE, layer.toFreq), layer.at + layer.duration);
  }
  envelope(gain.gain, layer.at, layer.duration, layer.gain);

  osc.connect(gain).connect(dest);
  osc.start(layer.at);
  releaseOnEnd(osc, [gain], layer.at + layer.duration + TAIL);
  return osc;
}

/**
 * Filtered noise. The buffer is passed in rather than made here because one
 * two-second buffer of white noise serves every noise layer in the game, and
 * generating it per cast would be 96k samples of `Math.random()` on the hot
 * path.
 */
export function noise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  layer: NoiseLayer,
): AudioScheduledSourceNode {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  source.buffer = buffer;
  filter.type = layer.filter;
  filter.frequency.setValueAtTime(Math.max(SILENCE, layer.from), layer.at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(SILENCE, layer.to), layer.at + layer.duration);
  filter.Q.setValueAtTime(layer.q ?? 0.7, layer.at);
  envelope(gain.gain, layer.at, layer.duration, layer.gain);

  source.connect(filter).connect(gain).connect(dest);
  // Offset into the buffer is left to the caller's discretion — starting every
  // noise layer at sample zero makes repeated casts sound stamped from the same
  // die, which is the thing `detune` exists to avoid.
  source.start(layer.at, noiseOffset(buffer), layer.duration + TAIL);
  releaseOnEnd(source, [filter, gain], layer.at + layer.duration + TAIL);
  return source;
}

/**
 * Several tones at once, sharing the layer's gain between them.
 *
 * Sharing rather than stacking is the whole point: three notes at the written
 * gain would be a chord three times louder than the tone on the line above it
 * in the same table, and the table would be lying about its own numbers.
 */
export function chord(ctx: BaseAudioContext, dest: AudioNode, layer: ChordLayer): AudioScheduledSourceNode[] {
  const share = layer.freqs.length > 0 ? layer.gain / layer.freqs.length : 0;
  return layer.freqs.map((freq) =>
    tone(ctx, dest, { kind: 'tone', wave: layer.wave, freq, at: layer.at, duration: layer.duration, gain: share }),
  );
}

/** A different slice of the noise buffer each time, so repeats do not stamp. */
function noiseOffset(buffer: AudioBuffer): number {
  return Math.random() * Math.max(0, buffer.duration - 0.5);
}

/**
 * A whole sound: layers stacked over a shared timeline, plus how far its pitch
 * is allowed to wander from one firing to the next.
 */
export interface Sound {
  readonly layers: readonly SynthLayer[];
  /**
   * Pitch variation per firing, as a fraction either side of the written
   * frequencies. Without it a card cast forty times in a match sounds like a
   * sample being retriggered — the one thing that makes synthesised audio read
   * as cheap. 0 means the sound is identical every time, on purpose.
   */
  readonly detune: number;
}

/** A sound in flight, from the point of view of whoever has to budget for it. */
export interface Voice {
  /** Context time the last layer stops ringing. */
  readonly endsAt: number;
  /** Cuts the voice short, fading rather than severing. Safe to call twice. */
  stop(at: number): void;
}

/** How long a cut voice takes to get out of the way. Short, but not a click. */
const CUT_FADE = 0.02;

/**
 * The multiplier a firing applies to every frequency in a sound.
 *
 * `roll` is a number in [0, 1) handed in by the caller rather than drawn here,
 * for the reason the whole codebase draws randomness from outside: it makes the
 * result something a test can state exactly. The simulation's determinism is
 * not at stake — audio never re-enters the sim — but a table of numbers whose
 * effect can only be checked by ear is a table that drifts.
 */
export function pitchScale(detune: number, roll: number): number {
  if (detune <= 0) return 1;
  return 1 + detune * (roll * 2 - 1);
}

/**
 * Plays a sound, scaled and detuned, as a single voice.
 *
 * Everything goes through one gain node. That is what makes "the enemy's cast,
 * across the field" one number at the call site instead of a rewrite of every
 * layer's gain — and it is what gives {@link Voice.stop} something to fade.
 */
export function playSound(
  ctx: BaseAudioContext,
  dest: AudioNode,
  sound: Sound,
  buffer: AudioBuffer,
  opts: { at: number; gain: number; roll: number },
): Voice {
  const bus = ctx.createGain();
  bus.gain.value = opts.gain;
  bus.connect(dest);

  const pitch = pitchScale(sound.detune, opts.roll);
  const sources: AudioScheduledSourceNode[] = [];
  let endsAt = opts.at;

  for (const layer of sound.layers) {
    const at = opts.at + layer.at;
    endsAt = Math.max(endsAt, at + layer.duration);

    switch (layer.kind) {
      case 'tone':
        sources.push(
          tone(ctx, bus, {
            ...layer,
            at,
            freq: layer.freq * pitch,
            toFreq: layer.toFreq === undefined ? undefined : layer.toFreq * pitch,
          }),
        );
        break;
      case 'noise':
        // The filter sweep is detuned too: the cutoff is what gives a noise
        // layer its pitch, so leaving it fixed would make half of every sound
        // vary and the other half stand still.
        sources.push(noise(ctx, bus, buffer, { ...layer, at, from: layer.from * pitch, to: layer.to * pitch }));
        break;
      case 'chord':
        sources.push(...chord(ctx, bus, { ...layer, at, freqs: layer.freqs.map((freq) => freq * pitch) }));
        break;
    }
  }

  releaseBusWhenSilent(bus, sources);

  return {
    endsAt,
    stop(at: number): void {
      bus.gain.setValueAtTime(Math.max(SILENCE, opts.gain), at);
      bus.gain.exponentialRampToValueAtTime(SILENCE, at + CUT_FADE);
      for (const source of sources) {
        try {
          source.stop(at + CUT_FADE);
        } catch {
          // Never started, or already stopped by its own schedule.
        }
      }
    },
  };
}

/**
 * A ceiling on how many sounds may be ringing at once.
 *
 * Nothing in this game has ever needed one, because nothing played at this
 * rate: the hand-written sounds fire a handful of times a round, while two
 * Tacticians on a 0.75s global cooldown are a few hundred casts over a match.
 * Voices that pile up do not fail loudly — the context glitches and thins out
 * several minutes in, which is past the end of every test and every smoke run
 * this repo has.
 *
 * When it is full the **oldest** ringing voice is cut, not the newest refused.
 * The newcomer is the cast that just happened and the one the player is waiting
 * to be told about; the voice being cut is already most of the way through
 * being heard, and it fades rather than stopping dead.
 */
export class VoiceBudget {
  private readonly voices: Voice[] = [];

  constructor(private readonly limit: number) {}

  /** How many voices are still believed to be ringing. */
  get active(): number {
    return this.voices.length;
  }

  admit(voice: Voice, now: number): void {
    // Voices are dropped by their own schedule rather than by a callback: the
    // context's clock already knows when each one ended, so asking it is
    // cheaper and cannot leak an entry if an `ended` event never arrives.
    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      if (this.voices[i].endsAt <= now) this.voices.splice(i, 1);
    }
    while (this.voices.length >= this.limit) {
      this.voices.shift()?.stop(now);
    }
    this.voices.push(voice);
  }

  /** Cuts everything still ringing — the match view being torn down. */
  stopAll(now: number): void {
    for (const voice of this.voices) voice.stop(now);
    this.voices.length = 0;
  }
}

/** Disconnects the shared gain once the last layer hanging off it has ended. */
function releaseBusWhenSilent(bus: GainNode, sources: readonly AudioScheduledSourceNode[]): void {
  let pending = sources.length;
  if (pending === 0) {
    bus.disconnect();
    return;
  }
  for (const source of sources) {
    source.addEventListener(
      'ended',
      () => {
        pending -= 1;
        if (pending === 0) bus.disconnect();
      },
      { once: true },
    );
  }
}
