import type { JSX } from 'preact';
import styles from '../App.module.css';

export function TitleScreen(props: {
  onEnter(): void;
  onPractice(): void;
  onOpenRange(): void;
}): JSX.Element {
  return (
    <div class={styles.titleScreen}>
      <p class={styles.tag}>Enter the arena</p>
      <h1 class={styles.brand}>Mage Craft</h1>
      <p class={styles.sub}>
        Charge your conjuration. Cross the portal. Short elemental duels — online halls or solo practice.
      </p>
      <div class={styles.titleActions}>
        <button type="button" class={`${styles.btn} ${styles.btnTeal}`} onClick={props.onEnter}>
          Enter Hall
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onPractice}>
          Quick Practice
        </button>
        {/* Dev surface: the whole roster firing at a wall, for judging spell VFX. */}
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onOpenRange}>
          Firing Range
        </button>
      </div>
    </div>
  );
}
