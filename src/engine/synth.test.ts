/**
 * The synthesis vocabulary, driven by a hand-written Web Audio double.
 *
 * The suite is `environment: 'node'` on purpose (see `vite.config.ts`), and
 * Node has neither `AudioContext` nor `OfflineAudioContext` — so the way to
 * test audio here is the way `loadout.test.ts` tests storage: pass the thing in
 * and stub it. That is also why `synth.ts` takes `ctx` and `dest` as arguments
 * instead of owning a context; the real one belongs to {@link AudioManager},
 * which cannot exist in this suite at all.
 *
 * What the double is for is the part of a sound nobody can hear a bug in: a
 * node that never gets disconnected leaks for the whole match, and a layer
 * scheduled at the wrong time is a beat that lands next to the flash instead of
 * on it. Both are invisible in the browser and both are trivial here.
 */

import { describe, expect, it } from 'vitest';
import { chord, noise, pitchScale, playSound, tone, type Sound } from './synth';

type ParamEventKind = 'set' | 'linear' | 'exp' | 'target';

interface ParamEvent {
  kind: ParamEventKind;
  value: number;
  time: number;
}

class FakeParam {
  readonly events: ParamEvent[] = [];
  value = 0;

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number): this {
    this.events.push({ kind: 'target', value, time });
    return this;
  }

  /** The largest value ever scheduled — a layer's audible peak. */
  get peak(): number {
    return this.events.reduce((max, e) => Math.max(max, e.value), 0);
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  readonly inputs: FakeNode[] = [];
  disconnects = 0;

  connect<T extends FakeNode>(dest: T): T {
    this.outputs.push(dest);
    dest.inputs.push(this);
    return dest;
  }
  disconnect(): void {
    this.disconnects += 1;
  }

  /** Whether a signal from here reaches `target` through any chain. */
  reaches(target: FakeNode): boolean {
    return this.outputs.some((out) => out === target || out.reaches(target));
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = '';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  private readonly onEnded: (() => void)[] = [];

  start(when = 0): void {
    this.startedAt = when;
  }
  stop(when = 0): void {
    // The real node keeps the earliest stop it was given, and throws on a few
    // shapes of double-stop; `synth.ts` guards for that, so the double stays
    // forgiving and just records the cut.
    this.stoppedAt = this.stoppedAt === null ? when : Math.min(this.stoppedAt, when);
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.onEnded.push(listener);
  }
  /** Fires what the browser fires when the scheduled stop time arrives. */
  end(): void {
    for (const listener of this.onEnded) listener();
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam();
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
}

class FakeContext {
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  get sources(): FakeSource[] {
    return [...this.oscillators, ...this.bufferSources];
  }
  get nodes(): FakeNode[] {
    return [...this.sources, ...this.gains, ...this.filters];
  }
  /** Every scheduled source reaching its stop time at once. */
  endAll(): void {
    for (const source of this.sources) source.end();
  }
}

/** The double, and the same object typed as the API under test. */
function makeContext(): { fake: FakeContext; ctx: AudioContext; dest: AudioNode } {
  const fake = new FakeContext();
  return {
    fake,
    ctx: fake as unknown as AudioContext,
    dest: fake.destination as unknown as AudioNode,
  };
}

const BUFFER = { duration: 2 } as unknown as AudioBuffer;

describe('tone', () => {
  it('plays into the destination it was handed, not the context output', () => {
    const { fake, ctx, dest } = makeContext();
    const other = new FakeNode();

    tone(ctx, dest, { kind: 'tone', wave: 'sine', freq: 440, at: 0, duration: 0.2, gain: 0.05 });

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0].reaches(fake.destination)).toBe(true);
    expect(fake.oscillators[0].reaches(other)).toBe(false);
  });

  it('runs for exactly the length it was asked for, starting when it was asked to', () => {
    const { fake, ctx, dest } = makeContext();
    fake.currentTime = 5;

    tone(ctx, dest, { kind: 'tone', wave: 'sine', freq: 440, at: 5.25, duration: 0.2, gain: 0.05 });

    const osc = fake.oscillators[0];
    expect(osc.startedAt).toBe(5.25);
    // Stopped after the envelope has finished, never before it.
    expect(osc.stoppedAt).toBeGreaterThanOrEqual(5.45);
  });

  it('sweeps to the second frequency only when one was named', () => {
    const { fake, ctx, dest } = makeContext();

    tone(ctx, dest, { kind: 'tone', wave: 'sawtooth', freq: 200, toFreq: 800, at: 0, duration: 0.3, gain: 0.05 });
    tone(ctx, dest, { kind: 'tone', wave: 'sine', freq: 300, at: 0, duration: 0.3, gain: 0.05 });

    const [swept, held] = fake.oscillators;
    expect(swept.frequency.events.at(-1)).toMatchObject({ value: 800, time: 0.3 });
    expect(held.frequency.events.map((e) => e.value)).toEqual([300]);
  });

  it('never schedules a gain of exactly zero', () => {
    // `exponentialRampToValueAtTime(0)` is a runtime error in Web Audio, and
    // the sound it kills is silent rather than loud — the failure this codebase
    // is least likely to notice.
    const { fake, ctx, dest } = makeContext();

    tone(ctx, dest, { kind: 'tone', wave: 'sine', freq: 440, at: 0, duration: 0.2, gain: 0.05 });

    for (const event of fake.gains[0].gain.events) {
      if (event.kind === 'exp') expect(event.value).toBeGreaterThan(0);
    }
    expect(fake.gains[0].gain.peak).toBeCloseTo(0.05);
  });

  it('lets go of every node it made once the source ends', () => {
    const { fake, ctx, dest } = makeContext();

    tone(ctx, dest, { kind: 'tone', wave: 'sine', freq: 440, at: 0, duration: 0.2, gain: 0.05 });
    expect(fake.nodes.every((n) => n.disconnects === 0)).toBe(true);

    fake.endAll();
    expect(fake.nodes.every((n) => n.disconnects === 1)).toBe(true);
  });
});

describe('noise', () => {
  it('plays the buffer it was handed, through the filter it was named', () => {
    const { fake, ctx, dest } = makeContext();

    noise(ctx, dest, BUFFER, {
      kind: 'noise',
      filter: 'lowpass',
      from: 3000,
      to: 200,
      at: 0,
      duration: 0.4,
      gain: 0.06,
    });

    const source = fake.bufferSources[0];
    expect(source.buffer).toBe(BUFFER);
    expect(source.reaches(fake.destination)).toBe(true);

    const filter = fake.filters[0];
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.events[0]).toMatchObject({ value: 3000, time: 0 });
    expect(filter.frequency.events.at(-1)).toMatchObject({ value: 200, time: 0.4 });
  });

  it('lets go of every node it made once the source ends', () => {
    const { fake, ctx, dest } = makeContext();

    noise(ctx, dest, BUFFER, {
      kind: 'noise',
      filter: 'bandpass',
      from: 400,
      to: 900,
      at: 0,
      duration: 0.3,
      gain: 0.04,
    });

    fake.endAll();
    expect(fake.nodes.every((n) => n.disconnects === 1)).toBe(true);
  });
});

describe('chord', () => {
  it('gives every note its own voice, all landing in the same place', () => {
    const { fake, ctx, dest } = makeContext();

    chord(ctx, dest, {
      kind: 'chord',
      wave: 'triangle',
      freqs: [523.25, 659.25, 783.99],
      at: 0,
      duration: 0.3,
      gain: 0.06,
    });

    expect(fake.oscillators).toHaveLength(3);
    expect(fake.oscillators.map((o) => o.frequency.events[0].value)).toEqual([523.25, 659.25, 783.99]);
    expect(fake.oscillators.every((o) => o.reaches(fake.destination))).toBe(true);
  });

  it('shares the layer gain across the notes instead of adding them up', () => {
    // Three oscillators at 0.06 each is a chord three times louder than the
    // single tone written next to it in the same table — the table would then
    // be lying about its own numbers.
    const { fake, ctx, dest } = makeContext();

    chord(ctx, dest, {
      kind: 'chord',
      wave: 'triangle',
      freqs: [400, 500, 600],
      at: 0,
      duration: 0.3,
      gain: 0.06,
    });

    const total = fake.gains.reduce((sum, g) => sum + g.gain.peak, 0);
    expect(total).toBeCloseTo(0.06);
  });

  it('lets go of every node it made once the sources end', () => {
    const { fake, ctx, dest } = makeContext();

    chord(ctx, dest, { kind: 'chord', wave: 'sine', freqs: [300, 450], at: 0, duration: 0.2, gain: 0.05 });

    fake.endAll();
    expect(fake.nodes.every((n) => n.disconnects === 1)).toBe(true);
  });
});

/**
 * A sound with one of each layer, so the assertions below can talk about
 * placement and pitch without caring which primitive did the work.
 */
const SOUND: Sound = {
  detune: 0.1,
  layers: [
    { kind: 'tone', wave: 'sine', freq: 400, toFreq: 200, at: 0, duration: 0.2, gain: 0.06 },
    { kind: 'noise', filter: 'lowpass', from: 2000, to: 500, at: 0.1, duration: 0.3, gain: 0.04 },
    { kind: 'chord', wave: 'triangle', freqs: [300, 600], at: 0.05, duration: 0.25, gain: 0.05 },
  ],
};

describe('playSound', () => {
  it('places each layer relative to the moment the sound starts', () => {
    const { fake, ctx, dest } = makeContext();
    fake.currentTime = 3;

    playSound(ctx, dest, SOUND, BUFFER, { at: 3, gain: 1, roll: 0.5 });

    // The tone at +0, the two chord notes at +0.05, the noise at +0.1.
    expect(fake.oscillators.map((o) => o.startedAt)).toEqual([3, 3.05, 3.05]);
    expect(fake.bufferSources[0].startedAt).toBe(3.1);
  });

  it('reports when the last layer has finished ringing', () => {
    const { fake, ctx, dest } = makeContext();
    void fake;

    const voice = playSound(ctx, dest, SOUND, BUFFER, { at: 3, gain: 1, roll: 0.5 });

    // The noise layer is the last to stop: 0.1 + 0.3.
    expect(voice.endsAt).toBeCloseTo(3.4);
  });

  it('carries the whole sound on one gain, so a quieter cast is one number', () => {
    const { fake, ctx, dest } = makeContext();

    playSound(ctx, dest, SOUND, BUFFER, { at: 0, gain: 0.45, roll: 0.5 });

    // Everything the destination hears comes through a single node, and that
    // node is where "this cast was the enemy's" lives — the layer table itself
    // is written once and is not rewritten per cast.
    expect(fake.destination.inputs).toHaveLength(1);
    expect((fake.destination.inputs[0] as FakeGain).gain.value).toBeCloseTo(0.45);
  });

  it('shifts the whole sound in pitch by the roll it was given', () => {
    const { fake, ctx, dest } = makeContext();

    playSound(ctx, dest, SOUND, BUFFER, { at: 0, gain: 1, roll: 0 });

    // roll 0 is the bottom of the ±detune window: everything a tenth flatter.
    expect(fake.oscillators[0].frequency.events[0].value).toBeCloseTo(360);
    expect(fake.oscillators[0].frequency.events.at(-1)?.value).toBeCloseTo(180);
    expect(fake.oscillators[1].frequency.events[0].value).toBeCloseTo(270);
    expect(fake.filters[0].frequency.events[0].value).toBeCloseTo(1800);
  });

  it('leaves the sound exactly as written when the roll lands in the middle', () => {
    const { fake, ctx, dest } = makeContext();

    playSound(ctx, dest, SOUND, BUFFER, { at: 0, gain: 1, roll: 0.5 });

    expect(fake.oscillators[0].frequency.events[0].value).toBeCloseTo(400);
  });

  it('cuts short without a click when a voice is stopped', () => {
    const { fake, ctx, dest } = makeContext();
    fake.currentTime = 1;

    const voice = playSound(ctx, dest, SOUND, BUFFER, { at: 1, gain: 1, roll: 0.5 });
    voice.stop(1.1);

    // Faded, not severed: the voice gain ramps down and the sources are stopped
    // after the ramp, not on the sample the cut was decided.
    const voiceGain = fake.destination.inputs[0] as FakeGain;
    expect(voiceGain.gain.events.at(-1)?.value).toBeLessThan(0.001);
    for (const source of fake.sources) {
      expect(source.stoppedAt).not.toBeNull();
      expect(source.stoppedAt as number).toBeLessThan(1.2);
    }
  });

  it('lets go of every node it made, cut short or not', () => {
    const { fake, ctx, dest } = makeContext();

    const voice = playSound(ctx, dest, SOUND, BUFFER, { at: 0, gain: 1, roll: 0.5 });
    voice.stop(0.05);
    fake.endAll();

    expect(fake.nodes.every((n) => n.disconnects >= 1)).toBe(true);
  });
});

describe('pitchScale', () => {
  it('is the identity in the middle of the window', () => {
    expect(pitchScale(0.2, 0.5)).toBeCloseTo(1);
  });

  it('spans exactly the fraction it was given, both ways', () => {
    expect(pitchScale(0.2, 0)).toBeCloseTo(0.8);
    expect(pitchScale(0.2, 1)).toBeCloseTo(1.2);
  });

  it('holds a sound still when it asked not to vary', () => {
    // A card can opt out, and a card that opts out must be *identical* every
    // time rather than nearly so — otherwise "no detune" is a lie in the table.
    expect(pitchScale(0, 0)).toBe(1);
    expect(pitchScale(0, 0.9)).toBe(1);
  });
});
