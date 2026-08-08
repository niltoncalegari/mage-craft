import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import styles from '../App.module.css';

export function CreateRoomScreen(props: {
  hostName: string;
  netError: string | null;
  onBack(): void;
  onCreated(opts: { name: string; teamSize: number; fillBots: boolean; botDifficulty: string }): void;
}): JSX.Element {
  const [name, setName] = useState(`${props.hostName}'s Hall`);
  const [teamSize, setTeamSize] = useState(1);
  const [fillBots, setFillBots] = useState(true);
  const [botDifficulty, setBotDifficulty] = useState('normal');
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Host</p>
      <h2 class={styles.panelTitle}>Create room</h2>
      <p class={styles.panelHint}>Team size sets capacity (2 × size). Fill with bots to start alone.</p>
      {props.netError ? <p class={styles.panelHint}>{props.netError}</p> : null}
      <div class={styles.form}>
        <label class={styles.field}>
          <span>Room name</span>
          <input class={styles.input} value={name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class={styles.field}>
          <span>Team size</span>
          <select class={styles.select} value={String(teamSize)} onChange={(e) => setTeamSize(Number(e.currentTarget.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option value={n} key={n}>
                {n}v{n}
              </option>
            ))}
          </select>
        </label>
        <label class={styles.field}>
          <span>
            <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.currentTarget.checked)} /> Fill
            empty seats with bots
          </span>
        </label>
        {fillBots ? (
          <label class={styles.field}>
            <span>Bot difficulty</span>
            <select class={styles.select} value={botDifficulty} onChange={(e) => setBotDifficulty(e.currentTarget.value)}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          class={`${styles.btn} ${styles.btnBlock} ${styles.btnTeal}`}
          onClick={() => props.onCreated({ name, teamSize, fillBots, botDifficulty })}
        >
          Open lobby
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onBack}>
          Cancel
        </button>
      </div>
    </div>
  );
}
