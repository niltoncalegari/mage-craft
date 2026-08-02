/**
 * Local session for the Mage Craft shell. Real accounts / server auth come later;
 * this persists a display name + simple pass hash so login/dashboard feel real.
 */

export interface UserProfile {
  id: string;
  name: string;
  /** Epoch ms when the account / guest session was created. */
  createdAt: number;
  /** Local duel wins recorded through the shell (synced from Settings when available). */
  wins: number;
  losses: number;
  /** Most-played element id (stat display on dashboard; not a loadout picker). */
  favoriteElement: string;
  /** Optional bio shown on the dashboard. */
  title: string;
}

interface StoredAccount {
  name: string;
  /** SHA-256 hex of password; empty string means guest (no password). */
  passHash: string;
  profile: UserProfile;
}

const ACCOUNTS_KEY = 'mage-craft.accounts.v1';
const SESSION_KEY = 'mage-craft.session.v1';

function loadAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function hashPass(password: string): Promise<string> {
  if (!password) return '';
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

export async function registerAccount(name: string, password: string): Promise<UserProfile> {
  const trimmed = name.trim().slice(0, 20);
  if (trimmed.length < 2) throw new Error('Choose a name with at least 2 characters.');
  if (password.length < 4) throw new Error('Password needs at least 4 characters.');

  const accounts = loadAccounts();
  if (accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('That name is already taken on this device.');
  }

  const profile: UserProfile = {
    id: makeId(),
    name: trimmed,
    createdAt: Date.now(),
    wins: 0,
    losses: 0,
    favoriteElement: 'fire',
    title: 'Apprentice Mage',
  };
  accounts.push({ name: trimmed, passHash: await hashPass(password), profile });
  saveAccounts(accounts);
  setSession(profile);
  return profile;
}

export async function loginAccount(name: string, password: string): Promise<UserProfile> {
  const trimmed = name.trim();
  const accounts = loadAccounts();
  const found = accounts.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  if (!found) throw new Error('No account with that name on this device.');
  const hash = await hashPass(password);
  if (found.passHash !== hash) throw new Error('Wrong password.');
  setSession(found.profile);
  return found.profile;
}

export function updateProfile(patch: Partial<UserProfile>): UserProfile {
  const current = getSession();
  if (!current) throw new Error('Not signed in.');
  const next = { ...current, ...patch, id: current.id, name: patch.name?.trim() || current.name };
  setSession(next);

  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.profile.id === current.id);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], name: next.name, profile: next };
    saveAccounts(accounts);
  }
  return next;
}
