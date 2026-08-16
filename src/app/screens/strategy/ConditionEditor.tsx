import type { JSX } from 'preact';
import { EFFECT_ORDER, type EffectKind } from '../../../../sim/effects';
import type { Posture } from '../../../../sim/bot/Squad';
import {
  ALL_POSTURES,
  NUMERIC_RANGE,
  STRATEGY_MAX_GROUP,
  type Comparator,
  type Condition,
  type NumericConditionKind,
} from '../../../../sim/strategy';
import {
  ALL_COMPARATORS,
  COMPARATOR_LABEL,
  EFFECT_LABEL,
  FACT_LABEL,
  FACT_ORDER,
  KEYWORD,
  NUMERIC_FIELD,
  POSTURE_LABEL,
  type FactKind,
} from '../../../ui/strategyText';
import styles from './Strategy.module.css';

/**
 * The `SE` half of a rule.
 *
 * The grammar it edits is deliberately flat (`sim/strategy.ts`): a group holds
 * plain conditions and never another group, and `não` modifies one condition
 * rather than opening a level. So this renders at most two deep — a row, or a
 * short column of rows joined by E / OU — and never needs a tree widget. That
 * ceiling is what keeps a rule readable at a glance, which is the entire point
 * of drawing the program as a list in the first place.
 *
 * There is one way to say each thing. `morte súbita` carries no true/false
 * picker, for instance, because the `não` pill already says the negative and
 * offering both would let two different programs mean the same.
 */

const isNumeric = (kind: string): kind is NumericConditionKind =>
  Object.prototype.hasOwnProperty.call(NUMERIC_FIELD, kind);

/** What a freshly picked fact starts as, always inside its own legal range. */
function blankCondition(kind: FactKind): Condition {
  switch (kind) {
    case 'always':
      return { kind: 'always' };
    case 'intruder':
      return { kind: 'intruder' };
    case 'sudden_death':
      return { kind: 'sudden_death', value: true };
    case 'posture':
      return { kind: 'posture', value: 'push' };
    case 'ally_has_effect':
    case 'enemy_has_effect':
      return { kind, effect: 'slow' };
    default:
      return { kind, op: 'gte', value: NUMERIC_FIELD[kind].start };
  }
}

/** A condition and whether it is worn inside a `not`. */
function unwrap(c: Condition): { negated: boolean; inner: Condition } {
  return c.kind === 'not' ? { negated: true, inner: c.of } : { negated: false, inner: c };
}

const rewrap = (negated: boolean, inner: Condition): Condition => (negated ? { kind: 'not', of: inner } : inner);

const isGroup = (c: Condition): c is { kind: 'all' | 'any'; of: readonly Condition[] } =>
  c.kind === 'all' || c.kind === 'any';

export function ConditionEditor(props: {
  value: Condition;
  ruleNumber: number;
  onChange(next: Condition): void;
}): JSX.Element {
  const { value, onChange } = props;

  if (isGroup(value)) {
    const children = value.of;

    const replaceAt = (index: number, next: Condition): void => {
      onChange({ ...value, of: children.map((c, i) => (i === index ? next : c)) });
    };

    const removeAt = (index: number): void => {
      const kept = children.filter((_, i) => i !== index);
      // A group of one is just that condition. Collapsing rather than leaving an
      // E with nothing to join keeps the row honest about what it asks.
      onChange(kept.length === 1 ? kept[0] : { ...value, of: kept });
    };

    return (
      <div class={styles.group}>
        {children.map((child, index) => (
          // Conditions inside a group are positional and carry no identity of
          // their own, so the index is genuinely what distinguishes them.
          <div class={styles.groupRow} key={index}>
            {/* The joiner is a control on the second row and an echo below it:
                one place to change how the group reads, and a reminder on every
                row after, so a four-condition rule never needs counting out. */}
            <div class={styles.joinerCell}>
              {index === 1 ? (
                <select
                  class={styles.joinerPick}
                  value={value.kind}
                  aria-label={`Como as condições da regra ${props.ruleNumber} se combinam`}
                  onChange={(ev) => onChange({ ...value, kind: ev.currentTarget.value as 'all' | 'any' })}
                >
                  <option value="all">{KEYWORD.ALL}</option>
                  <option value="any">{KEYWORD.ANY}</option>
                </select>
              ) : index > 1 ? (
                <span class={styles.joiner} aria-hidden="true">
                  {value.kind === 'all' ? KEYWORD.ALL : KEYWORD.ANY}
                </span>
              ) : null}
            </div>
            <ConditionLeaf
              value={child}
              ruleNumber={props.ruleNumber}
              onChange={(next) => replaceAt(index, next)}
            />
            <button
              type="button"
              class={styles.remove}
              aria-label={`Remover a condição ${index + 1} da regra ${props.ruleNumber}`}
              onClick={() => removeAt(index)}
            >
              ×
            </button>
          </div>
        ))}
        {children.length < STRATEGY_MAX_GROUP ? (
          <div class={styles.groupRow}>
            <div class={styles.joinerCell} />
            <button
              type="button"
              class={styles.addCond}
              onClick={() => onChange({ ...value, of: [...children, blankCondition('mana')] })}
            >
              + condição
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // The one-condition case gets the same "+ condição" footer a group has,
  // rather than an inline button on the end of the row. A numeric condition is
  // already five controls wide and the button was the one that wrapped — and
  // the two states now look alike, which is what makes growing a rule into a
  // group an obvious thing you can do rather than something to discover.
  return (
    <div class={styles.condStack}>
      <ConditionLeaf value={value} ruleNumber={props.ruleNumber} onChange={onChange} />
      <button
        type="button"
        class={styles.addCond}
        aria-label={`Somar uma condição à regra ${props.ruleNumber}`}
        onClick={() => onChange({ kind: 'all', of: [value, blankCondition('mana')] })}
      >
        + condição
      </button>
    </div>
  );
}

/** One `[não] <fato> [comparador] [valor]` row. Never a group. */
function ConditionLeaf(props: {
  value: Condition;
  ruleNumber: number;
  onChange(next: Condition): void;
}): JSX.Element {
  const { negated, inner } = unwrap(props.value);
  const kind = inner.kind as FactKind;
  const emit = (next: Condition): void => props.onChange(rewrap(negated, next));

  return (
    <div class={styles.row}>
      <button
        type="button"
        class={styles.mod}
        aria-pressed={negated}
        aria-label={`Inverter esta condição da regra ${props.ruleNumber}`}
        onClick={() => props.onChange(rewrap(!negated, inner))}
      >
        {KEYWORD.NOT}
      </button>

      <select
        class={`${styles.pick} ${styles.factPick}`}
        value={kind}
        aria-label={`Condição da regra ${props.ruleNumber}`}
        onChange={(ev) => emit(blankCondition(ev.currentTarget.value as FactKind))}
      >
        {FACT_ORDER.map((fact) => (
          <option key={fact} value={fact}>
            {FACT_LABEL[fact]}
          </option>
        ))}
      </select>

      {inner.kind === 'posture' ? (
        <select
          class={styles.pick}
          value={inner.value}
          aria-label={`Postura na regra ${props.ruleNumber}`}
          onChange={(ev) => emit({ kind: 'posture', value: ev.currentTarget.value as Posture })}
        >
          {ALL_POSTURES.map((posture) => (
            <option key={posture} value={posture}>
              {POSTURE_LABEL[posture]}
            </option>
          ))}
        </select>
      ) : null}

      {inner.kind === 'ally_has_effect' || inner.kind === 'enemy_has_effect' ? (
        <select
          class={styles.pick}
          value={inner.effect}
          aria-label={`Efeito na regra ${props.ruleNumber}`}
          onChange={(ev) => emit({ kind: inner.kind, effect: ev.currentTarget.value as EffectKind })}
        >
          {EFFECT_ORDER.map((effect) => (
            <option key={effect} value={effect}>
              {EFFECT_LABEL[effect]}
            </option>
          ))}
        </select>
      ) : null}

      {isNumeric(kind) && 'op' in inner ? (
        <NumericFact
          kind={kind}
          op={inner.op}
          value={inner.value}
          ruleNumber={props.ruleNumber}
          onChange={(op, value) => emit({ kind, op, value })}
        />
      ) : null}
    </div>
  );
}

/**
 * The comparator and the number.
 *
 * Committed on `change` rather than on `input`, so the value settles when the
 * field is left instead of after each keystroke. Clamping mid-word is what
 * makes a percentage field impossible to type into: the "6" of "60" would land
 * as 6% and push the caret past a value the player never meant.
 */
function NumericFact(props: {
  kind: NumericConditionKind;
  op: Comparator;
  value: number;
  ruleNumber: number;
  onChange(op: Comparator, value: number): void;
}): JSX.Element {
  const field = NUMERIC_FIELD[props.kind];
  const [min, max] = NUMERIC_RANGE[props.kind];

  const commit = (raw: string): void => {
    const shown = Number(raw);
    if (!Number.isFinite(shown)) return;
    const stored = Math.min(max, Math.max(min, shown / field.scale));
    props.onChange(props.op, stored);
  };

  return (
    <>
      <select
        class={styles.pick}
        value={props.op}
        aria-label={`Comparação da regra ${props.ruleNumber}`}
        onChange={(ev) => props.onChange(ev.currentTarget.value as Comparator, props.value)}
      >
        {ALL_COMPARATORS.map((op) => (
          <option key={op} value={op}>
            {COMPARATOR_LABEL[op]}
          </option>
        ))}
      </select>
      <input
        class={styles.num}
        type="number"
        inputMode="decimal"
        min={min * field.scale}
        max={max * field.scale}
        step={field.step}
        value={Math.round(props.value * field.scale)}
        aria-label={`Valor da regra ${props.ruleNumber}${field.unit ? ` em ${field.unit}` : ''}`}
        onChange={(ev) => commit(ev.currentTarget.value)}
      />
      {field.unit ? <span class={styles.unit}>{field.unit}</span> : null}
    </>
  );
}
