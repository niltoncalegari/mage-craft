import type { GameRenderer } from '../core/Game';
import type { EventBus } from '../core/EventBus';
import type { CameraController } from '../engine/CameraController';
import { prefersReducedMotion } from '../engine/reducedMotion';
import { spellVfxFor } from './spellVfx';

/**
 * The feedback that is not made of particles: camera shake, and the one
 * full-screen flash this game allows itself.
 *
 * Kept apart from {@link ParticleRenderer} because it writes to two things that
 * class does not own — the camera transform and the DOM — and because the
 * question it answers is a different one. Particles say *what* happened and
 * where; this says *how much it mattered*, which in a match the player only
 * watches is the difference between a card being spent and the match being
 * decided.
 *
 * The budget is deliberately tiny. Exactly one card shakes the camera, and
 * exactly one event flashes the screen. Everything else on the field is drawn
 * without moving the frame the player is reading it in.
 */

/** A Core falling ends the match; a Tower is a swing inside it. */
const CORE_TRAUMA = 0.6;
const TOWER_TRAUMA = 0.3;
/** Peak opacity of the white overlay, and how long it takes to clear. */
const FLASH_PEAK = 0.55;
const FLASH_FADE = 0.16;
/** Matches the renderer's fixed step; see `ShakeRig.update`. */
const RENDER_DT = 1 / 60;

export class ImpactFeedback implements GameRenderer {
  private readonly overlay: HTMLDivElement;
  private flash = 0;
  private readonly offSpellCast: () => void;
  private readonly offStructureDestroyed: () => void;

  constructor(
    container: HTMLElement,
    events: EventBus,
    private readonly camera: CameraController,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;display:none';
    container.append(this.overlay);

    this.offSpellCast = events.on('SpellCast', (event) => {
      // Straight off the same descriptor row the particle renderer draws from,
      // so a card's weight is one number in one table rather than two that can
      // disagree about which cards are the heavy ones.
      this.camera.addTrauma(spellVfxFor(event.spellId).trauma ?? 0);
    });

    this.offStructureDestroyed = events.on('StructureDestroyed', (event) => {
      this.camera.addTrauma(event.kind === 'core' ? CORE_TRAUMA : TOWER_TRAUMA);
      // The Core only. A tower falls several times a match and a white screen
      // for each would be an alarm nobody can turn off; a Core falling *is* the
      // end of the match, and there is nothing left on the field to obscure.
      if (event.kind === 'core') this.flashScreen();
    });
  }

  /**
   * Fades the overlay. Done here on the renderer's own clock rather than with
   * a CSS transition so that it stops the moment the match view does — a flash
   * still running while the screen is being torn down is a white frame on the
   * way back to the menu.
   */
  sync(alpha: number): void {
    void alpha;
    if (this.flash <= 0) return;

    this.flash = Math.max(0, this.flash - RENDER_DT / FLASH_FADE);
    this.overlay.style.opacity = String(this.flash * FLASH_PEAK);
    if (this.flash <= 0) this.overlay.style.display = 'none';
  }

  private flashScreen(): void {
    // A single hard flash is the one motion effect that can be genuinely
    // unpleasant rather than merely distracting, so the preference wins here
    // too — the Core's rubble and the HUD already say the match is over.
    if (prefersReducedMotion()) return;
    this.flash = 1;
    this.overlay.style.display = 'block';
    this.overlay.style.opacity = String(FLASH_PEAK);
  }

  dispose(): void {
    this.offSpellCast();
    this.offStructureDestroyed();
    this.overlay.remove();
  }
}
