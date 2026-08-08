import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { UserProfile } from '../auth';
import { DeckBuilder } from './DeckBuilder';
import { HistoryPanel } from './HistoryPanel';
import { SquadBuilder } from './SquadBuilder';
import styles from '../App.module.css';

type Tab = 'squad' | 'deck' | 'history';

const TABS: readonly (readonly [Tab, string])[] = [
  ['squad', 'Squad'],
  ['deck', 'Deck'],
  ['history', 'History'],
];

/**
 * Everything you bring to a match and everything a match leaves behind, in one
 * place. The two builders write to localStorage (`src/app/loadout.ts`) and the
 * history tab reads whatever the last matches recorded.
 */
export function DashboardScreen(props: { user: UserProfile; onBack(): void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('squad');

  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Loadout</p>
          <h2 class={styles.panelTitle}>Dashboard</h2>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onBack}>
          Back
        </button>
      </div>

      <div class={styles.tabs}>
        {TABS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            class={tab === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'squad' ? <SquadBuilder /> : null}
      {tab === 'deck' ? <DeckBuilder /> : null}
      {tab === 'history' ? <HistoryPanel user={props.user} /> : null}
    </div>
  );
}
