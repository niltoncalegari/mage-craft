/**
 * What the five deck colours (GDD §9) look like on screen.
 *
 * Colour stopped being flavour when it became a deck-building constraint: the
 * builders group by it, and a rule's accent in the strategy editor is the
 * fastest way to see that a program leans on one half of the deck. So the swatch
 * has to be legible at 8px, which is where the two obvious values fail.
 *
 * **Black is violet and white is bone**, on purpose. The app sits on `#141018`;
 * a black swatch is a hole in the panel and a `#fff` one collides with `--ink`
 * and with the glass highlights above it. Reading "black" as void-violet and
 * "white" as parchment keeps all five distinguishable side by side, which is
 * the only job these values have.
 *
 * Shared rather than local to either builder: the deck builder tints a card by
 * its colour and the strategy editor tints the rule that plays it, and those two
 * must agree or the accent stops meaning anything.
 */

import { ALL_DECK_COLORS, spellFor, type DeckColor } from '../../sim/spells';

export const DECK_COLOR_INK: Readonly<Record<DeckColor, string>> = {
  red: '#e2563c',
  blue: '#4fa8d8',
  green: '#6fc38a',
  white: '#e6dcc4',
  black: '#a07ccc',
};

export const DECK_COLOR_LABEL: Readonly<Record<DeckColor, string>> = {
  red: 'Vermelho',
  blue: 'Azul',
  green: 'Verde',
  white: 'Branco',
  black: 'Preto',
};

/** Display order, kept in the catalog's own order so the builders never disagree. */
export const DECK_COLORS = ALL_DECK_COLORS;

/**
 * The accent for one card. Falls back to copper for a card this build has never
 * heard of, which is the same tint an untinted `Builders` card already carries.
 */
export function cardInk(id: string): string {
  const color = spellFor(id)?.color;
  return color ? DECK_COLOR_INK[color] : 'var(--copper)';
}
