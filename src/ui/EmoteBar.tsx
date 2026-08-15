import { render, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { EMOTES, emoteIconUrl, isEmoteId, type EmoteId } from '../app/emotes';
import styles from './EmoteBar.module.css';

/** How long a floating bubble stays up before fading back out. */
const BUBBLE_DURATION_MS = 2200;

interface Refs {
  leftBubble: HTMLDivElement;
  leftBubbleImg: HTMLImageElement;
  rightBubble: HTMLDivElement;
  rightBubbleImg: HTMLImageElement;
}

function EmoteBarView(props: { refs: Refs; onPick: (id: EmoteId) => void }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        class={styles.bubble}
        data-side="left"
        hidden
        ref={(el) => {
          if (el) props.refs.leftBubble = el;
        }}
      >
        <img
          ref={(el) => {
            if (el) props.refs.leftBubbleImg = el;
          }}
          alt=""
        />
      </div>
      <div
        class={styles.bubble}
        data-side="right"
        hidden
        ref={(el) => {
          if (el) props.refs.rightBubble = el;
        }}
      >
        <img
          ref={(el) => {
            if (el) props.refs.rightBubbleImg = el;
          }}
          alt=""
        />
      </div>

      <div class={styles.panel} hidden={!open}>
        {EMOTES.map((e) => (
          <button
            type="button"
            key={e.id}
            class={styles.pick}
            title={e.label}
            onClick={() => {
              props.onPick(e.id);
              setOpen(false);
            }}
          >
            <img src={emoteIconUrl(e.id)} alt={e.label} />
          </button>
        ))}
      </div>

      <button type="button" class={styles.toggle} title="Quick react" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">···</span>
      </button>
    </>
  );
}

/**
 * A small quick-react wheel over the match — not a chat box, just eight icons
 * (src/app/emotes.ts) a player can throw at their opponent. Absent entirely
 * when the caller has nobody to send to (practice, the firing range): see
 * `onSendEmote` in OnlineMatch's constructor options.
 */
export class EmoteBar {
  private readonly host: HTMLDivElement;
  private readonly refs = {} as Refs;
  private leftTimer = 0;
  private rightTimer = 0;

  constructor(container: HTMLElement, onSend: (id: EmoteId) => void) {
    this.host = document.createElement('div');
    container.append(this.host);
    render(<EmoteBarView refs={this.refs} onPick={onSend} />, this.host);
    this.refs.leftBubble.classList.add(styles.left);
    this.refs.rightBubble.classList.add(styles.right);
  }

  /** Shows a floating bubble on the given side, auto-hiding after a beat. Unknown ids are dropped. */
  showBubble(side: 'left' | 'right', emoteId: string): void {
    if (!isEmoteId(emoteId)) return;
    const bubble = side === 'left' ? this.refs.leftBubble : this.refs.rightBubble;
    const img = side === 'left' ? this.refs.leftBubbleImg : this.refs.rightBubbleImg;
    const clearPrev = side === 'left' ? this.leftTimer : this.rightTimer;
    window.clearTimeout(clearPrev);

    img.src = emoteIconUrl(emoteId);
    bubble.hidden = false;
    const timer = window.setTimeout(() => {
      bubble.hidden = true;
    }, BUBBLE_DURATION_MS);
    if (side === 'left') this.leftTimer = timer;
    else this.rightTimer = timer;
  }

  dispose(): void {
    window.clearTimeout(this.leftTimer);
    window.clearTimeout(this.rightTimer);
    render(null, this.host);
    this.host.remove();
  }
}
