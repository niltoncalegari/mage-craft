import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ALL_ROSTER, rosterFor, type RosterId } from '../../../sim/cards';
import { SQUAD_SIZE } from '../../../sim/config';
import { validateSquad } from '../../../sim/squad';
import { getElement, toCssColor } from '../../game/elements';
import { loadLoadout, saveSquad } from '../loadout';
import styles from './Builders.module.css';
import appStyles from '../App.module.css';

const ROLE_FILTERS = ['all', 'tank', 'damage', 'support'] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];

/**
 * Pick the four mages that fight for you. Every mage is permanent for the whole
 * match and respawns on death (GDD §4), so this is the single most consequential
 * choice a player makes — and until now the sim hardcoded it.
 */
export function SquadBuilder(): JSX.Element {
  const [squad, setSquad] = useState<RosterId[]>(() => loadLoadout().squad);
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

  const save = (): void => {
    if (!validation.ok) return;
    saveSquad(squad);
    setSaved(true);
  };

  const pool = ALL_ROSTER.filter((id) => filter === 'all' || rosterFor(id)!.role === filter);

  return (
    <div>
      <p class={appStyles.panelHint}>
        Four mages, all three roles, no duplicates. They hold the lane while your spells decide the fight.
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
          return (
            <button
              type="button"
              key={entry.id}
              class={`${styles.slot} ${styles.slotFilled}`}
              style={{ '--element-color': toCssColor(getElement(entry.element).color) } as JSX.CSSProperties}
              onClick={() => removeAt(i)}
            >
              <span class={styles.slotName}>{entry.name}</span>
              <span class={styles.slotRole}>{entry.role}</span>
              <span class={styles.slotRemove}>Remove</span>
            </button>
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
