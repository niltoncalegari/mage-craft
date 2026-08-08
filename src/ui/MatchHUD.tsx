import { render, type JSX } from 'preact';
import type { GameRenderer } from '../core/Game';
import { Team, type Structure } from '../game/types';
import type { World } from '../game/World';
import type { MatchState } from '../net/SnapshotSync';
import { teamFill, teamInk } from './teamInk';
import { HAND_SIZE } from '../../sim/Deck';
import { MANA_MAX, MATCH_DURATION, SUDDEN_DEATH_DURATION } from '../../sim/config';
import { spellFor, type CardId, type SpellCard } from '../../sim/spells';
import styles from './MatchHUD.module.css';

/** What the player can be told about a spell at a glance (GDD §9). */
const KIND_LABEL: Readonly<Record<SpellCard['kind'], string>> = {
  buff: 'Bênção',
  curse: 'Maldição',
};

export interface MatchHudDeps {
  /** The latest wire state: mana, clock and hand. */
  getState: () => MatchState;
  /** The card armed and waiting for a click on the arena, if any. */
  getSelectedCard: () => string | null;
  /** Arms a card, or clears the selection with null. */
  onSelectCard: (cardId: string | null) => void;
  isVisible: () => boolean;
  /** Spectators get the clock and the structures, but no hand of their own. */
  isSpectating: () => boolean;
  /** Which half of the arena the local commander's own side stands on. */
  getMySide: () => 'left' | 'right';
}

interface CardRefs {
  root: HTMLButtonElement;
  cost: HTMLElement;
  name: HTMLElement;
  role: HTMLElement;
  key: HTMLElement;
}

interface SideRefs {
  label: HTMLElement;
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
  left: SideRefs;
  right: SideRefs;
  manaFill: HTMLElement;
  manaText: HTMLElement;
  hand: CardRefs[];
  nextName: HTMLElement;
  hint: HTMLElement;
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
      <span class={styles.sideLabel} ref={keep(refs, 'label')} />
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
function MatchHudView({ refs }: { refs: HudRefs }): JSX.Element {
  return (
    <>
      <div class={styles.top}>
        <SideView refs={refs.left} mirrored={false} />
        <div class={styles.clockBox}>
          <span class={styles.clock} ref={keep(refs, 'clock')} />
          <span class={styles.phase} ref={keep(refs, 'phase')} />
        </div>
        <SideView refs={refs.right} mirrored />
      </div>

      <div class={styles.bar} ref={keep(refs, 'bar')}>
        <span class={styles.hint} ref={keep(refs, 'hint')} />
        <div class={styles.barRow}>
          <div class={styles.nextBox}>
            <span class={styles.nextLabel}>Próxima</span>
            <span class={styles.nextName} ref={keep(refs, 'nextName')} />
          </div>
          <div class={styles.hand}>
            {Array.from({ length: HAND_SIZE }, (_, slot) => {
              const cardRefs = {} as CardRefs;
              refs.hand[slot] = cardRefs;
              return (
                <button key={slot} type="button" class={styles.card} ref={keep(cardRefs, 'root')}>
                  <span class={styles.cardCost} ref={keep(cardRefs, 'cost')} />
                  <span class={styles.cardName} ref={keep(cardRefs, 'name')} />
                  <span class={styles.cardRole} ref={keep(cardRefs, 'role')} />
                  <span class={styles.cardKey} ref={keep(cardRefs, 'key')} />
                </button>
              );
            })}
          </div>
          <div class={styles.manaBox}>
            <div class={styles.manaMeter}>
              <div class={styles.manaFill} ref={keep(refs, 'manaFill')} />
            </div>
            <span class={styles.manaText} ref={keep(refs, 'manaText')} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The in-match commander interface for the siege model (GDD §13, step 6): a
 * hand of four cards you spend mana on, the card queued behind them, the match
 * clock, and how both Cores and Towers are holding up.
 *
 * It replaces {@link HUD} for online matches rather than extending it: since the
 * pivot the player has no mage of their own, so lives/health/throw readiness
 * describe an avatar that no longer exists.
 */
export class MatchHUD implements GameRenderer {
  private readonly host: HTMLDivElement;
  /**
   * The nested holders have to exist before the view mounts: a callback ref
   * fires during render and writes straight into them.
   */
  private readonly refs = {
    hand: [] as CardRefs[],
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
    // Only the card buttons are interactive; clicks anywhere else must reach the
    // arena underneath, which is how a card gets placed.
    this.host.style.pointerEvents = 'none';
    container.append(this.host);
    render(<MatchHudView refs={this.refs} />, this.host);

    for (const [slot, card] of this.refs.hand.entries()) {
      card.root.style.pointerEvents = 'auto';
      card.key.textContent = String(slot + 1);
      card.root.addEventListener('click', () => this.toggleSlot(slot));
    }
  }

  sync(alpha: number): void {
    void alpha;
    const visible = this.deps.isVisible();
    this.host.hidden = !visible;
    if (!visible) return;

    const state = this.deps.getState();
    this.updateClock(state);
    this.updateSides();
    this.updateHand(state);
  }

  dispose(): void {
    render(null, this.host);
    this.host.remove();
  }

  /** Arms the card in a hand slot, or disarms it when it is already selected. */
  private toggleSlot(slot: number): void {
    const cardId = this.deps.getState().hand[slot];
    if (!cardId) return;
    this.deps.onSelectCard(this.deps.getSelectedCard() === cardId ? null : cardId);
  }

  private updateClock(state: MatchState): void {
    this.refs.clock.textContent = formatSeconds(remainingSeconds(state));
    this.refs.phase.textContent = state.suddenDeath ? 'Morte súbita' : 'Tempo normal';
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

    refs.label.textContent = team === Team.Player ? 'Você' : 'Adversário';
    refs.label.style.color = teamInk(team);

    const fraction = core ? clamp01(core.health / Math.max(1, core.maxHealth)) : 0;
    refs.coreFill.style.width = `${Math.round(fraction * 100)}%`;
    refs.coreFill.style.backgroundColor = teamFill(team);
    refs.coreText.textContent = core ? this.coreLabel(core) : '—';
    refs.towers.textContent = towers.map((t) => (t.alive ? '◆' : '◇')).join(' ') || '—';
  }

  private coreLabel(core: Structure): string {
    const health = Math.max(0, Math.ceil(core.health));
    if (!core.alive) return 'Núcleo destruído';
    // While its Towers stand the Core cannot be hurt at all, so a health number
    // alone would read as "almost lost" to no purpose.
    return core.invulnerable ? `Núcleo protegido · ${health}` : `Núcleo ${health}`;
  }

  private updateHand(state: MatchState): void {
    const spectating = this.deps.isSpectating();
    this.refs.bar.hidden = spectating;
    if (spectating) return;

    const selected = this.deps.getSelectedCard();
    for (const [slot, refs] of this.refs.hand.entries()) {
      const card = lookupCard(state.hand[slot]);
      refs.root.hidden = !card;
      if (!card) continue;

      const affordable = state.mana >= card.cost;
      refs.cost.textContent = String(card.cost);
      refs.name.textContent = card.name;
      refs.role.textContent = KIND_LABEL[card.kind];
      refs.root.classList.toggle(styles.cardSelected, selected === card.id);
      refs.root.classList.toggle(styles.cardBroke, !affordable);
      refs.root.disabled = !affordable;
    }

    const next = lookupCard(state.next);
    this.refs.nextName.textContent = next ? `${next.name} · ${next.cost}` : '—';

    const armed = lookupCard(selected);
    this.refs.hint.textContent = armed
      ? `Clique numa área do campo para conjurar ${armed.name}`
      : 'Escolha uma carta (1–4) e clique no campo';

    const fraction = clamp01(state.mana / MANA_MAX);
    this.refs.manaFill.style.width = `${Math.round(fraction * 100)}%`;
    this.refs.manaText.textContent = `${Math.floor(state.mana)}/${MANA_MAX}`;
  }
}
