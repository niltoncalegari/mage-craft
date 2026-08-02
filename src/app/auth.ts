/**
 * Session for the Mage Craft shell. Guests stay fully local/offline (no
 * server call). Named accounts are real accounts on the accounts/ranking API
 * (`api/`, see docs/accounts-ranking-dashboard.md) — `token` is set once
 * signed in and unlocks server-backed dashboard stats, match history and the
 * global ranking.
 */

import { ApiClient, ApiError } from '../net/ApiClient';

export interface UserProfile {
  id: string;
  name: string;
  /** Epoch ms when the account / guest session was created. */
  createdAt: number;
  /** Local duel wins recorded through the shell (synced from Settings when available). */
  wins: number;
  losses: number;
  /** Favorite element id for display. */
  favoriteElement: string;
  /** Optional bio shown on the dashboard. */
  title: string;
  /** JWT for the accounts API; absent for guest sessions (offline-only). */
  token?: string;
  email?: string;
}

const SESSION_KEY = 'mage-craft.session.v1';

function makeId(): string {
  return `mage-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSession(): UserProfile | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
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

export async function loginGuest(name: string): Promise<UserProfile> {
  const trimmed = name.trim().slice(0, 20) || 'Acolyte';
  const profile: UserProfile = {
    id: makeId(),
    name: trimmed,
    createdAt: Date.now(),
    wins: 0,
    losses: 0,
    favoriteElement: 'fire',
    title: 'Wandering Acolyte',
  };
  setSession(profile);
  return profile;
}

/** Re-throws API errors with copy that fits the login form. */
function describeAuthError(err: unknown): Error {
  if (err instanceof ApiError) return new Error(err.message);
  return err instanceof Error ? err : new Error('Could not reach the account server.');
}

/** Creates a real account on the accounts API (server-backed dashboard/ranking/match log). */
export async function registerAccount(username: string, email: string, password: string): Promise<UserProfile> {
  try {
    const res = await ApiClient.register(username.trim(), email.trim(), password);
    const profile: UserProfile = {
      id: res.user.id,
      name: res.user.username,
      createdAt: Date.now(),
      wins: 0,
      losses: 0,
      favoriteElement: 'fire',
      title: 'Apprentice Mage',
      token: res.token,
      email: email.trim(),
    };
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
    const profile: UserProfile = {
      id: res.user.id,
      name: res.user.username,
      createdAt: Date.now(),
      wins: 0,
      losses: 0,
      favoriteElement: 'fire',
      title: 'Apprentice Mage',
      token: res.token,
      email: email.trim(),
    };
    setSession(profile);
    return profile;
  } catch (err) {
    throw describeAuthError(err);
  }
}

export function updateProfile(patch: Partial<UserProfile>): UserProfile {
  const current = getSession();
  if (!current) throw new Error('Not signed in.');
  const next = { ...current, ...patch, id: current.id, name: patch.name?.trim() || current.name };
  setSession(next);
  return next;
}
