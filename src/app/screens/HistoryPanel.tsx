import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isRosterId } from '../../../sim/cards';
import { isSpellId, spellFor, type SpellId } from '../../../sim/spells';
import { ApiClient, type CardStat, type ElementStat, type SquadStat } from '../../net/ApiClient';
import type { UserProfile } from '../auth';
import { ElementUsageChart } from '../ElementUsageChart';
import { bestComps, compLabel, loadHistory, mostUsedCards, type CompStat, type MatchRecord } from '../matchHistory';
import styles from './Builders.module.css';
import appStyles from '../App.module.css';

const BUFF_COLOR = '#3ecfbf';
const CURSE_COLOR = '#c9853e';

/**
 * What your past matches say about your loadout: which comps convert into wins,
 * which cards you actually spend mana on, and the run of recent results behind
 * both numbers.
 */
export function HistoryPanel(props: { user: UserProfile }): JSX.Element {
  const [history, setHistory] = useState<MatchRecord[]>(() => loadHistory());
  const [elementStats, setElementStats] = useState<ElementStat[]>([]);
  const [serverComps, setServerComps] = useState<SquadStat[]>([]);
  const [serverCards, setServerCards] = useState<CardStat[]>([]);
  const [loadError, setLoadError] = useState('');

  // Re-read on mount so a match played earlier this session shows up without a
  // reload; the store is the source of truth, this component never caches it.
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    const token = props.user.token;
    if (!token) return;
    let cancelled = false;
    Promise.all([ApiClient.myElementStats(token), ApiClient.mySquadStats(token), ApiClient.myCardStats(token)])
      .then(([elements, squads, cards]) => {
        if (cancelled) return;
        setElementStats(elements.elements);
        setServerComps(squads.squads);
        setServerCards(cards.cards);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load your stats.');
      });
    return () => {
      cancelled = true;
    };
  }, [props.user.token]);

  // The account's aggregates cover every device and every match ever logged;
  // the local computation is the guest path and the offline fallback.
  const comps: CompStat[] =
    serverComps.length > 0
      ? serverComps.map((s) => ({
          signature: s.signature,
          squad: s.squad.filter(isRosterId),
          games: s.games,
          wins: s.wins,
          winRate: s.winRate,
        }))
      : bestComps(history);

  const cards =
    serverCards.length > 0
      ? serverCards.filter((s) => isSpellId(s.cardId)).map((s) => ({ cardId: s.cardId as SpellId, casts: s.casts }))
      : mostUsedCards(history);

  const maxCasts = Math.max(...cards.map((c) => c.casts), 1);

  if (history.length === 0) {
    return (
      <div>
        <p class={appStyles.panelHint}>
          No matches recorded yet. Play a practice run or queue for a match — every result lands here, comp and all.
        </p>
        {props.user.token ? (
          <>
            <p class={appStyles.panelHint} style={{ margin: '18px 0 10px' }}>
              Skills used (all matches)
            </p>
            {loadError ? <p class={appStyles.error}>{loadError}</p> : null}
            <ElementUsageChart stats={elementStats} />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p class={appStyles.panelHint} style={{ marginBottom: 10 }}>
        Best compositions {comps.length === 0 ? '— play a comp twice to rank it' : ''}
      </p>
      <ul class={styles.costCurve}>
        {comps.map((comp) => (
          <li class={styles.costRow} key={comp.signature}>
            <span class={styles.costLabel} title={compLabel(comp.squad)}>
              {compLabel(comp.squad)}
            </span>
            <div class={styles.track} aria-hidden="true">
              <div
                class={styles.fill}
                style={{ width: `${Math.max(4, Math.round(comp.winRate * 100))}%`, background: BUFF_COLOR }}
              />
            </div>
            <span
              class={styles.costValue}
              aria-label={`${compLabel(comp.squad)}: ${Math.round(comp.winRate * 100)} percent win rate over ${comp.games} games`}
            >
              {Math.round(comp.winRate * 100)}% · {comp.games} games
            </span>
          </li>
        ))}
      </ul>

      <p class={appStyles.panelHint} style={{ margin: '18px 0 10px' }}>
        Most used cards
      </p>
      <ul class={styles.costCurve}>
        {cards.map((stat) => {
          const card = spellFor(stat.cardId);
          return (
            <li class={styles.costRow} key={stat.cardId}>
              <span class={styles.costLabel}>{card?.name ?? stat.cardId}</span>
              <div class={styles.track} aria-hidden="true">
                <div
                  class={styles.fill}
                  style={{
                    width: `${Math.max(4, Math.round((stat.casts / maxCasts) * 100))}%`,
                    background: card?.kind === 'curse' ? CURSE_COLOR : BUFF_COLOR,
                  }}
                />
              </div>
              <span class={styles.costValue}>{stat.casts} casts</span>
            </li>
          );
        })}
      </ul>

      <p class={appStyles.panelHint} style={{ margin: '18px 0 10px' }}>
        Recent matches
      </p>
      <div class={appStyles.roomList}>
        {history.slice(0, 10).map((match) => (
          <div class={appStyles.matchRow} key={match.at}>
            <div>
              <p class={appStyles.roomName}>
                {match.won === null ? 'Draw' : match.won ? 'Victory' : 'Defeat'} ·{' '}
                {match.mode === 'pvp' ? 'ranked' : 'practice'}
              </p>
              <p class={appStyles.roomMeta}>
                {compLabel(match.squad)} · {match.kills} kills · {match.deaths} deaths ·{' '}
                {Math.round(match.durationSeconds)}s
              </p>
            </div>
            <span class={match.won ? `${appStyles.badge} ${appStyles.badgeTeal}` : appStyles.badge}>
              {match.structuresDestroyed} destroyed
            </span>
          </div>
        ))}
      </div>

      {props.user.token ? (
        <>
          <p class={appStyles.panelHint} style={{ margin: '18px 0 10px' }}>
            Skills used (all matches)
          </p>
          {loadError ? <p class={appStyles.error}>{loadError}</p> : null}
          <ElementUsageChart stats={elementStats} />
        </>
      ) : null}
    </div>
  );
}
