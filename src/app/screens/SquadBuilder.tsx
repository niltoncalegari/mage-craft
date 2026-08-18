import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ALL_STANCES, type Stance } from '../../../sim/abilityPolicy';
import { ALL_ROSTER, rosterFor, type RosterId } from '../../../sim/cards';
import { SQUAD_SIZE } from '../../../sim/config';
import { spellFor, type SpellId } from '../../../sim/spells';
import { validateSquad } from '../../../sim/squad';
import { getElement, toCssColor } from '../../game/elements';
import { loadLoadout, saveSquad, saveStances } from '../loadout';
import styles from './Builders.module.css';
import appStyles from '../App.module.css';

const ROLE_FILTERS = ['all', 'tank', 'damage', 'support'] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];

/**
 * What each stance buys, in the player's words rather than the evaluator's.
 *
 * Measured over 40 matches a squad at `normal` beats the same squad at `hold`
 * 33-7, and `hold` still spends about four fifths of what `normal` spends — so
 * "hold" is honestly a throttle, not an off switch, and the copy says throttle.
 */
const STANCE_HINT: Record<Stance, string> = {
  hold: 'Saves the kit for trouble — your core under pressure, this mage hurt, or an enemy in your ground.',
  normal: 'Spends a skill when it catches enough targets to be worth it.',
  aggressive: 'Spends on whatever it can reach, without waiting for a cluster.',
};

/** The kit is the mage now, so it reads as a list wherever a mage is shown. */
function kitNames(abilities: readonly SpellId[]): string {
  return abilities.map((id) => spellFor(id)?.name ?? id).join(' · ');
}

/**
 * Pick the four mages that fight for you. Every mage is permanent for the whole
 * match and respawns on death (GDD §4), so this is the single most consequential
 * choice a player makes — and until now the sim hardcoded it.
 */
export function SquadBuilder(props: { onSaved?: () => void } = {}): JSX.Element {
  const [squad, setSquad] = useState<RosterId[]>(() => loadLoadout().squad);
  const [stances, setStances] = useState<Partial<Record<RosterId, Stance>>>(() => loadLoadout().stances);
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [saved, setSaved] = useState(false);

  const validation = validateSquad(squad);

  const add = (id: RosterId): void => {
    if (squad.length >= SQUAD_SIZE || squad.includes(id)) return;
    setSquad([...squad, id]);
    setSaved(false);
  };

  const removeAt = (index: number): void => {
    setSquad(squad.filter((_, i) => i !== index));
    setSaved(false);
  };

  const setStance = (id: RosterId, stance: Stance): void => {
    setStances({ ...stances, [id]: stance });
    setSaved(false);
  };

  const save = (): void => {
    if (!validation.ok) return;
    saveSquad(squad);
    // Only the four that are going. A stance left behind by a mage the player
    // dropped would come back the moment they picked it up again, which reads
    // as the builder remembering something it was never told twice.
    saveStances(Object.fromEntries(squad.map((id) => [id, stances[id] ?? 'normal'])));
    setSaved(true);
    props.onSaved?.();
  };

  const pool = ALL_ROSTER.filter((id) => filter === 'all' || rosterFor(id)!.role === filter);

  return (
    <div>
      <p class={appStyles.panelHint}>
        Four mages, all three roles, no duplicates. Each one carries its own kit and spends it itself — the
        stance is how hard you let it.
      </p>

      <div class={styles.slots}>
        {Array.from({ length: SQUAD_SIZE }, (_, i) => {
          const id = squad[i];
          const entry = id ? rosterFor(id) : undefined;
          if (!entry) {
            return (
              <div class={styles.slot} key={`empty-${i}`}>
                <span class={styles.slotRole}>Slot {i + 1}</span>
                <span class={styles.slotName}>Empty</span>
              </div>
            );
          }
          const stance = stances[entry.id] ?? 'normal';
          return (
            <div
              key={entry.id}
              class={`${styles.slot} ${styles.slotFilled} ${styles.slotBody}`}
              style={{ '--element-color': toCssColor(getElement(entry.element).color) } as JSX.CSSProperties}
            >
              <div class={styles.slotTop}>
                <span class={styles.slotName}>{entry.name}</span>
                <span class={styles.slotRole}>{entry.role}</span>
              </div>
              <span class={styles.slotKit}>{kitNames(entry.abilities)}</span>
              <div class={styles.stances} title={STANCE_HINT[stance]}>
                {ALL_STANCES.map((s) => (
                  <button
                    type="button"
                    key={s}
                    class={s === stance ? `${styles.stanceBtn} ${styles.stanceBtnActive}` : styles.stanceBtn}
                    title={STANCE_HINT[s]}
                    onClick={() => setStance(entry.id, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button type="button" class={styles.slotDrop} onClick={() => removeAt(i)}>
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <div class={appStyles.elementChips} style={{ margin: '16px 0 12px' }}>
        {ROLE_FILTERS.map((role) => (
          <button
            type="button"
            key={role}
            class={filter === role ? `${appStyles.chip} ${appStyles.chipActive}` : appStyles.chip}
            onClick={() => setFilter(role)}
          >
            {role === 'all' ? 'All' : role}
          </button>
        ))}
      </div>

      <div class={styles.pool}>
        {pool.map((id) => {
          const entry = rosterFor(id)!;
          const picked = squad.includes(id);
          const full = squad.length >= SQUAD_SIZE;
          return (
            <button
              type="button"
              key={id}
              class={picked ? `${styles.card} ${styles.cardPicked}` : styles.card}
              style={{ '--element-color': toCssColor(getElement(entry.element).color) } as JSX.CSSProperties}
              disabled={picked || full}
              onClick={() => add(id)}
            >
              <div class={styles.cardHead}>
                <h4 class={styles.cardName}>{entry.name}</h4>
                <span class={picked ? `${appStyles.badge} ${appStyles.badgeTeal}` : appStyles.badge}>
                  {picked ? 'In squad' : entry.role}
                </span>
              </div>
              <p class={styles.cardMeta}>
                {entry.health} HP · {entry.moveSpeed} speed · {getElement(entry.element).name}
                {entry.healPerSecond ? <> · heals {entry.healPerSecond}/s</> : null}
                {entry.auraChargeBonus ? <> · +{Math.round(entry.auraChargeBonus * 100)}% ally charge</> : null}
              </p>
              <p class={styles.cardMeta}>{kitNames(entry.abilities)}</p>
            </button>
          );
        })}
      </div>

      <div class={styles.saveBar}>
        {validation.ok ? (
          <span class={saved ? styles.saveState : styles.saveHint}>
            {saved ? 'Squad saved — it ships with your next match.' : 'Legal squad. Save to bring it.'}
          </span>
        ) : (
          <span class={appStyles.error}>{validation.reason}</span>
        )}
        <button
          type="button"
          class={`${appStyles.btn} ${appStyles.btnGhost}`}
          onClick={() => {
            setSquad([]);
            setSaved(false);
          }}
        >
          Clear
        </button>
        <button type="button" class={`${appStyles.btn} ${appStyles.btnTeal}`} disabled={!validation.ok} onClick={save}>
          Save squad
        </button>
      </div>
    </div>
  );
}
