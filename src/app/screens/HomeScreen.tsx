import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { defaultSquad, isRosterId, rosterFor } from '../../../sim/cards';
import { getElement, toCssColor } from '../../game/elements';
import { ApiClient, type UserSummary } from '../../net/ApiClient';
import type { UserProfile } from '../auth';
import { pushLoadoutToServer, syncLoadoutFromServer } from '../loadout';
import styles from '../App.module.css';
import { HistoryPanel } from './HistoryPanel';
import { RankingPanel } from './RankingPanel';
import { SquadBuilder } from './SquadBuilder';

type LoadoutTab = 'squad' | 'history';

// Deck and Strategy are gone with the hand (plano v1.3 §3.1): a mage carries
// its own kit, so there is no deck to build and no program to write. What the
// player assembles is the squad, and the postures live inside that tab.
const LOADOUT_TABS: readonly (readonly [LoadoutTab, string])[] = [
  ['squad', 'Squad'],
  ['history', 'History'],
];

/**
 * The landing surface. A siege is decided by the squad you brought and the
 * spells you spend, not by which room you joined — so the shell offers exactly
 * two things: play against someone, or play against an AI. Everything else —
 * loadout, match history, ranking — lives right here too, so nobody has to
 * leave the page to see it.
 */
export function HomeScreen(props: {
  user: UserProfile;
  stats?: { wins: number; losses: number };
  onFindMatch(): void;
  onPractice(): void;
  onSignOut(): void;
}): JSX.Element {
  const [serverStats, setServerStats] = useState<UserSummary | null>(null);
  const [loadoutTab, setLoadoutTab] = useState<LoadoutTab>('squad');

  useEffect(() => {
    let cancelled = false;
    ApiClient.me(props.user.token)
      .then((me) => {
        if (!cancelled) setServerStats(me.stats);
      })
      .catch(() => {
        /* the tiles matter more than the stat row; the dashboard reports errors */
      });

    // The account's loadout wins on boot, so signing in on a new machine brings
    // your squad, deck and program with you. Fire-and-forget: a pull that fails
    // leaves this device playing its own copy, which is not worth a banner.
    syncLoadoutFromServer(props.user.token).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [props.user.token]);

  /** The local copy wins on save — push it, and never block the builder on it. */
  const pushLoadout = (): void => {
    pushLoadoutToServer(props.user.token).catch(() => {});
  };

  const wins = serverStats?.wins ?? props.stats?.wins ?? props.user.wins;
  const losses = serverStats?.losses ?? props.stats?.losses ?? props.user.losses;
  const rating = serverStats?.rating;

  // The most-played 4-mage squad, not one "favorite" element — a match is
  // fought by a whole squad, and a single-element badge never said which one.
  // Falls back to the default squad for a player with no match history yet.
  const playedSquad = serverStats?.mostPlayedSquad?.filter(isRosterId) ?? [];
  const squad = (playedSquad.length ? playedSquad : defaultSquad()).map((id) => rosterFor(id));

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
            {rating !== undefined ? (
              <div class={styles.stat}>
                <b>{rating}</b>
                <span>Rating</span>
              </div>
            ) : null}
          </div>
          <p class={styles.panelHint} style={{ marginTop: 14 }}>
            Most-played squad
          </p>
          <div class={styles.squadStrip}>
            {squad.map((entry, i) =>
              entry ? (
                <span
                  key={`${entry.id}-${i}`}
                  class={styles.squadIcon}
                  style={{ '--element-color': toCssColor(getElement(entry.element).color) } as JSX.CSSProperties}
                  title={`${entry.name} · ${getElement(entry.element).name} · ${entry.role}`}
                >
                  {entry.name[0]}
                </span>
              ) : null,
            )}
          </div>
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
          </div>
        </div>
      </div>

      <div class={styles.panelHeader} style={{ marginTop: 28 }}>
        <p class={styles.tag}>Loadout</p>
      </div>
      <div class={styles.tabs}>
        {LOADOUT_TABS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            class={loadoutTab === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setLoadoutTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {loadoutTab === 'squad' ? <SquadBuilder onSaved={pushLoadout} /> : null}
      {loadoutTab === 'history' ? <HistoryPanel user={props.user} /> : null}

      <div class={styles.panelHeader} style={{ marginTop: 28 }}>
        <p class={styles.tag}>Global</p>
        <h3 class={styles.panelTitle}>Ranking</h3>
      </div>
      <RankingPanel />
    </div>
  );
}
