import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ALL_ROSTER, rosterFor } from '../../../sim/cards';
import type { MapData } from '../../game/types';
import { rangeMap } from '../../../sim/rangeMap';
import { RangeSession } from '../../dev/RangeSession';
import { LOCAL_PLAYER_TEAM } from '../../net/LocalSession';
import { OnlineMatch } from '../../net/OnlineMatch';
import { ELEMENT_TINT } from '../../render/elementPalette';
import styles from '../App.module.css';

/**
 * The firing range: the whole roster in a row, each mage throwing its own spell
 * at the wall in front of it, on a loop.
 *
 * A dev surface, not a game mode. Judging a projectile inside a real siege
 * means waiting for the right mage to survive long enough to throw while you
 * happen to be looking at it — here every element fires from the same spot, at
 * the same charge, on the same beat, so shape, trail and impact can be compared
 * against each other rather than against memory.
 */
export function RangeScreen(props: { onExit(): void }): JSX.Element {
  const [running, setRunning] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<OnlineMatch | null>(null);
  const sessionRef = useRef<RangeSession | null>(null);

  useEffect(() => {
    if (!running || !hostRef.current) return;
    const host = hostRef.current;

    const session = new RangeSession({
      onSnapshot: (msg) => matchRef.current?.applySnapshot(msg),
    });
    sessionRef.current = session;

    // No fetch: the range map is generated, not a file under public/maps.
    const mapData = rangeMap() as unknown as MapData;
    matchRef.current = new OnlineMatch(host, session, {
      // Not spectating: that mode posts a "you play the next match" banner,
      // which is a lie here — there is no match and no next one.
      spectating: false,
      localPlayerId: 'range',
      localTeam: LOCAL_PLAYER_TEAM,
      mapData,
      // Bare arena: the range has no hand, no clock and no opponent, and the
      // squad panels would sit on top of the outer two lanes.
      chrome: false,
      onTick: (dt) => session.tick(dt),
      onLeaveMatch: () => {
        setRunning(false);
        props.onExit();
      },
    });

    return () => {
      matchRef.current?.dispose();
      matchRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [running, props.onExit]);

  if (!running) return <RangeIntro onStart={() => setRunning(true)} onExit={props.onExit} />;

  return (
    <div class={styles.onlineMatch} ref={hostRef}>
      <Legend />
    </div>
  );
}

/**
 * Which lane is which, in roster order — top lane first, matching `laneY`.
 * Without it the range answers "do these look different" but not "which one is
 * the Alchemist".
 */
function Legend(): JSX.Element {
  return (
    <div
      style={{
        // Bottom-left: the match HUD owns the top strip and the squad panel
        // owns the upper left, and the legend covered both on the first pass.
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'rgba(12, 18, 26, 0.82)',
        color: '#e8eef6',
        font: '12px/1.5 system-ui, sans-serif',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: '6px', letterSpacing: '0.08em' }}>
        FIRING RANGE
      </strong>
      {ALL_ROSTER.map((id) => {
        const entry = rosterFor(id);
        if (!entry) return null;
        const tint = ELEMENT_TINT[entry.element];
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '2px',
                background: `#${tint.core.toString(16).padStart(6, '0')}`,
                boxShadow: `0 0 6px #${tint.glow.toString(16).padStart(6, '0')}`,
              }}
            />
            <span>
              {entry.name} · <em style={{ opacity: 0.72 }}>{entry.element}</em>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RangeIntro(props: { onStart(): void; onExit(): void }): JSX.Element {
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Dev</p>
      <h2 class={styles.panelTitle}>Firing range</h2>
      <p class={styles.panelHint}>
        Every mage in the roster, side by side, throwing its own spell into a wall on a loop — for judging how the nine
        attacks read against each other.
      </p>
      <div class={styles.form}>
        <button type="button" class={`${styles.btn} ${styles.btnTeal}`} onClick={props.onStart}>
          Open range
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onExit}>
          Back
        </button>
      </div>
    </div>
  );
}
