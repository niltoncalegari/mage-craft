import { render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ElementId } from '../game/elements';
import { ApiClient } from '../net/ApiClient';
import { LobbyBridge } from '../net/lobbyBridge';
import { loadOnlineMapData, OnlineMatch } from '../net/OnlineMatch';
import type { MatchFoundMsg, QueueStatusMsg } from '../net/protocol';
import { recordFor, reportFor } from '../net/SiegeMatchReporter';
import { PortalScene } from '../render/PortalScene';
import styles from './App.module.css';
import { clearSession, getSession, type UserProfile } from './auth';
import { loadLoadout } from './loadout';
import { recordMatch } from './matchHistory';
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
import { CreateRoomScreen } from './screens/CreateRoomScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { QueueScreen } from './screens/QueueScreen';
import { RangeScreen } from './screens/RangeScreen';
import { RankingScreen } from './screens/RankingScreen';
import { RoomBrowserScreen } from './screens/RoomBrowserScreen';
import { RoomLobbyScreen } from './screens/RoomLobbyScreen';
import { TitleScreen } from './screens/TitleScreen';

export type AppScreen =
  | 'title'
  | 'login'
  /** The three-action landing surface. */
  | 'home'
  /** Squad, deck and match history — everything you bring and everything you learned. */
  | 'dashboard'
  | 'practice'
  | 'rooms'
  | 'createRoom'
  | 'queue'
  | 'lobby'
  | 'onlineMatch'
  | 'ranking'
  /** Dev surface: the whole roster firing at a wall, for judging spell VFX. */
  | 'range';

interface AppProps {
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
  const metaRef = useRef({
    isHost: false,
    roomName: '',
    screen: 'title' as AppScreen,
    spectating: false,
    awaitingResultDismiss: false,
    /** Which wire team the player commands; the match POV depends on it. */
    localTeam: null as number | null,
  });

  const [screen, setScreen] = useState<AppScreen>(() => (getSession() ? 'home' : 'title'));
  const [user, setUser] = useState<UserProfile | null>(() => getSession());
  /** Read from the bridge's long-lived handlers, which must not close over a stale user. */
  const userRef = useRef<UserProfile | null>(user);
  userRef.current = user;
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>(() => listLocalRooms());
  const [selectedElement, setSelectedElement] = useState<ElementId>(props.selectedElement);
  const [netError, setNetError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatusMsg | null>(null);
  const [queueFound, setQueueFound] = useState<MatchFoundMsg | null>(null);

  metaRef.current = {
    isHost,
    roomName: metaRef.current.roomName,
    screen,
    spectating,
    awaitingResultDismiss: metaRef.current.awaitingResultDismiss,
    localTeam: metaRef.current.localTeam,
  };

  /**
   * Tells the server what this player brings. Sent on every path into a match
   * because the server keeps it per connection, not per room.
   */
  const sendLoadout = (bridge: LobbyBridge): void => {
    const loadout = loadLoadout();
    bridge.net.setLoadout(loadout.deck, loadout.squad);
  };

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
        // The roster is the only place that says which side is yours, and the
        // match POV (your Core on your side) is built from it.
        metaRef.current.localTeam = msg.slots.find((s) => s.playerId === bridge.id)?.team ?? null;
        setRoom(detail);
        setSpectating(detail.youRole === 'spectator');
        rememberRoom(detail);
        // A round-end room_state (rematch lobby) arrives right behind round_end —
        // don't yank the match view away while the victory/defeat screen is up;
        // onLeaveMatch below navigates once the player dismisses it.
        if (msg.state === 'lobby' && metaRef.current.screen === 'onlineMatch' && !metaRef.current.awaitingResultDismiss) {
          onlineMatchRef.current?.dispose();
          onlineMatchRef.current = null;
          setScreen('lobby');
        }
      },
      onRoomList: (msg) => {
        setRooms(summariesFromServer(msg.rooms));
        setOnline(true);
      },
      onMatchStart: () => {
        metaRef.current.awaitingResultDismiss = false;
        setScreen('onlineMatch');
      },
      onSnapshot: (msg) => onlineMatchRef.current?.applySnapshot(msg),
      onQueueStatus: (msg) => setQueueStatus(msg),
      onMatchFound: (msg) => {
        // The queue seats you without a lobby, so this is the first (and for a
        // bot opponent the only) place that names your side.
        metaRef.current.localTeam = msg.yourTeam;
        setQueueFound(msg);
      },
      onMatchResult: (msg) => {
        // Arrives just before round_end, while the match view is still up.
        const team = metaRef.current.localTeam;
        if (team === null || metaRef.current.spectating) return;
        const record = recordFor(msg, team, 'pvp');
        if (!record) return;

        recordMatch(record);
        const token = userRef.current?.token;
        if (token) {
          ApiClient.reportMatch(token, reportFor(record, 'pvp')).catch(() => {
            // The local history already has it; a failed sync is not worth
            // interrupting the victory screen for.
          });
        }
      },
      onRoundEnd: (msg) => {
        setClaimNotice('Round over — rematch lobby. Claimed bots become your seat.');
        metaRef.current.awaitingResultDismiss = true;
        onlineMatchRef.current?.showRoundResult(msg.winnerTeam);
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
    const host = matchHostRef.current;
    const net = bridgeRef.current.net;
    const localPlayerId = bridgeRef.current.id;
    let cancelled = false;

    onlineMatchRef.current?.dispose();
    onlineMatchRef.current = null;

    // The map fetch is cached after the first match, so in practice this
    // resolves within the same frame; snapshots that arrive first are simply
    // dropped, and the next one (~50ms later) repopulates the whole world.
    void loadOnlineMapData()
      .then((mapData) => {
        if (cancelled) return;
        onlineMatchRef.current = new OnlineMatch(host, net, {
          spectating: metaRef.current.spectating,
          localPlayerId,
          localTeam: metaRef.current.localTeam,
          mapData,
          onLeaveMatch: (reason) => {
            metaRef.current.awaitingResultDismiss = false;
            onlineMatchRef.current?.dispose();
            onlineMatchRef.current = null;
            if (reason === 'roundEnd') {
              setScreen('lobby');
            } else {
              setScreen('rooms');
              void refreshRooms();
            }
          },
        });
      })
      .catch((err: unknown) => {
        // Anything thrown while building the match view lands here, including a
        // bug in the view itself — which used to fail silently into a blank
        // arena, since netError is only rendered on the lobby screens.
        console.error('online match failed to start', err);
        if (!cancelled) setNetError(err instanceof Error ? err.message : 'Could not load the arena map');
      });

    return () => {
      cancelled = true;
      onlineMatchRef.current?.dispose();
      onlineMatchRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    onlineMatchRef.current?.setSpectating(spectating);
  }, [spectating]);

  const signIn = (profile: UserProfile): void => {
    setUser(profile);
    setScreen('home');
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

  /**
   * The one-button path into a match (GDD §4): the server pairs by arrival and
   * builds the room itself, so there is no code to share and nothing to ready up.
   */
  const enterQueue = async (name: string): Promise<void> => {
    setNetError(null);
    setQueueStatus(null);
    setQueueFound(null);
    setScreen('queue');
    try {
      const bridge = getBridge();
      await bridge.connect();
      setOnline(true);
      // Register the loadout before queueing: the server seats a queued player
      // immediately, with no lobby in between to send it during.
      sendLoadout(bridge);
      bridge.net.joinQueue(name);
    } catch (err) {
      setNetError(err instanceof Error ? err.message : 'Could not reach server');
      setOnline(false);
      setScreen('home');
    }
  };

  const leaveQueue = (): void => {
    const bridge = bridgeRef.current;
    if (bridge?.connected) bridge.net.leaveQueue();
    setQueueStatus(null);
    setQueueFound(null);
    setScreen('home');
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
      sendLoadout(bridge);
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
      sendLoadout(bridge);
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
            onEnter={() => setScreen(user ? 'home' : 'login')}
            onPractice={() => setScreen('practice')}
            onOpenRange={() => setScreen('range')}
          />
        ) : null}
        {screen === 'login' ? <LoginScreen onBack={() => setScreen('title')} onSignedIn={signIn} /> : null}
        {screen === 'home' && user ? (
          <HomeScreen
            user={user}
            stats={props.stats}
            onFindMatch={() => void enterQueue(user.name)}
            onPractice={() => setScreen('practice')}
            onOpenDashboard={() => setScreen('dashboard')}
            onOpenRanking={() => setScreen('ranking')}
            onCustomMatch={() => {
              void refreshRooms();
              setScreen('rooms');
            }}
            onSignOut={signOut}
          />
        ) : null}
        {screen === 'range' ? <RangeScreen onExit={() => setScreen(user ? 'home' : 'title')} /> : null}
        {screen === 'dashboard' && user ? <DashboardScreen user={user} onBack={() => setScreen('home')} /> : null}
        {screen === 'practice' ? (
          <PracticeScreen token={user?.token} onExit={() => setScreen(user ? 'home' : 'title')} />
        ) : null}
        {screen === 'queue' && user ? (
          <QueueScreen status={queueStatus} found={queueFound} netError={netError} onCancel={leaveQueue} />
        ) : null}
        {screen === 'ranking' && user ? <RankingScreen onBack={() => setScreen('home')} /> : null}
        {screen === 'rooms' && user ? (
          <RoomBrowserScreen
            rooms={rooms}
            online={online}
            netError={netError}
            onBack={() => setScreen('home')}
            onCreate={() => setScreen('createRoom')}
            onJoin={(id) => void joinOnlineRoom(id, user.name, selectedElement)}
            onRefresh={() => void refreshRooms()}
          />
        ) : null}
        {screen === 'createRoom' && user ? (
          <CreateRoomScreen
            hostName={user.name}
            netError={netError}
            onBack={() => setScreen('home')}
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
              else setScreen('practice');
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
