/**
 * Thin fetch wrapper for the accounts/ranking/match-log service (`api/`,
 * see docs/accounts-ranking-dashboard.md). The only place in the client that
 * talks to that backend — the offline sim stays untouched.
 */

// Empty default = same-origin relative fetch (`/api/...`), proxied to the
// api/ service by Vite in dev (vite.config.ts) and by Nginx in prod
// (Dockerfile + nginx.conf). Only set VITE_API_URL for a setup where the API
// isn't reachable at the same origin.
const BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface AuthResponse {
  token: string;
  user: { id: string; username: string };
}

export interface UserSummary {
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  kdr: number;
  favoriteElement: string | null;
  rating: number;
  mostPlayedSquad: string[] | null;
}

export interface MeResponse {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  stats: UserSummary;
}

export interface MatchLogEntry {
  _id: string;
  mode: 'sp-vs-ai' | 'pvp';
  won: boolean;
  kills: number;
  deaths: number;
  score: number;
  difficulty: 'easy' | 'normal' | 'hard';
  timeSeconds: number;
  livesSpent: number;
  map: string;
  elements: ElementStat[];
  squad?: string[];
  cards?: CardStat[];
  structuresDestroyed?: number;
  createdAt: string;
}

export interface ElementStat {
  elementId: string;
  casts: number;
  hits: number;
  kills: number;
  damageDealt: number;
}

export interface SquadStat {
  signature: string;
  squad: string[];
  games: number;
  wins: number;
  /** 0..1 */
  winRate: number;
  structuresDestroyed: number;
}

export interface CardStat {
  cardId: string;
  casts: number;
}

export interface RankingEntry {
  userId: string;
  username: string;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  kdr: number;
  rating: number;
}

export interface ReportMatchInput {
  mode: 'sp-vs-ai' | 'pvp';
  won: boolean;
  kills: number;
  deaths: number;
  score: number;
  difficulty: 'easy' | 'normal' | 'hard';
  timeSeconds: number;
  livesSpent: number;
  map: string;
  elements: ElementStat[];
  /** The loadout this match was played with; absent on pre-builder logs. */
  squad?: string[];
  cards?: CardStat[];
  structuresDestroyed?: number;
  /** Opponent's Elo at match time; omitted for bot/practice games, which never move rating. */
  opponentRating?: number;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export const ApiClient = {
  register(username: string, email: string, password: string): Promise<AuthResponse> {
    return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
  },

  login(email: string, password: string): Promise<AuthResponse> {
    return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },

  me(token: string): Promise<MeResponse> {
    return request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  },

  myMatches(token: string, page = 1, limit = 10): Promise<{ page: number; limit: number; matches: MatchLogEntry[] }> {
    return request(`/api/me/matches?page=${page}&limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
  },

  myElementStats(token: string): Promise<{ elements: ElementStat[] }> {
    return request('/api/me/stats/elements', { headers: { Authorization: `Bearer ${token}` } });
  },

  mySquadStats(token: string): Promise<{ squads: SquadStat[] }> {
    return request('/api/me/stats/squads', { headers: { Authorization: `Bearer ${token}` } });
  },

  myCardStats(token: string): Promise<{ cards: CardStat[] }> {
    return request('/api/me/stats/cards', { headers: { Authorization: `Bearer ${token}` } });
  },

  ranking(sort: 'rating' | 'wins' | 'kdr' = 'rating', page = 1, limit = 20): Promise<{ entries: RankingEntry[] }> {
    return request(`/api/ranking?sort=${sort}&page=${page}&limit=${limit}`);
  },

  reportMatch(token: string, input: ReportMatchInput): Promise<{ id: string; rating?: number }> {
    return request('/api/matches', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  },
};
