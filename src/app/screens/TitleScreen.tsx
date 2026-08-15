import type { JSX } from 'preact';
import styles from '../App.module.css';

/**
 * The front door. There is one way past it — an account (see ../auth) — so the
 * only other button here is the firing range, and that one is a dev surface:
 * `import.meta.env.DEV` keeps it out of the production bundle's UI entirely.
 */
export function TitleScreen(props: {
  onEnter(): void;
  onOpenRange(): void;
  /** Whether to offer the dev-only firing range. */
  showRange: boolean;
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
        {props.showRange ? (
          <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onOpenRange}>
            Firing Range
          </button>
        ) : null}
      </div>
    </div>
  );
}
