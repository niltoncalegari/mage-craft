import type { EventBus } from '../core/EventBus';
import { Team } from '../game/types';
import { ENEMY_CAST_GAIN, spellSfxFor } from './spellSfx';
import { playSound, releaseOnEnd, VoiceBudget } from './synth';

type Unsubscribe = () => void;
type AudioContextConstructor = new () => AudioContext;

interface WebAudioWindow extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

interface AmbientNodes {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * How many cast sounds may be ringing at once. Three sides of the arena's worth
 * of overlap: the two commanders can each cast every 0.75s and no card rings
 * for longer than that, so anything past this is a pile-up rather than a match.
 */
const MAX_SPELL_VOICES = 8;

/**
 * Synthesizes all game audio with Web Audio: short procedural SFX plus a quiet
 * ambient wind bed. It degrades to no-ops when Web Audio is unavailable.
 *
 * The hand-written sounds below predate the idle pivot and answer the player's
 * own actions. Spells are the opposite case and arrived much later: nobody
 * clicked, so a cast is news rather than confirmation, and its sound is a row
 * in {@link SPELL_SFX} played through {@link playSound} rather than a method
 * here. This class keeps what only it can own — the context, the master gain
 * mute writes to, the noise buffer, and the ceiling on how many voices a
 * three-minute match may leave ringing.
 */
export class AudioManager {
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly spellVoices = new VoiceBudget(MAX_SPELL_VOICES);
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: AmbientNodes | null = null;
  private muted = false;
  private ambientDucked = false;
  private disposed = false;

  constructor(events: EventBus) {
    this.unsubscribes.push(
      events.on('SnowballThrown', () => this.playWhoosh()),
      events.on('SnowballImpact', ({ hitPlayerId }) => this.playSnowPuff(hitPlayerId !== null)),
      events.on('PlayerHit', ({ damage }) => this.playHitSplat(damage)),
      events.on('SpellCast', ({ spellId, friendly }) => this.playSpell(spellId, friendly)),
      events.on('PlayerDefeated', () => this.playDefeated()),
      events.on('RoundEnded', ({ winner }) => this.playRoundEnded(winner)),
      events.on('RoundStarted', () => this.startAmbient()),
      events.on('GamePaused', ({ paused }) => this.setAmbientDucked(paused)),
    );
  }

  /** Resume/unlock the AudioContext. MUST be called from a user gesture. */
  resume(): void {
    const context = this.ensureContext();
    if (!context || context.state === 'closed') return;
    void context.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const context = this.context;
    const masterGain = this.masterGain;
    if (!context || !masterGain) return;
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.75, context.currentTime, 0.01);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    // Before the context goes: a cast half a second from its own end is still
    // scheduled, and closing out from under it leaves the tail hanging on the
    // way back to the menu.
    this.spellVoices.stopAll(this.context?.currentTime ?? 0);
    this.stopAmbient();

    const context = this.context;
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  /**
   * A card landing, from {@link SPELL_SFX}.
   *
   * The pitch is rolled per firing because a deck is eight cards and a match is
   * a few hundred casts: without it, the fourth Praga of the minute is audibly
   * the same file being retriggered, which is what makes synthesised audio
   * sound cheap. The gain says whose cast it was — the same distinction the
   * white core flash draws on screen, drawn again for a player whose eyes are
   * on the other half of the field.
   */
  private playSpell(spellId: string, friendly: boolean): void {
    const context = this.getRunningContext();
    const buffer = this.noiseBuffer;
    if (!context || !buffer) return;

    const now = context.currentTime;
    const voice = playSound(context, this.requireMasterGain(), spellSfxFor(spellId), buffer, {
      at: now,
      gain: friendly ? 1 : ENEMY_CAST_GAIN,
      roll: Math.random(),
    });
    this.spellVoices.admit(voice, now);
  }

  private playWhoosh(): void {
    const context = this.getRunningContext();
    if (!context) return;

    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;
    const duration = 0.22;

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(980, now + 0.08);
    filter.frequency.exponentialRampToValueAtTime(520, now + duration);
    filter.Q.setValueAtTime(0.75, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(gain).connect(this.requireMasterGain());
    source.start(now, this.randomNoiseOffset(), duration);
    releaseOnEnd(source, [filter, gain], now + duration + 0.03);
  }

  private playSnowPuff(hitPlayer: boolean): void {
    const context = this.getRunningContext();
    if (!context) return;

    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;
    const duration = hitPlayer ? 0.18 : 0.13;
    const peak = hitPlayer ? 0.12 : 0.07;

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(hitPlayer ? 820 : 650, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + duration);
    filter.Q.setValueAtTime(0.5, now);

    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(gain).connect(this.requireMasterGain());
    source.start(now, this.randomNoiseOffset(), duration);
    releaseOnEnd(source, [filter, gain], now + duration + 0.03);
  }

  private playHitSplat(damage: number): void {
    const context = this.getRunningContext();
    if (!context) return;

    const now = context.currentTime;
    const impactScale = Math.min(1.35, Math.max(0.85, damage / 25));
    this.playSnowPuff(true);

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const duration = 0.16;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(115, now);
    oscillator.frequency.exponentialRampToValueAtTime(48, now + duration);
    gain.gain.setValueAtTime(0.11 * impactScale, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain).connect(this.requireMasterGain());
    oscillator.start(now);
    oscillator.stop(now + duration);
    releaseOnEnd(oscillator, [gain], now + duration + 0.03);
  }

  private playDefeated(): void {
    const context = this.getRunningContext();
    if (!context) return;

    const now = context.currentTime;
    this.playTone(300, 0.11, now, 'triangle', 0.08);
    this.playTone(220, 0.13, now + 0.09, 'triangle', 0.075);
    this.playTone(155, 0.18, now + 0.2, 'sine', 0.07);
  }

  private playRoundEnded(winner: Team): void {
    const context = this.getRunningContext();
    if (!context) return;

    const now = context.currentTime;
    if (winner === Team.Player) {
      this.playTone(392, 0.12, now, 'triangle', 0.075);
      this.playTone(494, 0.12, now + 0.11, 'triangle', 0.075);
      this.playTone(587, 0.13, now + 0.22, 'triangle', 0.08);
      this.playTone(784, 0.22, now + 0.34, 'sine', 0.07);
      return;
    }

    this.playTone(247, 0.17, now, 'triangle', 0.065);
    this.playTone(196, 0.2, now + 0.16, 'sine', 0.06);
    this.playTone(147, 0.24, now + 0.34, 'sine', 0.055);
  }

  private playTone(
    frequency: number,
    duration: number,
    startTime: number,
    type: OscillatorType,
    peakGain: number,
  ): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain).connect(this.requireMasterGain());
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
    releaseOnEnd(oscillator, [gain], startTime + duration + 0.04);
  }

  private startAmbient(): void {
    const context = this.ensureContext();
    if (!context || this.ambient) {
      this.updateAmbientGain();
      return;
    }

    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.value = 360;
    filter.Q.value = 0.45;
    gain.gain.value = 0;

    source.connect(filter).connect(gain).connect(this.requireMasterGain());
    source.start();
    this.ambient = { source, filter, gain };
    this.updateAmbientGain();
  }

  private setAmbientDucked(ducked: boolean): void {
    this.ambientDucked = ducked;
    this.updateAmbientGain();
  }

  private updateAmbientGain(): void {
    const context = this.context;
    const ambient = this.ambient;
    if (!context || !ambient) return;
    const volume = this.ambientDucked ? 0.012 : 0.032;
    ambient.gain.gain.setTargetAtTime(volume, context.currentTime, 0.25);
  }

  private stopAmbient(): void {
    const ambient = this.ambient;
    this.ambient = null;
    if (!ambient) return;
    try {
      ambient.source.stop();
    } catch {
      // Already stopped or never fully started.
    }
    ambient.source.disconnect();
    ambient.filter.disconnect();
    ambient.gain.disconnect();
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.context) return this.context;
    if (typeof window === 'undefined') return null;

    const audioWindow = window as WebAudioWindow;
    const AudioContextCtor = window.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) return null;

    try {
      const context = new AudioContextCtor();
      const masterGain = context.createGain();
      masterGain.gain.value = this.muted ? 0 : 0.75;
      masterGain.connect(context.destination);
      this.context = context;
      this.masterGain = masterGain;
      this.noiseBuffer = this.createNoiseBuffer(context);
      return context;
    } catch {
      return null;
    }
  }

  private getRunningContext(): AudioContext | null {
    const context = this.ensureContext();
    if (!context || context.state !== 'running') return null;
    return context;
  }

  private requireMasterGain(): GainNode {
    if (!this.masterGain) {
      throw new Error('Audio master gain is unavailable.');
    }
    return this.masterGain;
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createNoiseSource(context: AudioContext): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer ?? this.createNoiseBuffer(context);
    return source;
  }

  private randomNoiseOffset(): number {
    const buffer = this.noiseBuffer;
    if (!buffer) return 0;
    return Math.random() * Math.max(0, buffer.duration - 0.25);
  }
}
