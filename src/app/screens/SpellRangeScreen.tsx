import { Fragment, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { rosterFor } from '../../../sim/cards';
import { spellFor } from '../../../sim/spells';
import { RUNNING_ORDER, SpellRangeSession, type SpellRangeNowPlaying } from '../../dev/SpellRangeSession';
import { spellRangeMap } from '../../dev/spellRangeMap';
import type { MapData } from '../../game/types';
import { LOCAL_PLAYER_TEAM } from '../../net/LocalSession';
import { OnlineMatch } from '../../net/OnlineMatch';
import { cardInk, DECK_COLOR_LABEL } from '../../ui/deckColors';
import { spellVfxFor } from '../../render/spellVfx';
import styles from '../App.module.css';

/**
 * The card range: every spell in the catalog landing on the same spot, on a
 * loop, with a readout naming the one you are looking at.
 *
 * A dev surface like the firing range next to it, and for the same reason.
 * Judging a cast beat inside a real match means waiting for a rule to fire a
 * card you happen to want to see, somewhere you happen to be looking, at most
 * once every three quarters of a second across two whole teams. Here the seven
 * come round in order, at one spot, and the readout says which card it was and
 * which side cast it — so "does Chuva de Meteoros read as something arriving
 * from above, and does it read differently from Campo de Sobrecarga" is a
 * question you can answer in twenty seconds instead of a match.
 */
export function SpellRangeScreen(props: { onExit(): void }): JSX.Element {
  const [running, setRunning] = useState(true);
  const [now, setNow] = useState<SpellRangeNowPlaying | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<OnlineMatch | null>(null);
  const sessionRef = useRef<SpellRangeSession | null>(null);

  useEffect(() => {
    if (!running || !hostRef.current) return;
    const host = hostRef.current;

    const session = new SpellRangeSession({
      onSnapshot: (msg) => matchRef.current?.applySnapshot(msg),
      onCast: setNow,
    });
    sessionRef.current = session;

    // No fetch: the range map is generated, not a file under public/maps.
    const mapData = spellRangeMap() as unknown as MapData;
    matchRef.current = new OnlineMatch(host, session, {
      spectating: false,
      localPlayerId: 'spell-range',
      localTeam: LOCAL_PLAYER_TEAM,
      mapData,
      // Bare arena: there is no hand, no clock and no opponent here, and the
      // card bar would be a row of cards nobody is playing.
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

  if (!running) return <SpellRangeIntro onStart={() => setRunning(true)} onExit={props.onExit} />;

  return (
    <div class={styles.onlineMatch} ref={hostRef}>
      <RunningOrder now={now} />
    </div>
  );
}

/**
 * The running order, with the card currently on the stage lit up.
 *
 * Colour and label come from `deckColors`, the same table the deck builder and
 * the strategy editor tint from — a card that is red in the builder has to be
 * red here or the accent stops meaning anything. `shape` is on the row too,
 * because the whole point of standing here is checking that the beat you are
 * watching is the one the descriptor claims.
 */
function RunningOrder(props: { now: SpellRangeNowPlaying | null }): JSX.Element {
  const now = props.now;
  return (
    <div
      style={{
        // Bottom-left, clear of the top strip and the upper-left panel, exactly
        // where the firing range puts its own legend.
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'rgba(12, 18, 26, 0.82)',
        color: '#e8eef6',
        font: '12px/1.6 system-ui, sans-serif',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: '6px', letterSpacing: '0.08em' }}>
        KIT RANGE
      </strong>
      {RUNNING_ORDER.map(({ spellId: id, rosterId }, i) => {
        const card = spellFor(id);
        if (!card) return null;
        const live = now?.index === i;
        // The order runs kit by kit, so the mage's name heads its own block
        // rather than repeating on every row.
        const opensKit = i === 0 || RUNNING_ORDER[i - 1].rosterId !== rosterId;
        return (
          <Fragment key={id}>
            {opensKit ? (
              <div
                style={{
                  marginTop: i === 0 ? 0 : '5px',
                  opacity: now?.rosterId === rosterId ? 0.95 : 0.55,
                  fontSize: '10px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {rosterFor(rosterId)?.name ?? rosterId}
              </div>
            ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              opacity: live ? 1 : 0.5,
            }}
          >
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '2px',
                background: cardInk(id),
                boxShadow: live ? `0 0 8px ${cardInk(id)}` : 'none',
              }}
            />
            <span>
              {card.name} · <em style={{ opacity: 0.72 }}>{DECK_COLOR_LABEL[card.color]}</em> ·{' '}
              <em style={{ opacity: 0.72 }}>{spellVfxFor(id).shape}</em>
            </span>
          </div>
          </Fragment>
        );
      })}
      <div style={{ marginTop: '6px', opacity: 0.72 }}>
        {now === null
          ? 'waiting for the first cast…'
          : /*
             * Which side cast it is the third question a beat has to answer,
             * and the only one you cannot check by looking at one cast alone —
             * you have to see the same card land both ways. The sides alternate
             * every card and there are an odd number of cards, so each one
             * swaps sides from one lap to the next on its own.
             */
            `cast by ${now.team === LOCAL_PLAYER_TEAM ? 'you — white core flash' : 'the opponent'}`}
      </div>
    </div>
  );
}

function SpellRangeIntro(props: { onStart(): void; onExit(): void }): JSX.Element {
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Dev</p>
      <h2 class={styles.panelTitle}>Card range</h2>
      <p class={styles.panelHint}>
        Every card in the catalog landing on the same spot, in order, on a loop — for judging how the cast beats read
        against each other.
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
