/**
 * Session for the Mage Craft shell.
 *
 * Every session is a real account on the accounts/ranking API (`api/`, see
 * docs/accounts-ranking-dashboard.md): there is no local-only mode any more.
 * The guest path used to hand out an id with no token, which meant half the
 * shell — dashboard stats, match history, the ranking — silently did nothing
 * for whoever took it, and a nick nobody owned went out on the wire into real
 * matches. `token` is therefore not optional: if it is missing, there is no
 * session.
 */

import { ApiClient, ApiError, type MeResponse } from '../net/ApiClient';

export interface UserProfile {
  id: string;
  name: string;
  /** Epoch ms when the account was created. */
  createdAt: number;
  /** Local duel wins recorded through the shell (synced from Settings when available). */
  wins: number;
  losses: number;
  /** Most-played element id (stat display on dashboard; not a loadout picker). */
  favoriteElement: string;
  /** Optional bio shown on the dashboard. */
  title: string;
  /** JWT for the accounts API. Every session has one. */
  token: string;
  email: string;
}

const SESSION_KEY = 'mage-craft.session.v1';

/** Mirrors the API's own rules (api/src/routes/auth.ts) so the form can say no first. */
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;

export function getSession(): UserProfile | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    // A session stored before accounts were mandatory has no token. It cannot
    // reach anything any more, so it is not a session — drop it and ask for a
    // real sign-in rather than booting into a half-dead shell.
    if (typeof parsed.token !== 'string' || !parsed.token) return null;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
    return parsed as UserProfile;
  } catch {
    return null;
  }
}

export function setSession(profile: UserProfile): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Re-throws API errors with copy that fits the login form. */
function describeAuthError(err: unknown): Error {
  if (err instanceof ApiError) return new Error(err.message);
  return err instanceof Error ? err : new Error('Could not reach the account server.');
}

function profileFrom(
  user: { id: string; username: string },
  token: string,
  email: string,
  title: string,
): UserProfile {
  return {
    id: user.id,
    name: user.username,
    createdAt: Date.now(),
    wins: 0,
    losses: 0,
    favoriteElement: 'fire',
    title,
    token,
    email: email.trim().toLowerCase(),
  };
}

/** Creates a real account on the accounts API (server-backed dashboard/ranking/match log). */
export async function registerAccount(username: string, email: string, password: string): Promise<UserProfile> {
  try {
    const res = await ApiClient.register(username.trim(), email.trim(), password);
    const profile = profileFrom(res.user, res.token, email, 'Apprentice Mage');
    setSession(profile);
    return profile;
  } catch (err) {
    throw describeAuthError(err);
  }
}

/** Signs in to a real account on the accounts API. */
export async function loginAccount(email: string, password: string): Promise<UserProfile> {
  try {
    const res = await ApiClient.login(email.trim(), password);
    const profile = profileFrom(res.user, res.token, email, 'Apprentice Mage');
    setSession(profile);
    return profile;
  } catch (err) {
    throw describeAuthError(err);
  }
}

/**
 * Confirms a stored session is still good, and refreshes the profile from the
 * server while it is at it.
 *
 * Tokens expire (JWT_EXPIRES_IN, 7d by default), and a stale one used to survive
 * in localStorage forever — the shell would boot straight to the home screen and
 * then quietly 401 on every stat it tried to load. Returns the refreshed
 * profile, or null when the token is dead (in which case the session is
 * cleared). A network failure is *not* a dead token: the stored profile is
 * returned as-is so a flaky connection doesn't sign the player out.
 */
export async function restoreSession(): Promise<UserProfile | null> {
  const stored = getSession();
  if (!stored) return null;

  let me: MeResponse;
  try {
    me = await ApiClient.me(stored.token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      return null;
    }
    return stored;
  }

  const refreshed: UserProfile = {
    ...stored,
    id: me.id,
    name: me.username,
    email: me.email,
    createdAt: Date.parse(me.createdAt) || stored.createdAt,
    wins: me.stats.wins,
    losses: me.stats.losses,
    favoriteElement: me.stats.favoriteElement ?? stored.favoriteElement,
  };
  setSession(refreshed);
  return refreshed;
}

export function updateProfile(patch: Partial<UserProfile>): UserProfile {
  const current = getSession();
  if (!current) throw new Error('Not signed in.');
  const next = { ...current, ...patch, id: current.id, name: patch.name?.trim() || current.name };
  setSession(next);
  return next;
}
