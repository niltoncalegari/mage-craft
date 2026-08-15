import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiClient, type RankingEntry } from '../../net/ApiClient';
import styles from '../App.module.css';

const COLLAPSED_COUNT = 5;
const EXPANDED_COUNT = 20;

/**
 * The global leaderboard, embedded on Home instead of behind its own screen —
 * a player shouldn't have to leave the page they queue from just to see where
 * they stand. Starts collapsed to a handful of rows; "Show more" expands in
 * place rather than navigating anywhere.
 */
export function RankingPanel(): JSX.Element {
  const [sort, setSort] = useState<'rating' | 'wins' | 'kdr'>('rating');
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<RankingEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ApiClient.ranking(sort, 1, EXPANDED_COUNT)
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

  const visible = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);

  return (
    <div>
      <div class={styles.toolbar}>
        {(
          [
            ['rating', 'By rating'],
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
        {visible.map((entry, index) => (
          <div class={`${styles.matchRow} ${styles.matchRowRanked}`} key={entry.userId}>
            <span class={styles.rankPosition}>#{index + 1}</span>
            <div>
              <p class={styles.roomName}>{entry.username}</p>
              <p class={styles.roomMeta}>
                {entry.wins}W {entry.losses}L · {entry.kills} kills · {entry.deaths} deaths
              </p>
            </div>
            <span class={styles.badge}>{sort === 'kdr' ? `${entry.kdr.toFixed(2)} KDR` : entry.rating}</span>
          </div>
        ))}
      </div>

      {!expanded && entries.length > COLLAPSED_COUNT ? (
        <button
          type="button"
          class={`${styles.btn} ${styles.btnGhost}`}
          style={{ marginTop: 10 }}
          onClick={() => setExpanded(true)}
        >
          Show more
        </button>
      ) : null}
    </div>
  );
}
