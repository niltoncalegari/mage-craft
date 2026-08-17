import type { JSX } from 'preact';
import type { CardId } from '../../../../sim/spells';
import type { StrategyRule } from '../../../../sim/strategy';
import { RuleCard } from './RuleCard';
import styles from './Strategy.module.css';
import { moveItem, type DragList } from './useDragList';

/**
 * The flowchart: the spine, the rules on it, and the node that closes it.
 *
 * The terminal is not decoration. An idle player's most common question about
 * their own program is "why did nothing happen?", and the honest answer is that
 * a list can run out — so the list says out loud where it ends and what that
 * means. Every rule keeps its `senão` notch, the last one included, because the
 * last rule falls through to exactly this.
 */
export function RuleList(props: {
  rules: readonly StrategyRule[];
  cards: readonly CardId[];
  drag: DragList;
  onChange(next: StrategyRule[]): void;
}): JSX.Element {
  const { rules, drag } = props;
  const dropIndex = drag.drag?.dropIndex ?? -1;

  const terminalClass = [
    styles.terminal,
    rules.length === 0 ? styles.terminalLoose : '',
    dropIndex === rules.length ? styles.dropAbove : '',
  ]
    .filter(Boolean)
    .join(' ');

  const replaceAt = (index: number, next: StrategyRule): void => {
    props.onChange(rules.map((r, i) => (i === index ? next : r)));
  };

  return (
    <div class={styles.flow}>
      {rules.length === 0 ? (
        <p class={styles.empty}>
          <span class={styles.emptyLead}>No rules yet.</span>
          This program casts nothing — a legal way to play, and the baseline every other program is measured
          against. Drag a card onto the spine to place a rule, or tap one to add it at the end.
        </p>
      ) : (
        <ol class={styles.stack}>
          {rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={index}
              cards={props.cards}
              isDropTarget={dropIndex === index}
              rowRef={drag.rowRef(index)}
              onGrab={(ev) => drag.beginDrag({ kind: 'move', index }, ev)}
              // A nudge up is the gap above the rule before it; a nudge down is
              // the gap below the rule after it. Both are no-ops at the ends,
              // which `moveItem` already handles by clamping.
              onNudge={(direction) =>
                props.onChange(moveItem(rules, index, direction === -1 ? index - 1 : index + 2))
              }
              onChange={(next) => replaceAt(index, next)}
              onRemove={() => props.onChange(rules.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      )}

      <p class={terminalClass}>
        <span class={styles.terminalNode} aria-hidden="true" />
        <span class={styles.terminalText}>nenhuma regra se aplica → não conjura</span>
      </p>
    </div>
  );
}
