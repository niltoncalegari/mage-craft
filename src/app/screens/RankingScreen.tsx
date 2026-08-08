import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiClient, type RankingEntry } from '../../net/ApiClient';
import styles from '../App.module.css';

export function RankingScreen(props: { onBack(): void }): JSX.Element {
  const [sort, setSort] = useState<'wins' | 'kdr'>('wins');
  const [entries, setEntries] = useState<RankingEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ApiClient.ranking(sort)
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the ranking.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Global</p>
          <h2 class={styles.panelTitle}>Ranking</h2>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onBack}>
          Dashboard
        </button>
      </div>

      <div class={styles.toolbar}>
        {(
          [
            ['wins', 'By wins'],
            ['kdr', 'By KDR'],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            class={sort === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setSort(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p class={styles.error}>{error}</p> : null}
      {!error && loading ? <p class={styles.panelHint}>Loading…</p> : null}
      {!error && !loading && entries.length === 0 ? (
        <p class={styles.panelHint}>No ranked players yet — be the first to report a match.</p>
      ) : null}

      <div class={styles.roomList}>
        {entries.map((entry, index) => (
          <div class={`${styles.matchRow} ${styles.matchRowRanked}`} key={entry.userId}>
            <span class={styles.rankPosition}>#{index + 1}</span>
            <div>
              <p class={styles.roomName}>{entry.username}</p>
              <p class={styles.roomMeta}>
                {entry.wins}W {entry.losses}L · {entry.kills} kills · {entry.deaths} deaths
              </p>
            </div>
            <span class={styles.badge}>{entry.kdr.toFixed(2)} KDR</span>
          </div>
        ))}
      </div>
    </div>
  );
}
