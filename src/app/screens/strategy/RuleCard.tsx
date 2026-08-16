import type { JSX } from 'preact';
import { spellFor, type CardId } from '../../../../sim/spells';
import type { Condition, StrategyRule, TargetSelector } from '../../../../sim/strategy';
import { cardInk } from '../../../ui/deckColors';
import { KEYWORD } from '../../../ui/strategyText';
import { ConditionEditor } from './ConditionEditor';
import { SelectorEditor } from './SelectorEditor';
import styles from './Strategy.module.css';

/**
 * One rule, hanging off the spine.
 *
 * It reads as a sentence in three clauses — *se* this, *então* that card, *em*
 * that place — with the keywords in a fixed gutter so twelve rules line up into
 * a listing rather than twelve independent forms.
 *
 * The numbered node is the drag handle. A rule's number *is* its priority, so
 * the control that changes the priority is the one showing it; a separate grip
 * would be a second widget for one idea. It answers arrow keys too, which is
 * both the keyboard path and the precise one — dragging is faster, nudging is
 * exact.
 */
export function RuleCard(props: {
  rule: StrategyRule;
  index: number;
  /** The distinct cards the deck brings — a rule may name nothing else. */
  cards: readonly CardId[];
  isDropTarget: boolean;
  rowRef(el: HTMLElement | null): void;
  onGrab(ev: PointerEvent): void;
  onNudge(direction: -1 | 1): void;
  onChange(next: StrategyRule): void;
  onRemove(): void;
}): JSX.Element {
  const { rule, index } = props;
  const number = index + 1;
  const spell = spellFor(rule.card);

  const classes = [styles.step, rule.enabled ? '' : styles.stepOff, props.isDropTarget ? styles.dropAbove : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li
      class={classes}
      ref={props.rowRef}
      style={{ '--element-color': cardInk(rule.card) } as JSX.CSSProperties}
    >
      <button
        type="button"
        class={styles.node}
        aria-label={`Regra ${number}. Arraste, ou use as setas, para mudar a prioridade.`}
        onPointerDown={props.onGrab}
        onKeyDown={(ev) => {
          if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
          ev.preventDefault();
          props.onNudge(ev.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        {number}
      </button>

      <div class={styles.rule}>
        <div class={styles.clauses}>
          <div class={styles.clause}>
            <span class={styles.kw}>{KEYWORD.IF}</span>
            <ConditionEditor
              value={rule.when}
              ruleNumber={number}
              onChange={(when: Condition) => props.onChange({ ...rule, when })}
            />
          </div>

          <div class={styles.clause}>
            <span class={styles.kw}>{KEYWORD.THEN}</span>
            <div class={styles.cardChip}>
              <span class={styles.dot} aria-hidden="true" />
              <select
                class={styles.pick}
                value={rule.card}
                aria-label={`Carta da regra ${number}`}
                onChange={(ev) => props.onChange({ ...rule, card: ev.currentTarget.value as CardId })}
              >
                {props.cards.map((id) => (
                  <option key={id} value={id}>
                    {spellFor(id)?.name ?? id}
                  </option>
                ))}
              </select>
              <span class={styles.cost}>{spell ? `${spell.cost} mana` : '—'}</span>
            </div>
          </div>

          <div class={styles.clause}>
            <span class={styles.kw}>{KEYWORD.AT}</span>
            <SelectorEditor
              value={rule.at}
              ruleNumber={number}
              onChange={(at: TargetSelector) => props.onChange({ ...rule, at })}
            />
          </div>
        </div>

        <div class={styles.ruleTools}>
          <button
            type="button"
            class={styles.toggle}
            aria-pressed={rule.enabled}
            aria-label={`Regra ${number} ${rule.enabled ? 'ativa' : 'desligada'}`}
            onClick={() => props.onChange({ ...rule, enabled: !rule.enabled })}
          >
            {rule.enabled ? 'ativa' : 'desligada'}
          </button>
          <button
            type="button"
            class={styles.remove}
            aria-label={`Remover a regra ${number}`}
            onClick={props.onRemove}
          >
            ×
          </button>
        </div>
      </div>

      <span class={styles.elseTag} aria-hidden="true">
        {KEYWORD.ELSE}
      </span>
    </li>
  );
}
