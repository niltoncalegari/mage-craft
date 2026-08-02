import { render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SELECTABLE_ELEMENTS, type ElementId } from '../game/elements';
import { LobbyBridge } from '../net/lobbyBridge';
import { OnlineMatch } from '../net/OnlineMatch';
import { PortalScene } from '../render/PortalScene';
import styles from './App.module.css';
import {
  clearSession,
  getSession,
  loginAccount,
  loginGuest,
  registerAccount,
  type UserProfile,
} from './auth';
import {
  createLocalRoom,
  joinLocalRoom,
  listLocalRooms,
  rememberRoom,
  roomFromServerState,
  summariesFromServer,
  type RoomDetail,
  type RoomSummary,
} from './roomStore';

export type AppScreen =
  | 'title'
  | 'login'
  | 'dashboard'
  | 'rooms'
  | 'createRoom'
  | 'lobby'
  | 'onlineMatch';

export interface AppActions {
  startPractice(): void;
}

interface AppProps {
  actions: AppActions;
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
  const matchHostRef = useRef<HTMLDivElement>(null);
  const onlineMatchRef = useRef<OnlineMatch | null>(null);
  const bridgeRef = useRef<LobbyBridge | null>(null);
  const metaRef = useRef({ isHost: false, roomName: '', screen: 'title' as AppScreen, spectating: false });

  const [screen, setScreen] = useState<AppScreen>(() => (getSession() ? 'dashboard' : 'title'));
  const [user, setUser] = useState<UserProfile | null>(() => getSession());
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>(() => listLocalRooms());
  const [selectedElement, setSelectedElement] = useState<ElementId>(props.selectedElement);
  const [netError, setNetError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);

  metaRef.current = { isHost, roomName: metaRef.current.roomName, screen, spectating };

  const chooseElement = (element: ElementId): void => {
    setSelectedElement(element);
    props.onSelectElement(element);
  };

  const getBridge = (): LobbyBridge => {
    if (!bridgeRef.current) bridgeRef.current = new LobbyBridge();
    const bridge = bridgeRef.current;
    bridge.setHandlers({
      onRoomState: (msg) => {
        const detail = roomFromServerState(msg, bridge.id, {
          name: metaRef.current.roomName || undefined,
          isHost: metaRef.current.isHost,
        });
        detail.isHost = metaRef.current.isHost;
        setRoom(detail);
        setSpectating(detail.youRole === 'spectator');
        rememberRoom(detail);
        if (msg.state === 'lobby' && metaRef.current.screen === 'onlineMatch') {
          onlineMatchRef.current?.dispose();
          onlineMatchRef.current = null;
          setScreen('lobby');
        }
      },
      onRoomList: (msg) => {
        setRooms(summariesFromServer(msg.rooms));
        setOnline(true);
      },
      onMatchStart: () => setScreen('onlineMatch'),
      onSnapshot: (msg) => onlineMatchRef.current?.applySnapshot(msg),
      onRoundEnd: () => {
        setClaimNotice('Round over — rematch lobby. Claimed bots become your seat.');
        onlineMatchRef.current?.dispose();
        onlineMatchRef.current = null;
        setScreen('lobby');
      },
      onError: (msg) => setNetError(msg.message),
      onClose: () => setOnline(false),
    });
    return bridge;
  };

  useEffect(() => {
    if (!portalRef.current) return;
    const portal = new PortalScene(portalRef.current);
    return () => portal.dispose();
  }, []);

  useEffect(() => {
    if (screen !== 'onlineMatch' || !matchHostRef.current || !bridgeRef.current) return;
    onlineMatchRef.current?.dispose();
    onlineMatchRef.current = new OnlineMatch(matchHostRef.current, bridgeRef.current.net, {
      spectating: metaRef.current.spectating,
      localPlayerId: bridgeRef.current.id,
    });
    return () => {
      onlineMatchRef.current?.dispose();
      onlineMatchRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    onlineMatchRef.current?.setSpectating(spectating);
  }, [spectating]);

  const signIn = (profile: UserProfile): void => {
    setUser(profile);
    setScreen('dashboard');
  };

  const signOut = (): void => {
    clearSession();
    bridgeRef.current?.disconnect();
    bridgeRef.current = null;
    setUser(null);
    setRoom(null);
    setScreen('title');
  };

  const refreshRooms = async (): Promise<void> => {
    setNetError(null);
    try {
      const bridge = getBridge();
      await bridge.connect();
      setOnline(true);
      bridge.net.listRooms();
    } catch (err) {
      setNetError(err instanceof Error ? err.message : 'Could not reach server');
      setRooms(listLocalRooms());
      setOnline(false);
    }
  };

  const createOnlineRoom = async (opts: {
    name: string;
    teamSize: number;
    fillBots: boolean;
    botDifficulty: string;
    element: ElementId;
    hostName: string;
  }): Promise<void> => {
    setNetError(null);
    metaRef.current.roomName = opts.name;
    setIsHost(true);
    metaRef.current.isHost = true;
    try {
      const bridge = getBridge();
      await bridge.connect();
      setOnline(true);
      const createdP = bridge.waitForRoomState((m) => m.slots.length === 0 || m.state === 'lobby');
      bridge.net.createRoom(opts.teamSize, opts.fillBots, opts.botDifficulty);
      const created = await createdP;
      const joinedP = bridge.waitForRoomState((m) => m.slots.some((s) => s.playerId === bridge.id));
      bridge.net.joinRoom(created.roomId, opts.hostName);
      bridge.net.selectTeam(0);
      bridge.net.selectElement(opts.element);
      await joinedP;
      setScreen('lobby');
    } catch (err) {
      setNetError(err instanceof Error ? err.message : 'Create failed');
      const local = createLocalRoom({
        name: opts.name,
        teamSize: opts.teamSize,
        hostName: opts.hostName,
        element: opts.element,
        fillBots: opts.fillBots,
      });
      setRoom(local);
      setIsHost(true);
      setScreen('lobby');
    }
  };

  const joinOnlineRoom = async (roomId: string, playerName: string, element: ElementId): Promise<void> => {
    setNetError(null);
    const code = roomId.trim().toUpperCase();
    if (code.startsWith('HALL-')) {
      setRoom(joinLocalRoom(code, playerName, element));
      setIsHost(false);
      setScreen('lobby');
      return;
    }
    setIsHost(false);
    metaRef.current.isHost = false;
    metaRef.current.roomName = `Hall ${code}`;
    try {
      const bridge = getBridge();
      await bridge.connect();
      setOnline(true);
      const joinedP = bridge.waitForRoomState((m) => m.roomId.toUpperCase() === code);
      bridge.net.joinRoom(code, playerName);
      const state = await joinedP;
      if (state.state === 'lobby' && state.youRole !== 'spectator') {
        try {
          bridge.net.selectTeam(1);
          bridge.net.selectElement(element);
        } catch {
          /* team may be full */
        }
      }
      setSpectating(state.youRole === 'spectator' || state.state === 'in_progress');
      setScreen(state.state === 'in_progress' ? 'onlineMatch' : 'lobby');
    } catch (err) {
      setNetError(err instanceof Error ? err.message : 'Join failed');
      setRoom(joinLocalRoom(code, playerName, element));
      setIsHost(false);
      setScreen('lobby');
    }
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
        {screen === 'login' ? <LoginScreen onBack={() => setScreen('title')} onSignedIn={signIn} /> : null}
        {screen === 'dashboard' && user ? (
          <DashboardScreen
            user={user}
            stats={props.stats}
            onPractice={() => props.actions.startPractice()}
            onBrowseRooms={() => {
              void refreshRooms();
              setScreen('rooms');
            }}
            onCreateRoom={() => setScreen('createRoom')}
            onSignOut={signOut}
          />
        ) : null}
        {screen === 'rooms' && user ? (
          <RoomBrowserScreen
            rooms={rooms}
            online={online}
            netError={netError}
            onBack={() => setScreen('dashboard')}
            onCreate={() => setScreen('createRoom')}
            onJoin={(id) => void joinOnlineRoom(id, user.name, selectedElement)}
            onRefresh={() => void refreshRooms()}
          />
        ) : null}
        {screen === 'createRoom' && user ? (
          <CreateRoomScreen
            hostName={user.name}
            netError={netError}
            onBack={() => setScreen('dashboard')}
            onCreated={(opts) =>
              void createOnlineRoom({
                ...opts,
                element: selectedElement,
                hostName: user.name,
              })
            }
          />
        ) : null}
        {screen === 'lobby' && user && room ? (
          <RoomLobbyScreen
            room={room}
            netError={netError}
            claimNotice={claimNotice}
            spectating={spectating || room.youRole === 'spectator'}
            onLeave={() => {
              setRoom(null);
              setClaimNotice(null);
              setScreen('rooms');
              void refreshRooms();
            }}
            onSelectElement={(el) => {
              chooseElement(el);
              const bridge = bridgeRef.current;
              if (room.online && bridge?.connected) bridge.net.selectElement(el);
              else {
                setRoom({
                  ...room,
                  slots: room.slots.map((s) => (s.isYou ? { ...s, element: el } : s)),
                });
              }
            }}
            onSelectTeam={(team) => {
              const bridge = bridgeRef.current;
              if (room.online && bridge?.connected) bridge.net.selectTeam(team);
            }}
            onAddBot={(team) => bridgeRef.current?.net.addBot(team, 'normal')}
            onRemoveBot={(slotId) => bridgeRef.current?.net.removeBot(slotId)}
            onToggleReady={() => {
              const you = room.slots.find((s) => s.isYou);
              const bridge = bridgeRef.current;
              if (room.online && bridge?.connected && you) bridge.net.setReady(!you.ready);
              else if (you) {
                setRoom({
                  ...room,
                  slots: room.slots.map((s) => (s.isYou ? { ...s, ready: !s.ready } : s)),
                });
              }
            }}
            onClaimSlot={(slotId) => {
              bridgeRef.current?.net.claimSlot(slotId);
              setClaimNotice('Claimed seat — you play after this round ends.');
            }}
            onStart={() => {
              if (room.online && bridgeRef.current?.connected) bridgeRef.current.net.startMatch();
              else props.actions.startPractice();
            }}
          />
        ) : null}
        {screen === 'onlineMatch' ? (
          <div class={styles.onlineMatch} ref={matchHostRef}>
            {(spectating || room?.youRole === 'spectator') && room ? (
              <div class={styles.spectatorBar}>
                <p>Spectating · claim a bot for next round</p>
                <div class={styles.toolbar}>
                  {room.slots
                    .filter((s) => s.isBot && !s.pendingClaimPlayerId)
                    .map((s) => (
                      <button
                        type="button"
                        key={s.slotId}
                        class={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() => bridgeRef.current?.net.claimSlot(s.slotId)}
                      >
                        Claim {s.name || s.slotId} ({s.element})
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
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
  const [name, setName] = useState('');
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
        props.onSignedIn(await loginAccount(name, password));
        return;
      }
      props.onSignedIn(await registerAccount(name, password));
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
        <label class={styles.field}>
          <span>Display name</span>
          <input class={styles.input} value={name} onInput={(e) => setName(e.currentTarget.value)} />
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

function DashboardScreen(props: {
  user: UserProfile;
  stats?: { wins: number; losses: number };
  onPractice(): void;
  onBrowseRooms(): void;
  onCreateRoom(): void;
  onSignOut(): void;
}): JSX.Element {
  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>Welcome</p>
          <h2 class={styles.panelTitle}>{props.user.name}</h2>
          <p class={styles.panelHint}>
            Record {props.stats?.wins ?? 0}W · {props.stats?.losses ?? 0}L
          </p>
        </div>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onSignOut}>
          Sign out
        </button>
      </div>
      <div class={styles.toolbar}>
        <button type="button" class={`${styles.btn} ${styles.btnTeal}`} onClick={props.onBrowseRooms}>
          Browse halls
        </button>
        <button type="button" class={styles.btn} onClick={props.onCreateRoom}>
          Create room
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onPractice}>
          Solo practice
        </button>
      </div>
    </div>
  );
}

function RoomBrowserScreen(props: {
  rooms: RoomSummary[];
  online: boolean;
  netError: string | null;
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
          <p class={styles.panelHint}>
            {props.online
              ? 'Live rooms from the Go server. Join a live match as spectator.'
              : 'Server offline — showing local demos. Start mageserver on :8080.'}
          </p>
          {props.netError ? <p class={styles.panelHint}>{props.netError}</p> : null}
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
        <button type="button" class={styles.btn} onClick={() => props.onJoin(code.trim())} disabled={code.trim().length < 3}>
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
                {room.teamSize}v{room.teamSize} · {room.roomId}
                {room.state === 'in_progress' ? ' · live' : ''}
                {room.acceptsSpectators ? ' · spectators ok' : ''}
              </p>
            </div>
            <span
              class={
                room.state === 'in_progress'
                  ? `${styles.badge} ${styles.badgeTeal}`
                  : room.isDemo
                    ? styles.badge
                    : `${styles.badge} ${styles.badgeTeal}`
              }
            >
              {room.state === 'in_progress' ? 'Live' : room.isDemo ? 'Demo' : 'Lobby'}
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
  netError: string | null;
  onBack(): void;
  onCreated(opts: { name: string; teamSize: number; fillBots: boolean; botDifficulty: string }): void;
}): JSX.Element {
  const [name, setName] = useState(`${props.hostName}'s Hall`);
  const [teamSize, setTeamSize] = useState(1);
  const [fillBots, setFillBots] = useState(true);
  const [botDifficulty, setBotDifficulty] = useState('normal');
  return (
    <div class={`${styles.panel} ${styles.panelNarrow}`}>
      <p class={styles.tag}>Host</p>
      <h2 class={styles.panelTitle}>Create room</h2>
      <p class={styles.panelHint}>Team size sets capacity (2 × size). Fill with bots to start alone.</p>
      {props.netError ? <p class={styles.panelHint}>{props.netError}</p> : null}
      <div class={styles.form}>
        <label class={styles.field}>
          <span>Room name</span>
          <input class={styles.input} value={name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class={styles.field}>
          <span>Team size</span>
          <select class={styles.select} value={String(teamSize)} onChange={(e) => setTeamSize(Number(e.currentTarget.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option value={n} key={n}>
                {n}v{n}
              </option>
            ))}
          </select>
        </label>
        <label class={styles.field}>
          <span>
            <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.currentTarget.checked)} /> Fill
            empty seats with bots
          </span>
        </label>
        {fillBots ? (
          <label class={styles.field}>
            <span>Bot difficulty</span>
            <select class={styles.select} value={botDifficulty} onChange={(e) => setBotDifficulty(e.currentTarget.value)}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          class={`${styles.btn} ${styles.btnBlock} ${styles.btnTeal}`}
          onClick={() => props.onCreated({ name, teamSize, fillBots, botDifficulty })}
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
  netError: string | null;
  claimNotice: string | null;
  spectating: boolean;
  onLeave(): void;
  onSelectElement(el: ElementId): void;
  onSelectTeam(team: 0 | 1): void;
  onAddBot(team: 0 | 1): void;
  onRemoveBot(slotId: string): void;
  onToggleReady(): void;
  onClaimSlot(slotId: string): void;
  onStart(): void;
}): JSX.Element {
  const { room } = props;
  const you = room.slots.find((s) => s.isYou);
  const team0 = room.slots.filter((s) => s.team === 0);
  const team1 = room.slots.filter((s) => s.team === 1);
  const occupied = room.slots.filter((s) => s.name);
  const allReady = occupied.length > 0 && occupied.every((s) => s.ready);
  const canStart = room.filled >= room.capacity && allReady;

  return (
    <div class={`${styles.panel} ${styles.panelWide}`}>
      <div class={styles.panelHeader}>
        <div>
          <p class={styles.tag}>
            Lobby · {room.roomId}
            {room.online ? ' · online' : ' · local'}
            {props.spectating ? ' · spectating' : ''}
          </p>
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

      {props.netError ? <p class={styles.panelHint}>{props.netError}</p> : null}
      {props.claimNotice ? <p class={styles.panelHint}>{props.claimNotice}</p> : null}

      {props.spectating ? (
        <>
          <p class={styles.panelHint}>You are spectating. Claim a bot seat for the next round:</p>
          <div class={styles.toolbar}>
            {room.slots
              .filter((s) => s.isBot)
              .map((s) => (
                <button
                  type="button"
                  key={s.slotId}
                  class={`${styles.btn} ${styles.btnGhost}`}
                  disabled={Boolean(s.pendingClaimPlayerId)}
                  onClick={() => props.onClaimSlot(s.slotId)}
                >
                  {s.pendingClaimPlayerId ? `Claimed · ${s.name}` : `Claim ${s.name} (${s.element})`}
                </button>
              ))}
          </div>
        </>
      ) : (
        <>
          <p class={styles.panelHint}>Your element</p>
          <div class={styles.elementChips}>
            {SELECTABLE_ELEMENTS.map((el) => (
              <button
                type="button"
                key={el.id}
                class={you?.element === el.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                onClick={() => props.onSelectElement(el.id)}
              >
                {el.name}
              </button>
            ))}
          </div>

          <div class={styles.toolbar}>
            <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onSelectTeam(0)}>
              Join team A
            </button>
            <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onSelectTeam(1)}>
              Join team B
            </button>
            {room.isHost ? (
              <>
                <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onAddBot(0)}>
                  Bot → A
                </button>
                <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={() => props.onAddBot(1)}>
                  Bot → B
                </button>
              </>
            ) : null}
          </div>
        </>
      )}

      <div class={styles.teams}>
        <TeamColumn title="Team A" slots={team0} isHost={room.isHost} onRemoveBot={props.onRemoveBot} />
        <TeamColumn title="Team B" slots={team1} isHost={room.isHost} onRemoveBot={props.onRemoveBot} />
      </div>

      {room.spectators && room.spectators.length > 0 ? (
        <p class={styles.panelHint}>
          Spectators: {room.spectators.map((s) => `${s.name}${s.claimedSlotId ? ' (claimed)' : ''}`).join(', ')}
        </p>
      ) : null}

      <div class={styles.footerBar}>
        {!props.spectating ? (
          <button type="button" class={`${styles.btn} ${styles.btnGhost}`} onClick={props.onToggleReady}>
            {you?.ready ? 'Unready' : 'Ready'}
          </button>
        ) : null}
        {room.isHost && !props.spectating ? (
          <button
            type="button"
            class={`${styles.btn} ${styles.btnTeal}`}
            disabled={!canStart}
            title={!canStart ? 'Fill every slot and ready up' : 'Start'}
            onClick={props.onStart}
          >
            Start duel
          </button>
        ) : (
          <p class={styles.panelHint}>{props.spectating ? 'Waiting for round to end…' : 'Waiting for host to start…'}</p>
        )}
      </div>
      <p class={styles.panelHint} style={{ marginTop: 10 }}>
        {room.online
          ? 'Online: Start runs the Go server match. Late joiners spectate until rematch.'
          : 'Local fallback — Start opens solo practice.'}
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
                {slot.pendingClaimPlayerId ? ' · claimed' : ''}
              </p>
              <p class={styles.roomMeta}>
                {slot.element || 'no element'}
                {slot.isBot ? ' · bot' : ''}
              </p>
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
