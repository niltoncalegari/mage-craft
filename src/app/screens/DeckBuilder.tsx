import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { CARD_POOL, DECK_SIZE, HAND_SIZE, validateDeck } from '../../../sim/Deck';
import { spellFor, type CardId } from '../../../sim/spells';
import { loadLoadout, saveDeck } from '../loadout';
import styles from './Builders.module.css';
import appStyles from '../App.module.css';

const BUFF_COLOR = '#3ecfbf';
const CURSE_COLOR = '#c9853e';

/**
 * Choose the eight cards you cycle through. Duplicates are deliberate here (the
 * opposite of a squad): the deck is a rotating queue with no hidden randomness
 * (`sim/Deck.ts`), so doubling a card is how you guarantee it comes back around.
 */
export function DeckBuilder(): JSX.Element {
  const [deck, setDeck] = useState<CardId[]>(() => loadLoadout().deck);
  const [saved, setSaved] = useState(false);

  const validation = validateDeck(deck);
  const countOf = (id: CardId): number => deck.filter((c) => c === id).length;

  const setCount = (id: CardId, next: number): void => {
    const others = deck.filter((c) => c !== id);
    setDeck([...others, ...(Array(next).fill(id) as CardId[])]);
    setSaved(false);
  };

  const save = (): void => {
    if (!validation.ok) return;
    saveDeck(deck);
    setSaved(true);
  };

  const totalCost = deck.reduce((sum, id) => sum + (spellFor(id)?.cost ?? 0), 0);
  const averageCost = deck.length > 0 ? totalCost / deck.length : 0;
  const maxCount = Math.max(...CARD_POOL.map(countOf), 1);

  return (
    <div>
      <p class={appStyles.panelHint}>
        {DECK_SIZE} cards, cycling in order — {HAND_SIZE} in hand and the next one always visible. Duplicates are how you
        make a card come back sooner.
      </p>

      <div class={styles.pool} style={{ marginTop: 14 }}>
        {CARD_POOL.map((id) => {
          const card = spellFor(id);
          if (!card) return null;
          const count = countOf(id);
          const color = card.kind === 'buff' ? BUFF_COLOR : CURSE_COLOR;
          return (
            <div
              key={id}
              class={count > 0 ? `${styles.card} ${styles.cardPicked}` : styles.card}
              style={{ '--element-color': color, cursor: 'default' } as JSX.CSSProperties}
            >
              <div class={styles.cardHead}>
                <h4 class={styles.cardName}>{card.name}</h4>
                <span class={appStyles.badge}>{card.cost} mana</span>
              </div>
              <p class={styles.cardMeta}>
                {card.kind === 'buff' ? 'Buff · your squad' : 'Curse · enemy squad'} · radius {card.radius} · {card.duration}s
              </p>
              <div class={styles.stepper}>
                <button
                  type="button"
                  class={styles.stepBtn}
                  aria-label={`One less ${card.name}`}
                  disabled={count === 0}
                  onClick={() => setCount(id, count - 1)}
                >
                  −
                </button>
                <span class={styles.stepCount}>{count}</span>
                <button
                  type="button"
                  class={styles.stepBtn}
                  aria-label={`One more ${card.name}`}
                  disabled={deck.length >= DECK_SIZE}
                  onClick={() => setCount(id, count + 1)}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p class={appStyles.panelHint} style={{ margin: '18px 0 10px' }}>
        Deck mix — {deck.length}/{DECK_SIZE} cards · {averageCost.toFixed(1)} average mana
      </p>
      <ul class={styles.costCurve}>
        {CARD_POOL.map((id) => {
          const card = spellFor(id);
          if (!card) return null;
          const count = countOf(id);
          return (
            <li class={styles.costRow} key={id}>
              <span class={styles.costLabel}>{card.name}</span>
              <div class={styles.track} aria-hidden="true">
                <div
                  class={styles.fill}
                  style={{
                    width: `${count === 0 ? 0 : Math.max(6, Math.round((count / maxCount) * 100))}%`,
                    background: card.kind === 'buff' ? BUFF_COLOR : CURSE_COLOR,
                  }}
                />
              </div>
              <span class={styles.costValue} aria-label={`${card.name}: ${count} copies at ${card.cost} mana`}>
                ×{count} · {card.cost} mana
              </span>
            </li>
          );
        })}
      </ul>

      <div class={styles.saveBar}>
        {validation.ok ? (
          <span class={saved ? styles.saveState : styles.saveHint}>
            {saved ? 'Deck saved — it ships with your next match.' : 'Legal deck. Save to bring it.'}
          </span>
        ) : (
          <span class={appStyles.error}>{validation.reason}</span>
        )}
        <button
          type="button"
          class={`${appStyles.btn} ${appStyles.btnGhost}`}
          onClick={() => {
            setDeck([]);
            setSaved(false);
          }}
        >
          Clear
        </button>
        <button type="button" class={`${appStyles.btn} ${appStyles.btnTeal}`} disabled={!validation.ok} onClick={save}>
          Save deck
        </button>
      </div>
    </div>
  );
}
