import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../../../sim/bot/Brain';
import { rosterFor } from '../../../sim/cards';
import { ApiClient } from '../../net/ApiClient';
import { LocalSession, LOCAL_PLAYER_TEAM } from '../../net/LocalSession';
import { loadOnlineMapData, OnlineMatch } from '../../net/OnlineMatch';
import { reportFor } from '../../net/SiegeMatchReporter';
import { recordMatch, type MatchRecord } from '../matchHistory';
import { loadLoadout } from '../loadout';
import styles from '../App.module.css';

const DIFFICULTIES: readonly (readonly [Difficulty, string])[] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
];

/**
 * Practice runs the real siege locally — same world, same bots, same HUD as a
 * ranked match, minus the server. That is the point: the old practice mode was
 * a different game, so what it taught did not transfer.
 */
export function PracticeScreen(props: { onExit(): void; token?: string; playerName: string }): JSX.Element {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<OnlineMatch | null>(null);
  const sessionRef = useRef<LocalSession | null>(null);

  useEffect(() => {
    if (!running || !hostRef.current) return;
    const host = hostRef.current;
    const loadout = loadLoadout();
    let cancelled = false;

    const session = new LocalSession({
      squad: loadout.squad,
      deck: loadout.deck,
      difficulty,
      onSnapshot: (msg) => matchRef.current?.applySnapshot(msg),
      onMatchResult: (summary) => {
        const mine = summary.perTeam[LOCAL_PLAYER_TEAM];
        const record: MatchRecord = {
          at: Date.now(),
          mode: 'practice',
          won: summary.winnerTeam === -1 ? null : summary.winnerTeam === LOCAL_PLAYER_TEAM,
          squad: mine.squad,
          cards: mine.casts,
          kills: mine.kills,
          deaths: mine.deaths,
          durationSeconds: summary.durationSeconds,
          structuresDestroyed: mine.structuresDestroyed,
        };
        recordMatch(record);

        // Practice logs as 'sp-vs-ai' on the account: it is a real match against
        // an AI, which is exactly what that mode has always meant.
        const token = props.token;
        if (token) {
          ApiClient.reportMatch(token, reportFor(record, 'sp-vs-ai')).catch(() => {
            // Local history already has it; a failed sync is not worth a dialog.
          });
        }

        matchRef.current?.showRoundResult(summary.winnerTeam);
      },
    });
    sessionRef.current = session;

    void loadOnlineMapData()
      .then((mapData) => {
        if (cancelled) return;
        matchRef.current = new OnlineMatch(host, session, {
          spectating: false,
          localPlayerId: 'local',
          localTeam: LOCAL_PLAYER_TEAM,
          mapData,
          // Practice has no roster to read names off, but the HUD is the same
          // one a ranked match uses — so it gets the same two labels.
          getTeamName: (wireTeam) =>
            wireTeam === LOCAL_PLAYER_TEAM ? props.playerName : 'AI Commander',
          onTick: (dt) => session.tick(dt),
          onLeaveMatch: () => {
            setRunning(false);
            props.onExit();
          },
        });
      })
      .catch((err: unknown) => {
        console.error('practice match failed to start', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the arena map');
          setRunning(false);
        }
      });

    return () => {
      cancelled = true;
      matchRef.current?.dispose();
      matchRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [running, difficulty, props.token]);

  if (running) return <div class={styles.onlineMatch} ref={hostRef} />;

  const loadout = loadLoadout();

  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Solo</p>
      <h2 class={styles.panelTitle}>Practice</h2>
      <p class={styles.panelHint}>
        The full siege against an AI commander, simulated right here — no server, no queue, and nothing you do counts
        towards the ranking.
      </p>

      {error ? <p class={styles.error}>{error}</p> : null}

      <div class={styles.form}>
        <label class={styles.field}>
          <span>Opponent</span>
          <select
            class={styles.select}
            value={difficulty}
            onChange={(e) => setDifficulty(e.currentTarget.value as Difficulty)}
          >
            {DIFFICULTIES.map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <p class={styles.panelHint}>
          Your squad: {loadout.squad.map((id) => rosterFor(id)?.name ?? id).join(' · ')}
        </p>

        <button type="button" class={`${styles.btn} ${styles.btnBlock} ${styles.btnTeal}`} onClick={() => setRunning(true)}>
          Start practice
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onExit}>
          Back
        </button>
      </div>
    </div>
  );
}
