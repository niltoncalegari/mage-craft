import type { JSX } from 'preact';
import { getElement, isElementId } from '../game/elements';
import type { ElementStat } from '../net/ApiClient';
import styles from './ElementUsageChart.module.css';

/**
 * Horizontal bar chart of casts per element, annotated with hits/kills/damage.
 * Pure SVG-free (div bars) so it stays legible without a charting dependency —
 * see docs/accounts-ranking-dashboard.md §5.
 */
export function ElementUsageChart(props: { stats: ReadonlyArray<ElementStat> }): JSX.Element {
  if (props.stats.length === 0) {
    return <p class={styles.empty}>No casts recorded yet — play a match to fill this in.</p>;
  }

  const maxCasts = Math.max(...props.stats.map((s) => s.casts), 1);

  return (
    <ul class={styles.chart}>
      {props.stats.map((stat) => {
        const info = isElementId(stat.elementId) ? getElement(stat.elementId) : null;
        const color = info ? `#${info.color.toString(16).padStart(6, '0')}` : '#9aadc0';
        const widthPct = Math.max(4, Math.round((stat.casts / maxCasts) * 100));
        return (
          <li class={styles.row} key={stat.elementId}>
            <span class={styles.label}>{info?.name ?? stat.elementId}</span>
            <div class={styles.track} aria-hidden="true">
              <div class={styles.fill} style={{ width: `${widthPct}%`, background: color }} />
            </div>
            <span
              class={styles.value}
              aria-label={`${info?.name ?? stat.elementId}: ${stat.casts} casts, ${stat.hits} hits, ${stat.kills} kills, ${stat.damageDealt} damage`}
            >
              {stat.casts} casts · {stat.kills} kills
            </span>
          </li>
        );
      })}
    </ul>
  );
}
