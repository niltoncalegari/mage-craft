import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  EMAIL_RE,
  loginAccount,
  PASSWORD_MIN,
  registerAccount,
  USERNAME_RE,
  type UserProfile,
} from '../auth';
import styles from '../App.module.css';

type Mode = 'login' | 'register';

/**
 * The only way in. Guest sign-in is gone (see ../auth), so this screen is the
 * shell's front door rather than an optional upgrade path.
 *
 * The rules below duplicate the API's (api/src/routes/auth.ts) on purpose: the
 * server is still the authority and its 400s are surfaced verbatim, but a
 * player who typed a 6-character password should be told so before a round
 * trip, and "username must be 3-20 alphanumeric/underscore characters" arriving
 * after the fact reads like a bug.
 */
function validate(mode: Mode, fields: { name: string; email: string; password: string }): string | null {
  if (!EMAIL_RE.test(fields.email.trim())) return 'Enter a valid email address.';
  if (mode === 'register') {
    if (!USERNAME_RE.test(fields.name.trim())) {
      return 'Nick must be 3–20 characters, letters, numbers or underscore.';
    }
    if (fields.password.length < PASSWORD_MIN) {
      return `Password must be at least ${PASSWORD_MIN} characters.`;
    }
  } else if (fields.password.length === 0) {
    return 'Enter your password.';
  }
  return null;
}

export function LoginScreen(props: {
  onBack(): void;
  onSignedIn(profile: UserProfile): void;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (next: Mode): void => {
    setMode(next);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const complaint = validate(mode, { name, email, password });
    if (complaint) {
      setError(complaint);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      props.onSignedIn(
        mode === 'login' ? await loginAccount(email, password) : await registerAccount(name, email, password),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auth failed');
    } finally {
      setBusy(false);
    }
  };

  // Enter submits from any field — a two-field login form that needs a mouse
  // for the last step is the kind of thing nobody reports and everybody notices.
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Enter') void submit();
  };

  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Account</p>
      <h2 class={styles.panelTitle}>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
      <p class={styles.panelHint}>
        Your nick, squad, match history and ranking spot live on the account — that is what other commanders see when
        they face you.
      </p>
      {/* The same pill switcher the dashboard uses for its tabs: this picks a
          view, it does not submit anything, so it should not look like the
          primary action sitting at the bottom of the form. */}
      <div class={styles.tabs} style={{ marginTop: 16 }}>
        <button
          type="button"
          class={mode === 'login' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => switchTo('login')}
        >
          Login
        </button>
        <button
          type="button"
          class={mode === 'register' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => switchTo('register')}
        >
          Register
        </button>
      </div>
      <div class={styles.form}>
        {mode === 'register' ? (
          <label class={styles.field}>
            <span>Nick</span>
            <input
              class={styles.input}
              value={name}
              maxLength={20}
              autocomplete="username"
              placeholder="3–20 letters, numbers or _"
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </label>
        ) : null}
        <label class={styles.field}>
          <span>Email</span>
          <input
            class={styles.input}
            type="email"
            value={email}
            autocomplete="email"
            onInput={(e) => setEmail(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <label class={styles.field}>
          <span>Password</span>
          <input
            class={styles.input}
            type="password"
            value={password}
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'register' ? `At least ${PASSWORD_MIN} characters` : undefined}
            onInput={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        {error ? <p class={styles.error}>{error}</p> : null}
        <button
          type="button"
          class={`${styles.btn} ${styles.btnBlock} ${styles.btnTeal}`}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
