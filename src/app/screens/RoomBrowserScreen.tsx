import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { RoomSummary } from '../roomStore';
import styles from '../App.module.css';

export function RoomBrowserScreen(props: {
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
              ? 'Live rooms from the game server. Join a live match as spectator.'
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
