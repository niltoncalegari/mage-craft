import { render, type JSX } from 'preact';
import type { GameRenderer } from '../core/Game';
import { Team, type Structure } from '../game/types';
import type { World } from '../game/World';
import type { MatchState } from '../net/SnapshotSync';
import { teamFill, teamInk } from './teamInk';
import { MATCH_DURATION, SUDDEN_DEATH_DURATION } from '../../sim/config';
import { spellFor, type CardId, type SpellCard } from '../../sim/spells';
import { selectorLabel } from './strategyText';
import { insetFor, mergeInsets, NO_INSETS, type ViewInsets } from './hudInsets';
import styles from './MatchHUD.module.css';

export interface MatchHudDeps {
  /** The latest wire state: the clock and the ability that last fired. */
  getState: () => MatchState;
  isVisible: () => boolean;
  /** Spectators get the clock and the structures, but no squad of their own. */
  isSpectating: () => boolean;
  /** Which half of the arena the local commander's own side stands on. */
  getMySide: () => 'left' | 'right';
  /**
   * The nick commanding a side, or null when nobody named it. Asked every frame
   * rather than passed once: a room's roster keeps arriving during the match
   * (a claimed bot seat changes hands mid-round), so a name captured at
   * construction would go stale.
   */
  getSideName: (team: Team) => string | null;
  /**
   * Whether sound is off, and the way to change it. Asked every frame rather
   * than passed once because the keyboard can toggle it too — the button is a
   * readout of the setting, not the owner of it.
   */
  isMuted: () => boolean;
  onToggleMute: () => void;
}

interface SideRefs {
  /** The commander's nick, or the generic word when the match never named them. */
  label: HTMLElement;
  /** "You"/"Enemy" tag beside the nick — with two nicks up there, whose is whose. */
  role: HTMLElement;
  coreFill: HTMLElement;
  coreText: HTMLElement;
  towers: HTMLElement;
}

/**
 * Named by screen position, not by whose side it is: which team a box shows
 * depends on which half of the arena that team stands on (see `updateSides`).
 */
interface HudRefs {
  clock: HTMLElement;
  phase: HTMLElement;
  sound: HTMLButtonElement;
  left: SideRefs;
  right: SideRefs;
  trace: HTMLElement;
  top: HTMLElement;
  bar: HTMLElement;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Callback ref that stores the mounted element into `target[key]` (returns void). */
function keep<T extends object>(target: T, key: keyof T): (el: HTMLElement | null) => void {
  return (el) => {
    if (el) Object.assign(target, { [key]: el });
  };
}

/** The catalog entry for a wire card id, if it names one at all. */
function lookupCard(id: string | null | undefined): SpellCard | undefined {
  return id ? spellFor(id as CardId) : undefined;
}

function formatSeconds(total: number): string {
  const clamped = Math.max(0, Math.ceil(total));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Seconds left on the match clock. Normal time counts down to zero and then
 * sudden death starts its own count (GDD §4).
 */
function remainingSeconds(state: MatchState): number {
  const limit = state.suddenDeath ? MATCH_DURATION + SUDDEN_DEATH_DURATION : MATCH_DURATION;
  return limit - state.elapsed;
}

function SideView({ refs, mirrored }: { refs: SideRefs; mirrored: boolean }): JSX.Element {
  return (
    <div class={`${styles.side} ${mirrored ? styles.sideRight : ''}`}>
      <div class={styles.sideHead}>
        <span class={styles.sideLabel} ref={keep(refs, 'label')} />
        <span class={styles.sideRole} ref={keep(refs, 'role')} />
      </div>
      <div class={styles.coreMeter}>
        <div class={styles.coreFill} ref={keep(refs, 'coreFill')} />
        <span class={styles.coreText} ref={keep(refs, 'coreText')} />
      </div>
      <div class={styles.towers} ref={keep(refs, 'towers')} />
    </div>
  );
}

/**
 * Mounted once; every leaf the per-frame update writes to comes back through
 * `refs`, so a 60fps HUD never re-renders Preact (same approach as {@link HUD}).
 */
function MatchHudView({
  refs,
  onToggleMute,
}: {
  refs: HudRefs;
  onToggleMute: () => void;
}): JSX.Element {
  return (
    <>
      <div class={styles.top} data-testid="match-top" ref={keep(refs, 'top')}>
        <SideView refs={refs.left} mirrored={false} />
        <div class={styles.clockBox}>
          <span class={styles.clock} ref={keep(refs, 'clock')} />
          <span class={styles.phase} ref={keep(refs, 'phase')} />
          {/*
            The one pressable thing on an otherwise read-only HUD, and the only
            one that is not a game action: an idle match is *listened to* for
            minutes at a stretch, so the way to silence it cannot live behind a
            pause menu in a match that does not actually pause.
          */}
          <button
            class={styles.sound}
            type="button"
            onClick={onToggleMute}
            ref={keep(refs, 'sound')}
          />
        </div>
        <SideView refs={refs.right} mirrored />
      </div>

      {/*
        The bar is down to one line. The hand, the Next slot and the mana meter
        all described a resource the player no longer has (plano v1.3 §3.3) —
        what is left is the one thing a v1.3 match still owes them, which is an
        account of what their own squad just did. The full kit readout, with a
        charge per skill, is the squad panel's job in Fase 4.
      */}
      <div class={styles.bar} data-testid="match-bar" ref={keep(refs, 'bar')}>
        <span class={styles.trace} ref={keep(refs, 'trace')} />
      </div>
    </>
  );
}

/**
 * The in-match readout for the siege model (GDD §13): the match clock, how both
 * Cores and Towers are holding up — and which of your own
 * rules last spent it.
 *
 * Nothing here is pressable since the idle pivot. The hand stays on screen
 * anyway and stays *honest* about affordability, because it answers the most
 * common question an idle player has: "why has my Meteoro rule not fired?" —
 * and the answer is usually that the card is two draws away, or that the bank
 * is short. Hiding the hand would leave that question unanswerable, and the
 * trace panel below it is the other half of the same account.
 */
export class MatchHUD implements GameRenderer {
  private readonly host: HTMLDivElement;
  /**
   * The rule id the trace panel is currently showing.
   *
   * `sync` runs every frame and a rule changes every second or so, so writing
   * `textContent` unconditionally would be ~60 pointless DOM writes a second
   * for a string that is almost always the same one.
   */
  private tracedCastId: string | null = null;
  /** Same cache, same reason: the label changes on a click, not on a frame. */
  private shownMuted: boolean | null = null;
  /**
   * The nested holders have to exist before the view mounts: a callback ref
   * fires during render and writes straight into them.
   */
  private readonly refs = {
    left: {} as SideRefs,
    right: {} as SideRefs,
  } as HudRefs;

  constructor(
    container: HTMLElement,
    private readonly world: World,
    private readonly deps: MatchHudDeps,
  ) {
    this.host = document.createElement('div');
    this.host.hidden = true;
    // Set on the host and lifted by exactly one child. Everything the HUD says
    // about the match is a readout since the idle pivot, so every click on it
    // belongs to the arena underneath — which is still how the camera gets
    // dragged. The sound toggle opts back in because it is chrome rather than a
    // move in the game: silencing the match is not something the program does.
    this.host.style.pointerEvents = 'none';
    container.append(this.host);
    render(
      <MatchHudView refs={this.refs} onToggleMute={() => this.deps.onToggleMute()} />,
      this.host,
    );
  }

  sync(alpha: number): void {
    void alpha;
    const visible = this.deps.isVisible();
    this.host.hidden = !visible;
    if (!visible) return;

    const state = this.deps.getState();
    this.updateSound();
    this.updateClock(state);
    this.updateSides();
    this.updateTrace(state);
  }

  dispose(): void {
    render(null, this.host);
    this.host.remove();
  }

  /**
   * The bands this HUD has taken out of `container`, for the camera to frame
   * the arena around (see src/ui/hudInsets.ts). The trace line reports itself
   * too: it is a thin pill, but it is a thin pill sitting on the board.
   */
  viewInsets(container: HTMLElement): ViewInsets {
    if (this.host.hidden) return NO_INSETS;
    const box = container.getBoundingClientRect();
    return mergeInsets(
      insetFor(this.refs.top.getBoundingClientRect(), box),
      insetFor(this.refs.bar.getBoundingClientRect(), box),
    );
  }

  /**
   * Keeps the toggle honest about a setting it does not own — the same
   * preference is reachable from the keyboard and from the practice menu, and
   * a button that only knows about its own clicks would go stale on both.
   */
  private updateSound(): void {
    const muted = this.deps.isMuted();
    if (muted === this.shownMuted) return;
    this.shownMuted = muted;

    this.refs.sound.textContent = muted ? 'Sound off' : 'Sound on';
    this.refs.sound.setAttribute('aria-pressed', String(muted));
    this.refs.sound.setAttribute('aria-label', muted ? 'Unmute the match' : 'Mute the match');
    this.refs.sound.classList.toggle(styles.soundOff, muted);
  }

  private updateClock(state: MatchState): void {
    this.refs.clock.textContent = formatSeconds(remainingSeconds(state));
    this.refs.phase.textContent = state.suddenDeath ? 'Sudden death' : 'Regulation';
    this.refs.phase.classList.toggle(styles.phaseUrgent, state.suddenDeath);
  }

  /**
   * Each box shows the team standing on that half of the board. Teams are
   * mirrored by POV — yours is always `Team.Player` — but the arena is not, so a
   * commander seated on the right would otherwise read their own Core off the
   * box furthest from it.
   */
  private updateSides(): void {
    const mineOnLeft = this.deps.getMySide() === 'left';
    this.updateSide(this.refs.left, mineOnLeft ? Team.Player : Team.Enemy);
    this.updateSide(this.refs.right, mineOnLeft ? Team.Enemy : Team.Player);
  }

  private updateSide(refs: SideRefs, team: Team): void {
    const structures = this.world.structures.filter((s) => s.team === team);
    const core = structures.find((s) => s.kind === 'core');
    const towers = structures.filter((s) => s.kind === 'tower');

    // The nick is the headline; the generic word only stands in when the match
    // never carried one (a bare local session, or a room state that hasn't
    // landed yet — the next frame replaces it as soon as one does).
    const mine = team === Team.Player;
    refs.label.textContent = this.deps.getSideName(team) ?? (mine ? 'You' : 'Opponent');
    refs.label.style.color = teamInk(team);
    refs.role.textContent = mine ? 'You' : 'Enemy';

    const fraction = core ? clamp01(core.health / Math.max(1, core.maxHealth)) : 0;
    refs.coreFill.style.width = `${Math.round(fraction * 100)}%`;
    refs.coreFill.style.backgroundColor = teamFill(team);
    refs.coreText.textContent = core ? this.coreLabel(core) : '—';
    refs.towers.textContent = towers.map((t) => (t.alive ? '◆' : '◇')).join(' ') || '—';
  }

  private coreLabel(core: Structure): string {
    const health = Math.max(0, Math.ceil(core.health));
    if (!core.alive) return 'Core destroyed';
    // While its Towers stand the Core cannot be hurt at all, so a health number
    // alone would read as "almost lost" to no purpose.
    return core.invulnerable ? `Core shielded · ${health}` : `Core ${health}`;
  }

  /**
   * Names the mage that last spent something out of its own kit.
   *
   * This is the whole of an idle match's feedback loop. The player picked four
   * bodies and then stopped touching the game, so the one thing the match owes
   * them is an account of which of their own mages is doing the work — without
   * it, a won match and a lost one look equally like a screensaver.
   */
  private updateTrace(state: MatchState): void {
    this.refs.bar.hidden = this.deps.isSpectating();
    if (this.refs.bar.hidden) return;

    const fired = state.firedAbility;
    // Keyed on the whole cast rather than on the mage: the same body spending a
    // second skill is news, and keying on its id alone would swallow it.
    const id = fired ? `${fired.mageId}:${fired.spellId}` : null;
    if (id === this.tracedCastId) return;
    this.tracedCastId = id;

    if (!fired) {
      this.refs.trace.textContent = 'Nenhuma habilidade disparou ainda';
      return;
    }

    // Falls back to the wire id for a spell this build does not know, rather
    // than blanking the line — a server one version ahead still gets to say
    // what fired.
    // Named by the spell rather than by the body, for now: putting a mage's
    // name here needs the squad roster plumbed into the HUD, which is Fase 4's
    // job. What must not happen in the meantime is the line going mute.
    const spell = lookupCard(fired.spellId)?.name ?? fired.spellId;
    this.refs.trace.textContent = `${spell} → ${selectorLabel(fired.at)}`;
  }
}
