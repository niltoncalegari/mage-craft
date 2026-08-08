import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getElement, isElementId, toCssColor } from '../../game/elements';
import { ApiClient, type UserSummary } from '../../net/ApiClient';
import type { UserProfile } from '../auth';
import styles from '../App.module.css';

/**
 * The landing surface. A siege is decided by the squad you brought and the
 * spells you spend, not by which room you joined — so the shell offers exactly
 * three things: play against someone, play against an AI, or go change what you
 * bring. Custom rooms still exist, one link down, for people who want to pick
 * their opponent.
 */
export function HomeScreen(props: {
  user: UserProfile;
  stats?: { wins: number; losses: number };
  onFindMatch(): void;
  onPractice(): void;
  onOpenDashboard(): void;
  onOpenRanking(): void;
  onCustomMatch(): void;
  onSignOut(): void;
}): JSX.Element {
  const [serverStats, setServerStats] = useState<UserSummary | null>(null);

  useEffect(() => {
    const token = props.user.token;
    if (!token) return;
    let cancelled = false;
    ApiClient.me(token)
      .then((me) => {
        if (!cancelled) setServerStats(me.stats);
      })
      .catch(() => {
        /* the tiles matter more than the stat row; the dashboard reports errors */
      });
    return () => {
      cancelled = true;
    };
  }, [props.user.token]);

  const wins = serverStats?.wins ?? props.stats?.wins ?? props.user.wins;
  const losses = serverStats?.losses ?? props.stats?.losses ?? props.user.losses;

  const favoriteId =
    serverStats?.favoriteElement && isElementId(serverStats.favoriteElement)
      ? serverStats.favoriteElement
      : isElementId(props.user.favoriteElement)
        ? props.user.favoriteElement
        : 'fire';
  const favorite = getElement(favoriteId);

  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Welcome</p>
          <h2 class={styles.panelTitle}>{props.user.name}</h2>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onSignOut}>
          Sign out
        </button>
      </div>

      <div class={styles.dashGrid}>
        <div class={styles.profileCard}>
          <div class={styles.statRow}>
            <div class={styles.stat}>
              <b>{wins}</b>
              <span>Wins</span>
            </div>
            <div class={styles.stat}>
              <b>{losses}</b>
              <span>Losses</span>
            </div>
            {serverStats ? (
              <div class={styles.stat}>
                <b>{serverStats.kdr.toFixed(2)}</b>
                <span>KDR</span>
              </div>
            ) : null}
          </div>
          {!props.user.token ? (
            <p class={styles.panelHint} style={{ marginTop: 14 }}>
              Playing as guest — create an account to keep KDR, match history and a ranking spot across devices.
            </p>
          ) : null}
          <p class={styles.panelHint} style={{ marginTop: 14 }}>
            Favorite element
          </p>
          <div
            class={styles.favoriteElement}
            style={{ '--element-color': toCssColor(favorite.color) } as JSX.CSSProperties}
            title={favorite.role}
          >
            <span class={styles.favoriteSwatch} aria-hidden="true" />
            <span class={styles.favoriteName}>{favorite.name}</span>
          </div>
          <button
            type="button"
            class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`}
            style={{ marginTop: 16 }}
            onClick={props.onOpenRanking}
          >
            Ranking
          </button>
        </div>

        <div>
          <div class={styles.actionGrid}>
            <button type="button" class={`${styles.actionCard} ${styles.actionCardPrimary}`} onClick={props.onFindMatch}>
              <h3>Find Match</h3>
              <p>
                Queue for a 1v1 siege. Paired by arrival — no code, no ready-up. If nobody is searching, an AI commander
                takes the seat so you still play.
              </p>
            </button>
            <button type="button" class={styles.actionCard} onClick={props.onPractice}>
              <h3>Practice</h3>
              <p>The same siege against an AI commander, run locally. No server, no queue, no ranking.</p>
            </button>
            <button type="button" class={styles.actionCard} onClick={props.onOpenDashboard}>
              <h3>Dashboard</h3>
              <p>Build your squad and deck, and read what your past matches say about them.</p>
            </button>
          </div>

          <div class={styles.footerBar} style={{ marginTop: 16 }}>
            <p class={styles.panelHint}>Want to pick your opponent, team sizes or spectate?</p>
            <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onCustomMatch}>
              Custom match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
