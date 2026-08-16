import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { spellFor, type CardId } from '../../../sim/spells';
import {
  defaultStrategy,
  STRATEGY_MAX_RULES,
  validateStrategy,
  type Strategy,
  type StrategyRule,
} from '../../../sim/strategy';
import { loadLoadout, saveStrategy } from '../loadout';
import appStyles from '../App.module.css';
import builderStyles from './Builders.module.css';
import { RuleList } from './strategy/RuleList';
import { StrategyPalette } from './strategy/StrategyPalette';
import styles from './strategy/Strategy.module.css';
import { insertItem, moveItem, useDragList, type DragPayload } from './strategy/useDragList';

/**
 * Write the program that plays your deck.
 *
 * Since the idle pivot this is the primary verb of the whole game (GDD §2): the
 * player does not cast during a match, they decide beforehand what casting
 * means. The two tabs next door pick what you bring; this one decides what
 * happens with it.
 *
 * The screen is drawn as a single spine with the rules hanging off it, which is
 * a claim about the language rather than a look: first match wins, top to
 * bottom, every rule falling through to the next. See `Strategy.module.css`.
 */

/**
 * Ids only have to be unique within one program and stable across edits — the
 * match HUD names the rule that fired by id, and a renumbering mid-edit would
 * make the trace point at a different rule than the one that cast.
 *
 * Time plus a counter, rather than a random string, so two cards dropped in the
 * same millisecond still differ. Well inside the validator's 32 characters.
 */
let sequence = 0;
const freshId = (): string => `r${Date.now().toString(36)}${(sequence++).toString(36)}`;

/**
 * What a card becomes the moment it is dropped: a rule that already fires.
 *
 * `sempre` and an aim picked from what the card is (a curse looks for the enemy
 * group, a blessing for its own) mean the drop produces something that runs, so
 * the player edits a working rule instead of clearing errors off a stub.
 */
function ruleFor(card: CardId): StrategyRule {
  return {
    id: freshId(),
    enabled: true,
    card,
    when: { kind: 'always' },
    at: spellFor(card)?.kind === 'curse' ? 'enemy_cluster' : 'ally_cluster',
  };
}

export function StrategyBuilder(props: { onSaved?: () => void } = {}): JSX.Element {
  // Read once on mount. Switching tabs remounts this, so editing the deck next
  // door and coming back re-reads a program already reconciled with it by
  // `saveDeck`.
  const [loadout] = useState(() => loadLoadout());
  const [strategy, setStrategy] = useState<Strategy>(() => loadout.strategy);
  const [saved, setSaved] = useState(false);

  const deck = loadout.deck;
  const cards = useMemo(() => [...new Set(deck)], [deck]);
  const rules = strategy.rules;
  const full = rules.length >= STRATEGY_MAX_RULES;

  const setRules = (next: readonly StrategyRule[]): void => {
    setStrategy((current) => ({ ...current, rules: next }));
    setSaved(false);
  };

  const drag = useDragList((payload: DragPayload, index: number) => {
    if (payload.kind === 'move') {
      setRules(moveItem(rules, payload.index, index));
      return;
    }
    if (rules.length >= STRATEGY_MAX_RULES) return;
    setRules(insertItem(rules, ruleFor(payload.card), index));
  });

  const validation = validateStrategy(strategy, deck);

  const save = (): void => {
    if (!validation.ok) return;
    saveStrategy(strategy);
    setSaved(true);
    props.onSaved?.();
  };

  return (
    <div>
      <p class={appStyles.panelHint}>
        Rules run top to bottom and the first one that can fire wins. A rule that can&apos;t — its card is not in
        hand, the mana is short, its target is not on the field — is skipped, never waited on.
      </p>

      <div class={styles.editor} style={{ marginTop: 14 }}>
        <StrategyPalette
          cards={cards}
          full={full}
          onGrab={(card, ev) => drag.beginDrag({ kind: 'add', card }, ev)}
          onAdd={(card) => {
            if (!full) setRules([...rules, ruleFor(card)]);
          }}
        />

        <div>
          <p class={styles.flowHead}>
            The program <span class={styles.count}>· {rules.length}/{STRATEGY_MAX_RULES} rules</span>
          </p>
          <RuleList rules={rules} cards={cards} drag={drag} onChange={setRules} />
        </div>
      </div>

      <div class={builderStyles.saveBar}>
        {validation.ok ? (
          <span class={saved ? builderStyles.saveState : builderStyles.saveHint}>
            {saved
              ? 'Strategy saved — it plays your next match.'
              : 'Legal program. Save to bring it.'}
          </span>
        ) : (
          <span class={appStyles.error}>{validation.reason}</span>
        )}
        <button
          type="button"
          class={`${appStyles.btn} ${appStyles.btnGhost}`}
          onClick={() => {
            setStrategy(defaultStrategy(deck));
            setSaved(false);
          }}
        >
          Reset to default
        </button>
        <button
          type="button"
          class={`${appStyles.btn} ${appStyles.btnTeal}`}
          disabled={!validation.ok}
          onClick={save}
        >
          Save strategy
        </button>
      </div>
    </div>
  );
}
