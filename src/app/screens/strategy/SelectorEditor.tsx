import type { JSX } from 'preact';
import { ALL_TARGET_SELECTORS, type TargetSelector } from '../../../../sim/strategy';
import { SELECTOR_LABEL } from '../../../ui/strategyText';
import styles from './Strategy.module.css';

/**
 * Where the rule aims.
 *
 * Every selector is offered, including the ones that read oddly for a given
 * card — a blessing aimed at the enemy cluster is legal, lands on nobody
 * friendly, and is the player's call. The evaluator already refuses to retarget
 * a selector that resolves to nothing, so the failure mode of a strange choice
 * is "the rule does not fire", which is visible and undoable.
 *
 * The labels come from `strategyText.ts` rather than from here, because the
 * match HUD names the same selector when the rule fires and the two have to be
 * the same word.
 */
export function SelectorEditor(props: {
  value: TargetSelector;
  ruleNumber: number;
  onChange(next: TargetSelector): void;
}): JSX.Element {
  return (
    <select
      class={styles.pick}
      value={props.value}
      aria-label={`Alvo da regra ${props.ruleNumber}`}
      onChange={(ev) => props.onChange(ev.currentTarget.value as TargetSelector)}
    >
      {ALL_TARGET_SELECTORS.map((at) => (
        <option key={at} value={at}>
          {SELECTOR_LABEL[at]}
        </option>
      ))}
    </select>
  );
}
