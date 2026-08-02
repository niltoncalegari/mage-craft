import { render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SELECTABLE_ELEMENTS, type ElementId } from '../game/elements';
import { PortalScene } from '../render/PortalScene';
import styles from './App.module.css';
import {
  clearSession,
  getSession,
  loginAccount,
  loginGuest,
  registerAccount,
  updateProfile,
  type UserProfile,
} from './auth';
import {
  addBotToRoom,
  createLocalRoom,
  joinLocalRoom,
  listRooms,
  removeBot,
  setSlotElement,
  setSlotTeam,
  toggleReady,
  type RoomDetail,
  type RoomSummary,
} from './roomStore';

export type AppScreen =
  | 'title'
  | 'login'
  | 'dashboard'
  | 'rooms'
  | 'createRoom'
  | 'lobby';

export interface AppActions {
  /** Enter the existing offline duel flow (loads the arena game). */
  startPractice(): void;
}

interface AppProps {
  actions: AppActions;
  /** Wins/losses from Settings to show on the dashboard. */
  stats?: { wins: number; losses: number };
  selectedElement: ElementId;
  onSelectElement(element: ElementId): void;
}

export function mountApp(container: HTMLElement, props: AppProps): { dispose(): void } {
  const host = document.createElement('div');
  host.className = styles.shell;
  container.append(host);

  const rerender = (next: AppProps): void => {
    render(<AppShell {...next} />, host);
  };
  rerender(props);

  return {
    dispose: () => {
      render(null, host);
      host.remove();
    },
  };
}

function AppShell(props: AppProps): JSX.Element {
  const portalRef = useRef<HTMLDivElement>(null);
  const portal = useRef<PortalScene | null>(null);
  const [screen, setScreen] = useState<AppScreen>(() => (getSession() ? 'dashboard' : 'title'));
  const [user, setUser] = useState<UserProfile | null>(() => getSession());
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>(() => listRooms());
  // `props.selectedElement` only reflects the value at mount time (mountApp never
  // re-renders on its own), so the picker needs its own state to update live.
  const [selectedElement, setSelectedElement] = useState<ElementId>(props.selectedElement);

  const chooseElement = (element: ElementId): void => {
    setSelectedElement(element);
    props.onSelectElement(element);
  };

  useEffect(() => {
    if (!portalRef.current) return;
    portal.current = new PortalScene(portalRef.current);
    return () => {
      portal.current?.dispose();
      portal.current = null;
    };
  }, []);

  const signIn = (profile: UserProfile): void => {
    setUser(profile);
    setScreen('dashboard');
  };

  const signOut = (): void => {
    clearSession();
    setUser(null);
    setRoom(null);
    setScreen('title');
  };

  const openLobby = (next: RoomDetail): void => {
    setRoom(next);
    setRooms(listRooms());
    setScreen('lobby');
  };

  return (
    <>
      <div class={styles.portalHost} ref={portalRef} />
      <div class={styles.vignette} />
      <div class={styles.layer}>
        {screen === 'title' ? (
          <TitleScreen
            onEnter={() => setScreen(user ? 'dashboard' : 'login')}
            onPractice={() => props.actions.startPractice()}
          />
        ) : null}
        {screen === 'login' ? (
          <LoginScreen onBack={() => setScreen('title')} onSignedIn={signIn} />
        ) : null}
        {screen === 'dashboard' && user ? (
          <DashboardScreen
            user={user}
            stats={props.stats}
            selectedElement={selectedElement}
            onSelectElement={(el) => {
              chooseElement(el);
              updateProfile({ favoriteElement: el });
              setUser(getSession());
            }}
            onPractice={() => props.actions.startPractice()}
            onBrowseRooms={() => {
              setRooms(listRooms());
              setScreen('rooms');
            }}
            onCreateRoom={() => setScreen('createRoom')}
            onSignOut={signOut}
          />
        ) : null}
        {screen === 'rooms' && user ? (
          <RoomBrowserScreen
            rooms={rooms}
            playerName={user.name}
            element={selectedElement}
            onBack={() => setScreen('dashboard')}
            onCreate={() => setScreen('createRoom')}
            onJoin={(id) => openLobby(joinLocalRoom(id, user.name, selectedElement))}
            onRefresh={() => setRooms(listRooms())}
          />
        ) : null}
        {screen === 'createRoom' && user ? (
          <CreateRoomScreen
            hostName={user.name}
            element={selectedElement}
            onBack={() => setScreen('dashboard')}
            onCreated={openLobby}
          />
        ) : null}
        {screen === 'lobby' && user && room ? (
          <RoomLobbyScreen
            room={room}
            onChange={setRoom}
            onLeave={() => {
              setRoom(null);
              setScreen('rooms');
            }}
            onStartPractice={() => props.actions.startPractice()}
          />
        ) : null}
      </div>
    </>
  );
}

function TitleScreen(props: { onEnter(): void; onPractice(): void }): JSX.Element {
  return (
    <div class={styles.titleScreen}>
      <p class={styles.tag}>Enter the arena</p>
      <h1 class={styles.brand}>Mage Craft</h1>
      <p class={styles.sub}>
        Charge your conjuration. Cross the portal. Short elemental duels — online halls or solo practice.
      </p>
      <div class={styles.titleActions}>
        <button type="button" class={`${styles.btn} ${styles.btnTeal}`} onClick={props.onEnter}>
          Enter Hall
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onPractice}>
          Quick Practice
        </button>
      </div>
    </div>
  );
}

function LoginScreen(props: {
  onBack(): void;
  onSignedIn(profile: UserProfile): void;
}): JSX.Element {
  const [mode, setMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [name, setName] = useState('Acolyte');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'guest') props.onSignedIn(await loginGuest(name));
      else if (mode === 'login') props.onSignedIn(await loginAccount(name, password));
      else props.onSignedIn(await registerAccount(name, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Sign in</p>
      <h2 class={styles.panelTitle}>Choose your mage</h2>
      <p class={styles.panelHint}>Local account on this device — server accounts come later.</p>

      <div class={styles.tabs}>
        {(
          [
            ['guest', 'Guest'],
            ['login', 'Login'],
            ['register', 'Create'],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            class={mode === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div class={styles.form}>
        <label class={styles.field}>
          <span>Mage name</span>
          <input class={styles.input} value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
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
        {error ? <p class={styles.error}>{error}</p> : null}
        <button type="button" class={`${styles.btn} ${styles.btnBlock}`} disabled={busy} onClick={() => void submit()}>
          {mode === 'register' ? 'Create & enter' : 'Continue'}
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function DashboardScreen(props: {
  user: UserProfile;
  stats?: { wins: number; losses: number };
  selectedElement: ElementId;
  onSelectElement(element: ElementId): void;
  onPractice(): void;
  onBrowseRooms(): void;
  onCreateRoom(): void;
  onSignOut(): void;
}): JSX.Element {
  const wins = props.stats?.wins ?? props.user.wins;
  const losses = props.stats?.losses ?? props.user.losses;
  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Dashboard</p>
          <h2 class={styles.panelTitle}>Hall of the Acolyte</h2>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onSignOut}>
          Sign out
        </button>
      </div>

      <div class={styles.dashGrid}>
        <div class={styles.profileCard}>
          <h3 class={styles.profileName}>{props.user.name}</h3>
          <p class={styles.profileTitle}>{props.user.title}</p>
          <div class={styles.statRow}>
            <div class={styles.stat}>
              <b>{wins}</b>
              <span>Wins</span>
            </div>
            <div class={styles.stat}>
              <b>{losses}</b>
              <span>Losses</span>
            </div>
          </div>
          <p class={styles.panelHint} style={{ marginTop: 14 }}>
            Favorite element
          </p>
          <div class={styles.elementChips}>
            {SELECTABLE_ELEMENTS.map((el) => (
              <button
                type="button"
                key={el.id}
                class={
                  props.selectedElement === el.id ? `${styles.chip} ${styles.chipActive}` : styles.chip
                }
                onClick={() => props.onSelectElement(el.id)}
              >
                {el.name}
              </button>
            ))}
          </div>
        </div>

        <div class={styles.actionGrid}>
          <button type="button" class={styles.actionCard} onClick={props.onBrowseRooms}>
            <h3>Browse halls</h3>
            <p>List open rooms, join by code, or enter a practice hall.</p>
          </button>
          <button type="button" class={styles.actionCard} onClick={props.onCreateRoom}>
            <h3>Create room</h3>
            <p>Host a 1x1–6x6 duel and configure teams before the match.</p>
          </button>
          <button type="button" class={styles.actionCard} onClick={props.onPractice}>
            <h3>Solo practice</h3>
            <p>Jump into the offline arena against AI — same combat loop.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

function RoomBrowserScreen(props: {
  rooms: RoomSummary[];
  playerName: string;
  element: ElementId;
  onBack(): void;
  onCreate(): void;
  onJoin(roomId: string): void;
  onRefresh(): void;
}): JSX.Element {
  const [code, setCode] = useState('');
  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Online</p>
          <h2 class={styles.panelTitle}>Open halls</h2>
          <p class={styles.panelHint}>Demo halls are local. Join a real code when the Go server is running.</p>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onBack}>
          Dashboard
        </button>
      </div>

      <div class={styles.toolbar}>
        <input
          class={styles.input}
          placeholder="Room code"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
        />
        <button
          type="button"
          class={styles.btn}
          onClick={() => props.onJoin(code.trim())}
          disabled={code.trim().length < 3}
        >
          Join code
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnTeal}`} onClick={props.onCreate}>
          Create room
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      <div class={styles.roomList}>
        {props.rooms.map((room) => (
          <button type="button" class={styles.roomRow} key={room.roomId} onClick={() => props.onJoin(room.roomId)}>
            <div>
              <p class={styles.roomName}>{room.name}</p>
              <p class={styles.roomMeta}>
                {room.teamSize}v{room.teamSize} · host {room.hostName} · {room.roomId}
              </p>
            </div>
            <span class={room.isDemo ? styles.badge : `${styles.badge} ${styles.badgeTeal}`}>
              {room.isDemo ? 'Demo' : 'Recent'}
            </span>
            <span class={styles.badge}>
              {room.filled}/{room.capacity}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateRoomScreen(props: {
  hostName: string;
  element: ElementId;
  onBack(): void;
  onCreated(room: RoomDetail): void;
}): JSX.Element {
  const [name, setName] = useState(`${props.hostName}'s Hall`);
  const [teamSize, setTeamSize] = useState(1);
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Host</p>
      <h2 class={styles.panelTitle}>Create room</h2>
      <p class={styles.panelHint}>Team size sets capacity (2 × size), from 1v1 up to 6v6.</p>
      <div class={styles.form}>
        <label class={styles.field}>
          <span>Room name</span>
          <input class={styles.input} value={name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class={styles.field}>
          <span>Team size</span>
          <select class={styles.select} value={String(teamSize)} onChange={(e) => setTeamSize(Number(e.currentTarget.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option value={n}>
                {n}v{n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class={`${styles.btn} ${styles.btnBlock}`}
          onClick={() =>
            props.onCreated(
              createLocalRoom({
                name,
                teamSize,
                hostName: props.hostName,
                element: props.element,
              }),
            )
          }
        >
          Open lobby
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost} ${styles.btnBlock}`} onClick={props.onBack}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RoomLobbyScreen(props: {
  room: RoomDetail;
  onChange(room: RoomDetail): void;
  onLeave(): void;
  onStartPractice(): void;
}): JSX.Element {
  const { room } = props;
  const you = room.slots.find((s) => s.isYou);
  const team0 = room.slots.filter((s) => s.team === 0);
  const team1 = room.slots.filter((s) => s.team === 1);
  const filled = room.slots.every((s) => s.name);
  const ready = room.slots.every((s) => !s.name || s.ready);

  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Lobby · {room.roomId}</p>
          <h2 class={styles.panelTitle}>{room.name}</h2>
          <p class={styles.panelHint}>
            {room.teamSize}v{room.teamSize} · host {room.hostName}
            {room.isHost ? ' (you)' : ''}
          </p>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onLeave}>
          Leave
        </button>
      </div>

      <p class={styles.panelHint}>Your element</p>
      <div class={styles.elementChips}>
        {SELECTABLE_ELEMENTS.map((el) => (
          <button
            type="button"
            key={el.id}
            class={you?.element === el.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => props.onChange(setSlotElement(room, el.id))}
          >
            {el.name}
          </button>
        ))}
      </div>

      <div class={styles.toolbar}>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onChange(setSlotTeam(room, 0))}>
          Join team A
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onChange(setSlotTeam(room, 1))}>
          Join team B
        </button>
        {room.isHost ? (
          <>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => props.onChange(addBotToRoom(room, 0, 'normal'))}
            >
              Bot → A
            </button>
            <button
              type="button"
              class={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => props.onChange(addBotToRoom(room, 1, 'normal'))}
            >
              Bot → B
            </button>
          </>
        ) : null}
      </div>

      <div class={styles.teams}>
        <TeamColumn
          title="Team A"
          slots={team0}
          isHost={room.isHost}
          onRemoveBot={(id) => props.onChange(removeBot(room, id))}
        />
        <TeamColumn
          title="Team B"
          slots={team1}
          isHost={room.isHost}
          onRemoveBot={(id) => props.onChange(removeBot(room, id))}
        />
      </div>

      <div class={styles.footerBar}>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onChange(toggleReady(room))}>
          {you?.ready ? 'Unready' : 'Ready'}
        </button>
        {room.isHost ? (
          <button
            type="button"
            class={`${styles.btn} ${styles.btnTeal}`}
            disabled={!filled || !ready}
            title={!filled ? 'Fill every slot (humans or bots)' : !ready ? 'Everyone must ready up' : 'Start'}
            onClick={props.onStartPractice}
          >
            Start duel
          </button>
        ) : (
          <p class={styles.panelHint}>Waiting for host to start…</p>
        )}
      </div>
      <p class={styles.panelHint} style={{ marginTop: 10 }}>
        Online match sync with the Go server lands next — Start opens solo practice with your lobby setup for now.
      </p>
    </div>
  );
}

function TeamColumn(props: {
  title: string;
  slots: RoomDetail['slots'];
  isHost: boolean;
  onRemoveBot(slotId: string): void;
}): JSX.Element {
  return (
    <div class={styles.teamCol}>
      <h3>{props.title}</h3>
      {props.slots.map((slot) => (
        <div class={slot.isYou ? `${styles.slot} ${styles.slotYou}` : styles.slot} key={slot.slotId}>
          {slot.name ? (
            <div>
              <p class={styles.roomName}>
                {slot.name}
                {slot.isYou ? ' · you' : ''}
                {slot.ready ? ' ✓' : ''}
              </p>
              <p class={styles.roomMeta}>{slot.element || 'no element'}{slot.isBot ? ' · bot' : ''}</p>
            </div>
          ) : (
            <span class={styles.slotEmpty}>Empty slot</span>
          )}
          {props.isHost && slot.isBot ? (
            <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onRemoveBot(slot.slotId)}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
