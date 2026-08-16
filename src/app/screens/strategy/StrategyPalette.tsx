import type { JSX } from 'preact';
import { spellFor, type CardId } from '../../../../sim/spells';
import { cardInk } from '../../../ui/deckColors';
import styles from './Strategy.module.css';

/**
 * The cards a rule is allowed to name — the deck, not the catalog.
 *
 * `validateStrategy` refuses a rule naming a card the player did not bring, so
 * offering the other eighteen would mean offering a program that cannot be
 * saved. The pool is the deck for the same reason the hand is: you play what
 * you packed.
 *
 * Each card is both a drag source and a button. Dragging places the rule at an
 * index; activating it appends. The click handler fires only for `detail === 0`
 * — the keyboard's synthetic click — because a mouse tap already comes back
 * through the drag gesture as an append, and handling both would add two rules
 * for one press.
 */
export function StrategyPalette(props: {
  cards: readonly CardId[];
  /** True once the program is at its rule ceiling. */
  full: boolean;
  onGrab(card: CardId, ev: PointerEvent): void;
  onAdd(card: CardId): void;
}): JSX.Element {
  return (
    <div>
      <p class={styles.paletteHead}>Your deck</p>
      <div class={styles.palette}>
        {props.cards.map((id) => {
          const card = spellFor(id);
          if (!card) return null;
          return (
            <button
              type="button"
              key={id}
              class={styles.paletteCard}
              style={{ '--element-color': cardInk(id) } as JSX.CSSProperties}
              disabled={props.full}
              onPointerDown={(ev) => props.onGrab(id, ev)}
              onClick={(ev) => {
                if (ev.detail === 0) props.onAdd(id);
              }}
            >
              <span class={styles.paletteName}>{card.name}</span>
              <span class={styles.paletteMeta}>
                {card.cost} mana · {card.kind === 'buff' ? 'Buff' : 'Curse'}
              </span>
            </button>
          );
        })}
      </div>
      <p class={styles.paletteHint}>
        {props.full
          ? 'The program is full. Remove a rule to add another.'
          : 'Drag a card onto the spine to place a rule, or tap one to add it at the end.'}
      </p>
    </div>
  );
}
