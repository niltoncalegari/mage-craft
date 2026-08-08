import type { JSX } from 'preact';
import { SELECTABLE_ELEMENTS, type ElementId } from '../../game/elements';
import type { RoomDetail } from '../roomStore';
import styles from '../App.module.css';

export function RoomLobbyScreen(props: {
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
          ? 'Online: Start runs the authoritative server match. Late joiners spectate until rematch.'
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
