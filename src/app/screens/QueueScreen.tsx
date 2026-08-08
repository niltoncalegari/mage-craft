import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MatchFoundMsg, QueueStatusMsg } from '../../net/protocol';
import styles from '../App.module.css';

/**
 * The waiting room for the matchmaking queue. The server reports the queue once,
 * on join, so the clock here is local — and it is the honest number anyway: what
 * the player wants to know is how long *they* have been waiting.
 */
export function QueueScreen(props: {
  status: QueueStatusMsg | null;
  found: MatchFoundMsg | null;
  netError: string | null;
  onCancel(): void;
}): JSX.Element {
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    const started = Date.now() - (props.status?.elapsedSeconds ?? 0) * 1000;
    const timer = window.setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [props.status]);

  const found = props.found;
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Matchmaking</p>
      <h2 class={styles.panelTitle}>{found ? 'Opponent found' : 'Finding an opponent'}</h2>

      {found ? (
        <p class={styles.panelHint}>
          {found.againstBot
            ? 'No one else was searching, so an AI commander takes the other side.'
            : `Facing ${found.opponentName}.`}{' '}
          Entering the arena…
        </p>
      ) : (
        <>
          <p class={styles.panelHint}>
            Waiting {waited}s · {props.status?.waiting ?? 1} in queue · position{' '}
            {props.status?.position ?? 1}
          </p>
          <p class={styles.panelHint} style={{ marginTop: 8 }}>
            If nobody shows up, an AI commander takes the seat so you still play.
          </p>
        </>
      )}

      {props.netError ? <p class={styles.error}>{props.netError}</p> : null}

      <div class={styles.toolbar} style={{ marginTop: 16 }}>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
