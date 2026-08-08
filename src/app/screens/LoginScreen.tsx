import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { loginAccount, loginGuest, registerAccount, type UserProfile } from '../auth';
import styles from '../App.module.css';

export function LoginScreen(props: {
  onBack(): void;
  onSignedIn(profile: UserProfile): void;
}): JSX.Element {
  const [mode, setMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (mode === 'guest') {
        props.onSignedIn(await loginGuest(name));
        return;
      }
      if (mode === 'login') {
        props.onSignedIn(await loginAccount(email, password));
        return;
      }
      props.onSignedIn(await registerAccount(name, email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auth failed');
    }
  };

  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Account</p>
      <h2 class={styles.panelTitle}>Sign in</h2>
      <div class={styles.toolbar}>
        <button type="button" class={mode === 'guest' ? `${styles.btn} ${styles.btnTeal}` : styles.btn} onClick={() => setMode('guest')}>
          Guest
        </button>
        <button type="button" class={mode === 'login' ? `${styles.btn} ${styles.btnTeal}` : styles.btn} onClick={() => setMode('login')}>
          Login
        </button>
        <button type="button" class={mode === 'register' ? `${styles.btn} ${styles.btnTeal}` : styles.btn} onClick={() => setMode('register')}>
          Register
        </button>
      </div>
      <div class={styles.form}>
        {mode !== 'login' ? (
          <label class={styles.field}>
            <span>Display name</span>
            <input class={styles.input} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        ) : null}
        {mode !== 'guest' ? (
          <label class={styles.field}>
            <span>Email</span>
            <input
              class={styles.input}
              type="email"
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
        ) : null}
        {mode !== 'guest' ? (
          <label class={styles.field}>
            <span>Password</span>
            <input
              class={styles.input}
              type="password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
        ) : null}
        {error ? <p class={styles.panelHint}>{error}</p> : null}
        <button type="button" class={`${styles.btn} ${styles.btnBlock} ${styles.btnTeal}`} onClick={() => void submit()}>
          Continue
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
