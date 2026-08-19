import { render, type JSX } from 'preact';
import type { GameRenderer } from '../core/Game';
import { Team } from '../game/types';
import { teamInk } from './teamInk';
import type { SquadMemberView } from '../net/SnapshotSync';
import { SQUAD_SIZE } from '../../sim/config';
import { isRosterId, rosterFor } from '../../sim/cards';
import { abilityPolicyFor } from '../../sim/abilityPolicy';
import styles from './SquadPanel.module.css';

/** What a mage's role means to someone reading the panel (GDD §8). */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  tank: 'Tanque',
  damage: 'Dano',
  support: 'Suporte',
};

/** Used when the match never named a commander — a bare local session. */
const SIDE_LABEL = ['Your squad', 'Opponent'] as const;

export interface SquadPanelDeps {
  /** Every mage in the match, in a match-stable order. */
  getSquad: () => readonly SquadMemberView[];
  /** The wire id of the mage being watched, or null. */
  getHighlighted: () => string | null;
  /** Which half of the arena the local commander's squad stands on. */
  getMySide: () => 'left' | 'right';
  /** Picks a mage to watch; passing the one already picked clears it. */
  onSelect: (wireId: string) => void;
  isVisible: () => boolean;
  /** The nick commanding a side, or null when the match never named them. */
  getSideName: (team: Team) => string | null;
}

interface ChipRefs {
  shield: HTMLElement;
  haste: HTMLElement;
  slow: HTMLElement;
  immune: HTMLElement;
}

/** The widest kit the catalog holds; the panel's DOM is sized for it once. */
const MAX_KIT = 3;

interface ChargeRefs {
  track: HTMLElement;
  fill: HTMLElement;
}

interface RowRefs {
  root: HTMLButtonElement;
  name: HTMLElement;
  role: HTMLElement;
  kd: HTMLElement;
  healthFill: HTMLElement;
  healthText: HTMLElement;
  respawn: HTMLElement;
  chips: ChipRefs;
  charges: ChargeRefs[];
}

interface SideRefs {
  root: HTMLElement;
  toggle: HTMLButtonElement;
  label: HTMLElement;
  kills: HTMLElement;
  chevron: HTMLElement;
  rows: RowRefs[];
}

interface PanelRefs {
  sides: SideRefs[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Callback ref that stores the mounted element into `target[key]` (same as {@link MatchHUD}). */
function keep<T extends object>(target: T, key: keyof T): (el: HTMLElement | null) => void {
  return (el) => {
    if (el) Object.assign(target, { [key]: el });
  };
}

/** The roster entry behind a wire id, if it names one at all. */
function lookupRoster(id: string | null): { name: string } | undefined {
  return id && isRosterId(id) ? rosterFor(id) : undefined;
}

/** Green through red, matching StructureRenderer's health bars. */
function healthColor(fraction: number): string {
  return `hsl(${Math.round(clamp01(fraction) * 120)}, 78%, 46%)`;
}

function RowView({ refs }: { refs: RowRefs }): JSX.Element {
  const chips = {} as ChipRefs;
  refs.chips = chips;
  const charges: ChargeRefs[] = [];
  refs.charges = charges;

  return (
    <button type="button" class={styles.row} ref={keep(refs, 'root')}>
      <span class={styles.rowTop}>
        <span class={styles.name} ref={keep(refs, 'name')} />
        <span class={styles.role} ref={keep(refs, 'role')} />
        <span class={styles.kd} ref={keep(refs, 'kd')} />
      </span>
      <span class={styles.healthMeter}>
        <span class={styles.healthFill} ref={keep(refs, 'healthFill')} />
      </span>
      <span class={styles.charges}>
        {Array.from({ length: MAX_KIT }, (_, i) => {
          const chargeRefs = {} as ChargeRefs;
          charges[i] = chargeRefs;
          return (
            <span class={styles.charge} key={i} ref={keep(chargeRefs, 'track')}>
              <span class={styles.chargeFill} ref={keep(chargeRefs, 'fill')} />
            </span>
          );
        })}
      </span>
      <span class={styles.rowBottom}>
        <span class={styles.healthText} ref={keep(refs, 'healthText')} />
        <span class={styles.respawn} ref={keep(refs, 'respawn')} hidden />
        <span class={`${styles.chip} ${styles.chipShield}`} ref={keep(chips, 'shield')} hidden>
          Shield
        </span>
        <span class={`${styles.chip} ${styles.chipHaste}`} ref={keep(chips, 'haste')} hidden>
          Haste
        </span>
        <span class={`${styles.chip} ${styles.chipSlow}`} ref={keep(chips, 'slow')} hidden>
          Slowed
        </span>
        <span class={`${styles.chip} ${styles.chipImmune}`} ref={keep(chips, 'immune')} hidden>
          Immune
        </span>
      </span>
    </button>
  );
}

function SideView({ refs }: { refs: SideRefs }): JSX.Element {
  return (
    <div class={styles.panel} ref={keep(refs, 'root')}>
      <div class={styles.header}>
        <button type="button" class={styles.toggle} ref={keep(refs, 'toggle')}>
          <span class={styles.headerLabel} ref={keep(refs, 'label')} />
          <span class={styles.headerKills} ref={keep(refs, 'kills')} />
          <span class={styles.chevron} ref={keep(refs, 'chevron')} />
        </button>
      </div>
      <div class={styles.body}>
        {Array.from({ length: SQUAD_SIZE }, (_, i) => {
          const rowRefs = {} as RowRefs;
          refs.rows[i] = rowRefs;
          return <RowView key={i} refs={rowRefs} />;
        })}
      </div>
    </div>
  );
}

function SquadPanelView({ refs }: { refs: PanelRefs }): JSX.Element {
  return (
    <>
      <SideView refs={refs.sides[0]} />
      <SideView refs={refs.sides[1]} />
    </>
  );
}

/**
 * The two squad dashboards, one docked on each half of the arena.
 *
 * Since the pivot nobody steers a mage, so following the fight means following
 * eight units you do not control — this is where their health, buffs, curses and
 * kill tally are legible, and where you pick one to mark in the arena.
 *
 * Mounted once and then written through refs, exactly like {@link MatchHUD}: at
 * 60fps a Preact re-render per frame would be the most expensive thing in the
 * match. Collapsing is a CSS class rather than a re-render for the same reason —
 * the DOM never changes shape after the constructor, so the ~90 captured refs
 * stay valid for the life of the match.
 *
 * A team's kill total is the *other* team's deaths, not the sum of its mages'
 * kills: Tower bolts, Praga zones and friendly fire all take a mage off the
 * field with nobody to credit (see `World.kill`), and those still cost the side
 * a body.
 */
export class SquadPanel implements GameRenderer {
  private readonly host: HTMLDivElement;
  private readonly refs: PanelRefs = {
    sides: [{ rows: [] } as unknown as SideRefs, { rows: [] } as unknown as SideRefs],
  };
  /** Per side, folded or not. Read every frame; written only on a click. */
  private readonly collapsed = [false, false];

  constructor(
    container: HTMLElement,
    private readonly deps: SquadPanelDeps,
  ) {
    this.host = document.createElement('div');
    this.host.hidden = true;
    // Only the buttons are interactive; everything else must let a cast through
    // to the arena underneath.
    this.host.style.pointerEvents = 'none';
    container.append(this.host);
    render(<SquadPanelView refs={this.refs} />, this.host);

    for (const [side, refs] of this.refs.sides.entries()) {
      refs.toggle.addEventListener('click', () => this.toggleSide(side));
      for (const row of refs.rows) {
        row.root.addEventListener('click', () => {
          const wireId = row.root.dataset.wireId;
          if (wireId) this.deps.onSelect(wireId);
        });
      }
    }
  }

  sync(alpha: number): void {
    void alpha;
    const visible = this.deps.isVisible();
    this.host.hidden = !visible;
    if (!visible) return;

    const squad = this.deps.getSquad();
    const highlighted = this.deps.getHighlighted();

    const mine = squad.filter((m) => m.team === Team.Player);
    const theirs = squad.filter((m) => m.team === Team.Enemy);

    // Your panel is docked on the half of the arena your squad actually stands
    // on. Pinning it to the left would have a right-hand commander reading their
    // own colours off the far edge of the board.
    const mineOnLeft = this.deps.getMySide() === 'left';
    this.updateSide(0, mineOnLeft, mine, theirs, highlighted);
    this.updateSide(1, !mineOnLeft, theirs, mine, highlighted);
  }

  dispose(): void {
    render(null, this.host);
    this.host.remove();
  }

  private toggleSide(side: number): void {
    this.collapsed[side] = !this.collapsed[side];
    const refs = this.refs.sides[side];
    refs.root.classList.toggle(styles.collapsed, this.collapsed[side]);
    refs.chevron.textContent = this.collapsed[side] ? '▸' : '▾';
  }

  private updateSide(
    side: number,
    onLeft: boolean,
    rows: readonly SquadMemberView[],
    opponents: readonly SquadMemberView[],
    highlighted: string | null,
  ): void {
    const refs = this.refs.sides[side];
    const team = side === 0 ? Team.Player : Team.Enemy;

    refs.root.classList.toggle(styles.left, onLeft);
    refs.root.classList.toggle(styles.right, !onLeft);

    refs.label.textContent = this.deps.getSideName(team) ?? SIDE_LABEL[side];
    refs.label.style.color = teamInk(team);
    // Kills this side has scored = bodies the other side has lost.
    const kills = opponents.reduce((n, m) => n + m.deaths, 0);
    refs.kills.textContent = `${kills} ${kills === 1 ? 'abate' : 'abates'}`;
    if (!refs.chevron.textContent) refs.chevron.textContent = '▾';

    // Folded away: the header above still counts, which is why it is outside.
    if (this.collapsed[side]) return;

    for (const [i, row] of refs.rows.entries()) {
      const member = rows[i];
      row.root.hidden = !member;
      if (!member) continue;
      this.updateRow(row, member, highlighted);
    }
  }

  private updateRow(refs: RowRefs, member: SquadMemberView, highlighted: string | null): void {
    refs.root.dataset.wireId = member.wireId;
    refs.root.classList.toggle(styles.rowActive, member.wireId === highlighted);
    refs.root.classList.toggle(styles.rowDead, !member.alive);

    refs.name.textContent = lookupRoster(member.rosterId)?.name ?? 'Mago';
    refs.role.textContent = ROLE_LABEL[member.role] ?? '';
    refs.kd.textContent = `${member.kills}/${member.deaths}`;

    const fraction = clamp01(member.health / Math.max(1, member.maxHealth));
    refs.healthFill.style.width = `${Math.round(fraction * 100)}%`;
    refs.healthFill.style.backgroundColor = healthColor(fraction);

    refs.healthText.hidden = !member.alive;
    refs.healthText.textContent = `${Math.max(0, Math.ceil(member.health))}/${member.maxHealth}`;

    refs.respawn.hidden = member.alive;
    // Ceil so a 20Hz feed counts 6 → 5 → 4 instead of flickering on fractions.
    refs.respawn.textContent = `Volta em ${Math.max(1, Math.ceil(member.respawnRemaining))}s`;

    this.updateCharges(refs, member);

    refs.chips.shield.hidden = !member.shielded;
    refs.chips.haste.hidden = !member.hasted;
    refs.chips.slow.hidden = !member.slowed;
    // Spawn protection only reads as information while the mage is back up.
    refs.chips.immune.hidden = !member.immune || !member.alive;
  }

  /**
   * How close each skill in this mage's kit is to being spendable.
   *
   * The wire sends *seconds remaining*, and omits the array entirely while
   * nothing is recharging — so an empty `cooldowns` means a full kit, not an
   * unknown one. The denominator is the skill's own cooldown out of the
   * catalog, which is why the tracks fill at visibly different speeds: that
   * difference is the kit, and it is the thing the player is being shown.
   */
  private updateCharges(refs: RowRefs, member: SquadMemberView): void {
    const abilities = member.rosterId && isRosterId(member.rosterId)
      ? (rosterFor(member.rosterId)?.abilities ?? [])
      : [];

    for (const [i, charge] of refs.charges.entries()) {
      const spellId = abilities[i];
      charge.track.hidden = spellId === undefined || !member.alive;
      if (spellId === undefined) continue;

      const total = abilityPolicyFor(spellId)?.cooldown ?? 0;
      const remaining = member.cooldowns[i] ?? 0;
      const ready = total <= 0 || remaining <= 0;
      const fraction = ready ? 1 : clamp01(1 - remaining / total);
      charge.fill.style.width = `${Math.round(fraction * 100)}%`;
      charge.track.classList.toggle(styles.chargeReady, ready);
    }
  }
}
