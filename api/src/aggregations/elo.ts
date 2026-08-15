/** Standard logistic Elo (see docs/accounts-ranking-dashboard.md for the rating pipeline). */
const DEFAULT_K = 32;
const RATING_FLOOR = 100;

/** Expected score (0..1) for a player rated `rating` against `opponentRating`. */
function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Signed rating change for the caller — add it to their current rating and floor the result. */
export function computeEloDelta(rating: number, opponentRating: number, won: boolean, k = DEFAULT_K): number {
  const actual = won ? 1 : 0;
  return Math.round(k * (actual - expectedScore(rating, opponentRating)));
}

export function applyEloDelta(rating: number, delta: number): number {
  return Math.max(RATING_FLOOR, rating + delta);
}
